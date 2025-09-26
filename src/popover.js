import { initializeApp } from '@firebase/app';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
  arrayUnion,
  arrayRemove,
  serverTimestamp
} from '@firebase/firestore';
import { firebaseConfig, COLLECTIONS, REACTIONS } from '../lib/firebase-config.js';
import { formatRelativeTime, sortComments } from '../lib/utils.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// State
let currentUser = null;
let currentPageUrl = '';
let currentAnchor = null; // The current text selection being viewed
let comments = [];
let unsubscribeComments = null;
let authStateChecked = false; // Track if we've already checked auth
let isInitialLoad = true; // Track if this is the first load

// DOM Elements (will be populated after DOMContentLoaded)
let authRequired = null;
let commentInput = null;
let userAvatarInput = null;
let commentTextField = null;
let submitCommentBtn = null;
let signInBtn = null;
let closePopoverBtn = null;
let selectedTextDisplay = null;
let selectedTextContent = null;
let loadingState = null;
let emptyState = null;
let commentsContainer = null;

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init() {
  // Get all DOM elements first
  authRequired = document.getElementById('auth-required');
  commentInput = document.getElementById('comment-input');
  userAvatarInput = document.getElementById('user-avatar-input');
  commentTextField = document.getElementById('comment-text');
  submitCommentBtn = document.getElementById('submit-comment');
  signInBtn = document.getElementById('sign-in-btn');
  closePopoverBtn = document.getElementById('close-popover');
  selectedTextDisplay = document.getElementById('selected-text-display');
  selectedTextContent = document.getElementById('selected-text-content');
  loadingState = document.getElementById('loading-state');
  emptyState = document.getElementById('empty-state');
  commentsContainer = document.getElementById('comments-container');
  
  setupEventListeners();
  
  // Show loading state initially for everything
  showLoadingState();
}

// Event Listeners
function setupEventListeners() {
  signInBtn.addEventListener('click', handleSignIn);
  closePopoverBtn.addEventListener('click', closePopover);
  submitCommentBtn.addEventListener('click', () => {
    const textToSubmit = commentTextField.value;
    submitComment(textToSubmit);
  });
  
  // Enable/disable submit button based on input
  commentTextField.addEventListener('input', () => {
    submitCommentBtn.disabled = !commentTextField.value.trim();
  });
  
  // Submit on Enter key
  commentTextField.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && commentTextField.value.trim()) {
      e.preventDefault();
      const textToSubmit = commentTextField.value;
      commentTextField.value = ''; // Clear immediately
      submitCommentBtn.disabled = true;
      submitComment(textToSubmit);
    }
  });
  
  // Close on ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePopover();
    }
  });
}

// Auth Functions
function handleSignIn() {
  // Request parent window to open auth popover
  window.parent.postMessage({ type: 'openAuthPopover' }, '*');
  // Close this popover
  closePopover();
}

function checkAuthState(callback) {
  // Skip if already checked and we have the auth state cached
  if (authStateChecked) {
    const isSignedIn = !!currentUser;
    if (callback) callback(isSignedIn);
    return;
  }
  
  chrome.runtime.sendMessage({ action: 'getAuthState' }, (response) => {
    if (chrome.runtime.lastError) {
      // Try again after a short delay
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'getAuthState' }, (retryResponse) => {
          if (retryResponse) {
            currentUser = retryResponse.user;
            authStateChecked = true; // Mark as checked
            const isSignedIn = retryResponse.isSignedIn || false;
            if (callback) callback(isSignedIn);
          } else {
            authStateChecked = true; // Mark as checked even if failed
            if (callback) callback(false);
          }
        });
      }, 200);
      return;
    }
    
    if (response) {
      currentUser = response.user;
      authStateChecked = true; // Mark as checked
      const isSignedIn = response.isSignedIn || false;
      if (callback) callback(isSignedIn);
    } else {
      authStateChecked = true; // Mark as checked even if no response
      if (callback) callback(false);
    }
  });
}

// Unified loading state management
function showLoadingState() {
  // Hide everything except loading
  loadingState.classList.remove('hidden');
  emptyState.classList.add('hidden');
  commentsContainer.classList.add('hidden');
  selectedTextDisplay.classList.add('hidden');
  authRequired.classList.add('hidden');
  commentInput.classList.add('hidden');
  
  // Also hide the entire footer during loading
  const footer = document.querySelector('.popover-footer');
  if (footer) {
    footer.classList.add('hidden');
  }
}

function hideLoadingAndShowContent(isSignedIn) {
  // Hide loading
  loadingState.classList.add('hidden');
  
  // Show the footer
  const footer = document.querySelector('.popover-footer');
  if (footer) {
    footer.classList.remove('hidden');
  }
  
  // Show selected text if available
  if (currentAnchor) {
    selectedTextDisplay.classList.remove('hidden');
  }
  
  // Show auth UI
  updateAuthUI(isSignedIn);
  
  // Show comments
  renderComments();
  
  // Mark initial load as complete
  isInitialLoad = false;
}

function initialLoad() {
  // Check auth state first
  checkAuthState((isSignedIn) => {
    // Always load comments if we have page and anchor, regardless of auth state
    if (currentPageUrl && currentAnchor) {
      loadComments(() => {
        hideLoadingAndShowContent(isSignedIn);
      });
    } else {
      // No comments to load
      hideLoadingAndShowContent(isSignedIn);
    }
  });
}

function updateAuthUI(isSignedIn) {
  if (!authRequired || !commentInput) {
    return;
  }
  
  if (isSignedIn && currentUser) {
    // User is signed in - show comment input, hide auth prompt
    authRequired.style.display = 'none';
    authRequired.classList.add('hidden');
    commentInput.style.display = 'block';
    commentInput.classList.remove('hidden');
    
    if (userAvatarInput) {
      userAvatarInput.src = currentUser.photoURL || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23999"/></svg>';
    }
    // Focus the input field when user is signed in
    if (commentTextField) {
      commentTextField.focus();
    }
  } else {
    // User is not signed in - hide comment input, show auth prompt
    commentInput.style.display = 'none';
    commentInput.classList.add('hidden');
    authRequired.style.display = 'block';
    authRequired.classList.remove('hidden');
  }
  
  // Force a reflow to ensure changes are applied
  void authRequired.offsetHeight;
  void commentInput.offsetHeight;
}

// Comment Functions
function loadComments(callback) {
  if (!currentPageUrl || !currentAnchor) {
    if (callback) callback();
    return;
  }
  
  // Don't show loading state if initial load (already showing)
  if (!isInitialLoad) {
    loadingState.classList.remove('hidden');
    emptyState.classList.add('hidden');
    commentsContainer.classList.add('hidden');
  }
  
  // Unsubscribe from previous listener
  if (unsubscribeComments) {
    unsubscribeComments();
  }
  
  // Create query for comments on current page with the same selected text
  // Note: We'll sort by upvotes client-side since Firestore requires an index for compound queries
  const q = query(
    collection(db, COLLECTIONS.COMMENTS),
    where('url', '==', currentPageUrl),
    where('anchor.selectedText', '==', currentAnchor.selectedText)
  );
  
  // Subscribe to real-time updates
  unsubscribeComments = onSnapshot(q, (snapshot) => {
    comments = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      comments.push({
        id: doc.id,
        ...data,
        upvoteCount: (data.upvotes || []).length,
        timestamp: data.timestamp
      });
    });
    
    // Sort comments by upvotes then timestamp
    comments = sortComments(comments);
    
    if (callback) callback();
    if (!isInitialLoad) {
      renderComments();
    }
  }, (error) => {
    if (callback) callback();
    if (!isInitialLoad) {
      loadingState.classList.add('hidden');
      emptyState.classList.remove('hidden');
    }
  });
}

function renderComments() {
  // Don't hide loading state here anymore - it will be handled by hideLoadingAndShowContent
  
  if (comments.length === 0) {
    emptyState.classList.remove('hidden');
    commentsContainer.classList.add('hidden');
    return;
  }
  
  emptyState.classList.add('hidden');
  commentsContainer.classList.remove('hidden');
  
  // Clear container
  commentsContainer.innerHTML = '';
  
  // Render each comment
  comments.forEach(comment => {
    const commentEl = createCommentElement(comment);
    commentsContainer.appendChild(commentEl);
  });
}

function createCommentElement(comment) {
  const template = document.getElementById('comment-template');
  const clone = template.content.cloneNode(true);
  const card = clone.querySelector('.comment-card');
  
  card.dataset.commentId = comment.id;
  
  // Set user info
  const avatar = clone.querySelector('.comment-avatar');
  avatar.src = comment.userPhoto || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23999"/></svg>';
  avatar.alt = comment.userName;
  
  clone.querySelector('.comment-author').textContent = comment.userName;
  clone.querySelector('.comment-time').textContent = formatRelativeTime(comment.timestamp);
  
  // Hide anchor text since we're only showing comments for specific text
  const anchorEl = clone.querySelector('.comment-anchor');
  if (anchorEl) {
    anchorEl.style.display = 'none';
  }
  
  // Set comment text
  clone.querySelector('.comment-text').textContent = comment.text;
  
  // Set vote counts
  const upvoteBtn = clone.querySelector('.upvote');
  const downvoteBtn = clone.querySelector('.downvote');
  const upvoteCount = comment.upvotes?.length || 0;
  const downvoteCount = comment.downvotes?.length || 0;
  
  upvoteBtn.querySelector('.vote-count').textContent = upvoteCount;
  downvoteBtn.querySelector('.vote-count').textContent = downvoteCount;
  
  // Highlight user's votes
  if (currentUser) {
    if (comment.upvotes?.includes(currentUser.uid)) {
      upvoteBtn.classList.add('active');
    }
    if (comment.downvotes?.includes(currentUser.uid)) {
      downvoteBtn.classList.add('active');
    }
  }
  
  // Create existing reactions in the reaction section
  const existingReactions = clone.querySelector('.existing-reactions');
  const reactions = comment.reactions || {};
  
  Object.entries(reactions).forEach(([emoji, users]) => {
    if (users && users.length > 0) {
      const reactionBtn = document.createElement('button');
      reactionBtn.className = 'reaction-btn';
      reactionBtn.dataset.emoji = emoji;
      
      // Check if current user reacted
      if (currentUser && users.includes(currentUser.uid)) {
        reactionBtn.classList.add('active');
      }
      
      reactionBtn.innerHTML = `${emoji} <span>${users.length}</span>`;
      reactionBtn.addEventListener('click', () => handleReaction(comment.id, emoji));
      existingReactions.appendChild(reactionBtn);
    }
  });
  
  // Add reaction button in the reaction section
  const addReactionBtn = clone.querySelector('.add-reaction-btn');
  addReactionBtn.addEventListener('click', (e) => showEmojiPicker(e, comment.id));
  
  // Add event listeners for votes
  upvoteBtn.addEventListener('click', () => handleVote(comment.id, 'up'));
  downvoteBtn.addEventListener('click', () => handleVote(comment.id, 'down'));
  
  // Menu button (for delete if user's own comment)
  const menuBtn = clone.querySelector('.comment-menu');
  if (currentUser && comment.userId === currentUser.uid) {
    menuBtn.addEventListener('click', () => handleCommentMenu(comment.id));
  } else {
    menuBtn.style.display = 'none';
  }
  
  return clone;
}

async function submitComment(textToSubmit) {
  if (!currentUser || !currentAnchor) {
    return;
  }
  
  const commentText = textToSubmit || commentTextField.value.trim();
  if (!commentText) return;
  
  try {
    // Add comment to Firestore
    const docRef = await addDoc(collection(db, COLLECTIONS.COMMENTS), {
      url: currentPageUrl,
      anchor: currentAnchor,
      text: commentText,
      userId: currentUser.uid,
      userName: currentUser.displayName || 'Anonymous',
      userPhoto: currentUser.photoURL || '',
      timestamp: serverTimestamp(),
      upvotes: [],
      downvotes: [],
      reactions: {}
    });
    
    // Clear form
    commentTextField.value = '';
    submitCommentBtn.disabled = true;
    
    // Tell parent to apply highlight immediately with the actual comment ID
    window.parent.postMessage({
      type: 'applyHighlight',
      data: {
        anchor: currentAnchor,
        commentId: docRef.id
      }
    }, '*');
    
  } catch (error) {
    alert(`Failed to add comment: ${error.message}`);
  }
}

async function handleVote(commentId, voteType) {
  if (!currentUser) {
    handleSignIn();
    return;
  }
  
  const commentRef = doc(db, COLLECTIONS.COMMENTS, commentId);
  const comment = comments.find(c => c.id === commentId);
  
  if (!comment) return;
  
  try {
    const hasUpvoted = comment.upvotes?.includes(currentUser.uid);
    const hasDownvoted = comment.downvotes?.includes(currentUser.uid);
    
    if (voteType === 'up') {
      if (hasUpvoted) {
        await updateDoc(commentRef, {
          upvotes: arrayRemove(currentUser.uid)
        });
      } else {
        const updates = {
          upvotes: arrayUnion(currentUser.uid)
        };
        if (hasDownvoted) {
          updates.downvotes = arrayRemove(currentUser.uid);
        }
        await updateDoc(commentRef, updates);
      }
    } else {
      if (hasDownvoted) {
        await updateDoc(commentRef, {
          downvotes: arrayRemove(currentUser.uid)
        });
      } else {
        const updates = {
          downvotes: arrayUnion(currentUser.uid)
        };
        if (hasUpvoted) {
          updates.upvotes = arrayRemove(currentUser.uid);
        }
        await updateDoc(commentRef, updates);
      }
    }
  } catch (error) {
    // Silently fail vote update
  }
}

async function handleReaction(commentId, emoji) {
  if (!currentUser) {
    handleSignIn();
    return;
  }
  
  const commentRef = doc(db, COLLECTIONS.COMMENTS, commentId);
  const comment = comments.find(c => c.id === commentId);
  
  if (!comment) return;
  
  try {
    const reactions = comment.reactions || {};
    const emojiReactions = reactions[emoji] || [];
    const hasReacted = emojiReactions.includes(currentUser.uid);
    
    if (hasReacted) {
      reactions[emoji] = emojiReactions.filter(uid => uid !== currentUser.uid);
    } else {
      reactions[emoji] = [...emojiReactions, currentUser.uid];
    }
    
    await updateDoc(commentRef, { reactions });
  } catch (error) {
    // Silently fail reaction update
  }
}

async function handleCommentMenu(commentId) {
  try {
    await deleteDoc(doc(db, COLLECTIONS.COMMENTS, commentId));
    
    // Remove highlight from page
    window.parent.postMessage({
      type: 'removeHighlight',
      data: { commentId }
    }, '*');
  } catch (error) {
    alert('Failed to delete comment');
  }
}

// Show emoji picker
let currentCommentIdForEmoji = null;

function showEmojiPicker(event, commentId) {
  event.stopPropagation();
  
  const picker = document.getElementById('emoji-picker');
  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  
  currentCommentIdForEmoji = commentId;
  
  // Position the picker above the button with some offset
  const pickerHeight = 50; // Approximate height of picker
  picker.style.top = `${rect.top - pickerHeight - 8}px`;
  picker.style.left = `${rect.left}px`;
  
  // If too close to top, show below instead
  if (rect.top - pickerHeight - 8 < 10) {
    picker.style.top = `${rect.bottom + 8}px`;
  }
  
  picker.classList.remove('hidden');
  
  // Close picker when clicking outside
  setTimeout(() => {
    document.addEventListener('click', hideEmojiPicker);
  }, 0);
}

function hideEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  picker.classList.add('hidden');
  currentCommentIdForEmoji = null;
  document.removeEventListener('click', hideEmojiPicker);
}

// Initialize emoji picker
document.addEventListener('DOMContentLoaded', () => {
  const emojiOptions = document.querySelectorAll('.emoji-option');
  emojiOptions.forEach(option => {
    option.addEventListener('click', async (e) => {
      e.stopPropagation();
      const emoji = option.dataset.emoji;
      
      if (currentCommentIdForEmoji) {
        await handleReaction(currentCommentIdForEmoji, emoji);
        hideEmojiPicker();
      }
    });
  });
});

function closePopover() {
  window.parent.postMessage({ type: 'closePopover' }, '*');
}

// Removed - using formatRelativeTime from utils.js instead

// Listen for messages from parent window
window.addEventListener('message', (event) => {
  if (event.data.type === 'newComment') {
    currentAnchor = event.data.anchor;
    
    // Show selected text in header
    selectedTextContent.textContent = `"${currentAnchor.selectedText}"`;
    selectedTextDisplay.classList.remove('hidden');
    
    // Focus input if signed in
    if (currentUser) {
      commentTextField.focus();
    }
  }
  
  if (event.data.type === 'pageLoaded') {
    currentPageUrl = event.data.url;
    currentAnchor = event.data.anchor; // Get the anchor for filtered comments
    
    // Store selected text but don't show yet
    if (currentAnchor) {
      selectedTextContent.textContent = `"${currentAnchor.selectedText}"`;
    }
    
    // Perform initial load sequence
    if (isInitialLoad) {
      initialLoad();
    } else {
      // Not initial load, show immediately
      if (currentAnchor) {
        selectedTextDisplay.classList.remove('hidden');
      }
      loadComments();
    }
  }
  
  if (event.data.type === 'authStateChanged') {
    currentUser = event.data.user;
    authStateChecked = true; // Update cached state
    
    if (isInitialLoad && currentPageUrl) {
      // If still in initial load and we now have page info, complete the load
      initialLoad();
    } else {
      // Not initial load, update UI immediately
      updateAuthUI(!!currentUser);
      // Always reload comments when auth state changes (signed-out users can still view)
      if (currentPageUrl && currentAnchor) {
        loadComments();
      }
    }
  }
  
  if (event.data.type === 'scrollToCommentInList') {
    const commentId = event.data.commentId;
    const commentElement = document.querySelector(`[data-comment-id="${commentId}"]`);
    if (commentElement) {
      commentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      commentElement.style.backgroundColor = 'rgba(66, 133, 244, 0.1)';
      setTimeout(() => {
        commentElement.style.backgroundColor = '';
      }, 2000);
    }
  }
});