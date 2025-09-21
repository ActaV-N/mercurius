// Auth popover script
let currentUser = null;

// DOM Elements
const authSignedOut = document.getElementById('auth-signed-out');
const authSignedIn = document.getElementById('auth-signed-in');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const userEmail = document.getElementById('user-email');
const signInBtn = document.getElementById('sign-in-btn');
const signOutBtn = document.getElementById('sign-out-btn');
const closeAuthBtn = document.getElementById('close-auth');
const highlightToggle = document.getElementById('highlight-toggle');

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init() {
  setupEventListeners();
  checkAuthState();
  loadHighlightSetting();
}

// Event Listeners
function setupEventListeners() {
  signInBtn.addEventListener('click', handleSignIn);
  signOutBtn.addEventListener('click', handleSignOut);
  closeAuthBtn.addEventListener('click', closePopover);
  
  if (highlightToggle) {
    highlightToggle.addEventListener('change', handleHighlightToggle);
  }
}

// Auth Functions
function handleSignIn() {
  chrome.runtime.sendMessage({ action: 'signIn' }, (response) => {
    if (response.success) {
      currentUser = response.user;
      updateAuthUI(true);
      // Don't auto-close - let user close manually or click sign out
    } else {
      console.error('Sign in failed:', response.error);
      alert('Sign in failed. Please try again.');
    }
  });
}

function handleSignOut() {
  chrome.runtime.sendMessage({ action: 'signOut' }, (response) => {
    if (response.success) {
      currentUser = null;
      updateAuthUI(false);
    }
  });
}

function checkAuthState() {
  chrome.runtime.sendMessage({ action: 'getAuthState' }, (response) => {
    currentUser = response.user;
    updateAuthUI(response.isSignedIn);
  });
}

function updateAuthUI(isSignedIn) {
  if (isSignedIn && currentUser) {
    authSignedOut.classList.add('hidden');
    authSignedIn.classList.remove('hidden');
    userAvatar.src = currentUser.photoURL || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23999"/></svg>';
    userName.textContent = currentUser.displayName || 'Anonymous';
    userEmail.textContent = currentUser.email || '';
  } else {
    authSignedIn.classList.add('hidden');
    authSignedOut.classList.remove('hidden');
  }
}

function closePopover() {
  window.parent.postMessage({ type: 'closeAuthPopover' }, '*');
}

// Load highlight setting from storage
function loadHighlightSetting() {
  chrome.storage.sync.get(['showHighlights'], (result) => {
    // Default to true if not set
    const showHighlights = result.showHighlights !== false;
    if (highlightToggle) {
      highlightToggle.checked = showHighlights;
    }
  });
}

// Handle highlight toggle change
function handleHighlightToggle() {
  const showHighlights = highlightToggle.checked;
  
  // Save to storage
  chrome.storage.sync.set({ showHighlights }, () => {
    console.log('Highlight setting saved:', showHighlights);
    
    // Notify all tabs to update their highlights
    chrome.runtime.sendMessage({ 
      action: 'highlightSettingChanged', 
      showHighlights 
    });
  });
}

// Listen for messages from parent window
window.addEventListener('message', (event) => {
  console.log('Auth popover received message:', event.data);
  if (event.data.type === 'authStateUpdate') {
    currentUser = event.data.user;
    updateAuthUI(event.data.isAuthenticated);
  }
});