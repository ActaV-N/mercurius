import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCredential, GoogleAuthProvider, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs, onSnapshot, orderBy } from 'firebase/firestore';
import { firebaseConfig, COLLECTIONS } from '../lib/firebase-config.js';
import { showNewCommentNotification, showReactionNotification, showUpvoteNotification } from './notifications.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Listen for extension icon click to show auth popover
chrome.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  
  // Check if user is authenticated
  const user = auth.currentUser;
  
  // Send message to check current state and toggle
  chrome.tabs.sendMessage(tabId, {
    action: 'toggleAuthPopover',
    isAuthenticated: !!user,
    user: user ? {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL
    } : null
  }).catch(() => {
    // Tab might not have content script loaded
  });
});

// Handle authentication and popover state
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'signIn') {
    handleSignIn()
      .then(user => sendResponse({ success: true, user }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === 'signOut') {
    // First sign out from Firebase
    auth.signOut()
      .then(() => {
        // Then revoke the Chrome identity token to force account selection next time
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
          if (chrome.runtime.lastError) {
            // No token to revoke, which is fine
            return;
          }
          
          if (token) {
            // Revoke the token
            chrome.identity.removeCachedAuthToken({ token }, () => {
              // Also revoke it from Google's servers
              fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`, {
                method: 'POST',
              }).then(() => {
              }).catch(() => {
                // Revoke might fail but continue anyway
              });
            });
          }
        });
        sendResponse({ success: true });
      })
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === 'getAuthState') {
    const user = auth.currentUser;
    sendResponse({ 
      isSignedIn: !!user,
      user: user ? {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL
      } : null
    });
  }
  
  // Handle auth popover closed notification (no longer needed)
  if (request.action === 'authPopoverClosed' && sender.tab) {
    // No tracking needed - DOM state is source of truth
  }
  
  // Handle request for page comments
  if (request.action === 'getPageComments') {
    getPageComments(request.url)
      .then(comments => sendResponse({ comments }))
      .catch(() => {
        sendResponse({ comments: [] });
      });
    return true; // Will respond asynchronously
  }
  
  // Handle auth flow request
  if (request.action === 'openAuthFlow') {
    handleSignIn()
      .then(user => {
        // Notify all tabs about auth state change
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'authStateChanged',
              isSignedIn: true,
              user: user
            }).catch(() => {});
          });
        });
      })
      .catch(() => {});
  }
  
  // Handle highlight setting change
  if (request.action === 'highlightSettingChanged') {
    // Notify all tabs about the highlight setting change
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'updateHighlightVisibility',
          showHighlights: request.showHighlights
        }).catch(() => {});
      });
    });
  }
});

// Handle Google Sign-In using Chrome Identity API
async function handleSignIn() {
  try {
    // First, get any existing token and revoke it
    await new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (existingToken) => {
        if (chrome.runtime.lastError) {
          // OAuth2 not granted or other error - just continue
          resolve();
          return;
        }
        
        if (existingToken) {
          // Remove the cached token
          chrome.identity.removeCachedAuthToken({ token: existingToken }, () => {
            // Revoke it from Google's servers too
            fetch(`https://accounts.google.com/o/oauth2/revoke?token=${existingToken}`, {
              method: 'POST',
            }).then(() => {
              resolve();
            }).catch(() => {
              // Even if revoke fails, continue
              resolve();
            });
          });
        } else {
          resolve();
        }
      });
    });
    
    // Clear all cached tokens to ensure fresh login
    await new Promise((resolve) => {
      chrome.identity.clearAllCachedAuthTokens(() => {
        resolve();
      });
    });
    
    // Force account selection by using a special parameter
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ 
        interactive: true,
        account: undefined // This helps force account selection
      }, (token) => {
        if (chrome.runtime.lastError || !token) {
          reject(chrome.runtime.lastError || new Error('No token received'));
        } else {
          resolve(token);
        }
      });
    });
    
    // Create credential and sign in with Firebase
    const credential = GoogleAuthProvider.credential(null, token);
    const result = await signInWithCredential(auth, credential);
    
    return {
      uid: result.user.uid,
      email: result.user.email,
      displayName: result.user.displayName,
      photoURL: result.user.photoURL
    };
  } catch (error) {
    throw error;
  }
}

// Monitor auth state changes
onAuthStateChanged(auth, (user) => {
  if (user) {
    
    // Set up notification listeners for this user
    setupNotificationListeners(user);
    
    // Notify all tabs about auth state change
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'authStateChanged',
          isSignedIn: true,
          user: {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL
          }
        }).catch(() => {});
      });
    });
  } else {
    
    // Clean up notification listeners on sign out
    notificationListeners.forEach(unsubscribe => unsubscribe());
    notificationListeners = [];
    previousCommentStates.clear();
    
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'authStateChanged',
          isSignedIn: false
        }).catch(() => {});
      });
    });
  }
});

// Fetch comments for a specific page
async function getPageComments(url) {
  try {
    const q = query(
      collection(db, COLLECTIONS.COMMENTS),
      where('url', '==', url)
    );
    
    const querySnapshot = await getDocs(q);
    const comments = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      comments.push({
        id: doc.id,
        ...data,
        upvoteCount: (data.upvotes || []).length
      });
    });
    
    // Sort by upvote count (descending), then by timestamp as tiebreaker
    comments.sort((a, b) => {
      const upvoteDiff = b.upvoteCount - a.upvoteCount;
      if (upvoteDiff !== 0) return upvoteDiff;
      
      // If upvotes are equal, sort by timestamp (newest first)
      const aTime = a.timestamp?.toDate?.() || new Date(0);
      const bTime = b.timestamp?.toDate?.() || new Date(0);
      return bTime - aTime;
    });
    
    return comments;
  } catch (error) {
    // Return empty array if not authenticated or error
    return [];
  }
}

// Set up real-time listeners for notifications
let notificationListeners = [];
let previousCommentStates = new Map(); // Track previous states for comparison


function setupNotificationListeners(currentUser) {
  // Clean up any existing listeners
  notificationListeners.forEach(unsubscribe => unsubscribe());
  notificationListeners = [];
  previousCommentStates.clear();
  
  
  // Track processed notifications to avoid duplicates
  const processedNotifications = new Set();
  
  // Store the current time to only process new comments
  const listenerStartTime = new Date();
  
  // Listen for new comments on user's highlights across all pages
  const commentsQuery = query(
    collection(db, COLLECTIONS.COMMENTS),
    orderBy('timestamp', 'desc')
  );
  
  const unsubscribe = onSnapshot(commentsQuery, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const comment = change.doc.data();
      const commentId = change.doc.id;
      
      if (change.type === 'added') {
        // Skip if we've already processed this notification
        if (processedNotifications.has(commentId)) return;
        processedNotifications.add(commentId);
        
        // Skip old comments (only notify for comments created after listener started)
        const commentTime = comment.timestamp?.toDate?.() || new Date();
        if (commentTime < listenerStartTime) {
          return;
        }
        
        // Store initial state only for new comments (not old ones)
        previousCommentStates.set(commentId, {
          upvotes: comment.upvotes || [],
          reactions: comment.reactions || {}
        });
        
        // Don't notify for user's own comments
        if (comment.userId === currentUser.uid) return;
        
        // Check if this comment is on the same text as one of user's comments
        checkIfReplyToUser(comment, currentUser.uid).then(isReply => {
          if (isReply) {
            showNewCommentNotification({
              ...comment,
              id: commentId,
              url: comment.url,
              anchor: comment.anchor
            });
          }
        });
      }
      
      if (change.type === 'modified') {
        // Skip if we don't have a previous state (means it's an old comment)
        if (!previousCommentStates.has(commentId)) {
          // Store current state for future comparisons
          previousCommentStates.set(commentId, {
            upvotes: comment.upvotes || [],
            reactions: comment.reactions || {}
          });
          return; // Don't notify for first modification we see
        }
        
        // Get the previous state
        const previousState = previousCommentStates.get(commentId);
        
        // Check for new reactions on user's comments
        if (comment.userId === currentUser.uid && comment.reactions) {
          const oldReactionCount = Object.values(previousState.reactions || {})
            .reduce((sum, users) => sum + users.length, 0);
          const newReactionCount = Object.values(comment.reactions || {})
            .reduce((sum, users) => sum + users.length, 0);
          
          if (newReactionCount > oldReactionCount) {
            // Find the new reaction
            for (const [emoji, users] of Object.entries(comment.reactions)) {
              const oldUsers = previousState.reactions?.[emoji] || [];
              const newUsers = users.filter(u => !oldUsers.includes(u) && u !== currentUser.uid);
              
              if (newUsers.length > 0) {
                showReactionNotification('Someone', emoji, {
                  ...comment,
                  id: commentId,
                  url: comment.url,
                  anchor: comment.anchor
                });
              }
            }
          }
        }
        
        // Check for new upvotes on user's comments
        if (comment.userId === currentUser.uid) {
          const oldUpvotes = previousState.upvotes || [];
          const newUpvotes = comment.upvotes || [];
          
          if (newUpvotes.length > oldUpvotes.length) {
            const newVoters = newUpvotes.filter(u => !oldUpvotes.includes(u) && u !== currentUser.uid);
            if (newVoters.length > 0) {
              showUpvoteNotification('Someone', {
                ...comment,
                id: commentId,
                url: comment.url,
                anchor: comment.anchor
              });
            }
          }
        }
        
        // Update the stored state for next comparison
        previousCommentStates.set(commentId, {
          upvotes: comment.upvotes || [],
          reactions: comment.reactions || {}
        });
      }
    });
  });
  
  notificationListeners.push(unsubscribe);
}

// Helper function to check if a comment is a reply to the user
async function checkIfReplyToUser(comment, userId) {
  // Check if the comment is on the same anchor as any of the user's comments
  try {
    const q = query(
      collection(db, COLLECTIONS.COMMENTS),
      where('url', '==', comment.url),
      where('anchor.selectedText', '==', comment.anchor?.selectedText),
      where('userId', '==', userId)
    );
    
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  } catch (error) {
    return false;
  }
}

// (Auth state listener moved above to consolidate)

// Export for bundling
export { db };