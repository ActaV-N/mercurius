// Background service worker for Mercurius extension
// Note: Firebase SDK needs to be bundled for Manifest V3
// For now, using a simplified version

// Track sidebar state
let sidebarOpen = {};
let currentUser = null;

// Listen for extension icon click to toggle sidebar
chrome.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  sidebarOpen[tabId] = !sidebarOpen[tabId];
  
  chrome.tabs.sendMessage(tabId, {
    action: 'toggleSidebar',
    open: sidebarOpen[tabId]
  });
});

// Handle authentication using Chrome Identity API
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'signIn') {
    // For now, mock authentication
    // In production, this would use chrome.identity.getAuthToken()
    currentUser = {
      uid: 'user_' + Math.random().toString(36).substr(2, 9),
      email: 'user@example.com',
      displayName: 'Test User',
      photoURL: null
    };
    
    sendResponse({ success: true, user: currentUser });
    
    // Notify all tabs about auth state change
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'authStateChanged',
          isSignedIn: true,
          user: currentUser
        }).catch(() => {});
      });
    });
    
    return true;
  }
  
  if (request.action === 'signOut') {
    currentUser = null;
    sendResponse({ success: true });
    
    // Notify all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'authStateChanged',
          isSignedIn: false
        }).catch(() => {});
      });
    });
    
    return true;
  }
  
  if (request.action === 'getAuthState') {
    sendResponse({ 
      isSignedIn: !!currentUser,
      user: currentUser
    });
  }
});

// Clean up sidebar state when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete sidebarOpen[tabId];
});