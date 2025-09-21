import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCredential, GoogleAuthProvider, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { firebaseConfig, COLLECTIONS } from '../lib/firebase-config.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Listen for extension icon click to show auth popover
chrome.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  
  // Check if user is authenticated
  const user = auth.currentUser;
  console.log('Action clicked, current user:', user); // Debug log
  
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
  }).catch(error => {
    console.error('Error sending message to tab:', error);
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
            console.log('No auth token to revoke on sign out');
            return;
          }
          
          if (token) {
            // Revoke the token
            chrome.identity.removeCachedAuthToken({ token }, () => {
              // Also revoke it from Google's servers
              fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`, {
                method: 'POST',
              }).then(() => {
                console.log('Token revoked successfully');
              }).catch(error => {
                console.error('Error revoking token:', error);
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
      .catch(error => {
        console.error('Error fetching comments:', error);
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
      .catch(error => console.error('Auth flow error:', error));
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
          console.log('No previous auth token to revoke');
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
              console.log('Previous token revoked');
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
    console.error('Sign in error:', error);
    throw error;
  }
}

// Monitor auth state changes
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log('User signed in:', user.email);
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
    console.log('User signed out');
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
    console.error('Error fetching page comments:', error);
    // Return empty array if not authenticated or error
    return [];
  }
}

// Clean up when tab is closed (no longer needed since we don't track state)

// Export for bundling
export { db };