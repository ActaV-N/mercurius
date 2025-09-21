// Notification helper functions for Mercurius

// Check if notifications are supported and permission is granted
export async function checkNotificationPermission() {
  return new Promise((resolve) => {
    chrome.permissions.contains({
      permissions: ['notifications']
    }, (result) => {
      resolve(result);
    });
  });
}

// Show a notification when someone comments on your text
export function showNewCommentNotification(comment) {
  chrome.notifications.create(`comment-${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
    title: 'New comment on your highlight',
    message: `${comment.userName}: ${comment.text.substring(0, 100)}${comment.text.length > 100 ? '...' : ''}`,
    buttons: [
      { title: 'View' },
      { title: 'Dismiss' }
    ],
    priority: 1,
    requireInteraction: false
  });
}

// Show a notification when someone reacts to your comment
export function showReactionNotification(userName, emoji) {
  chrome.notifications.create(`reaction-${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
    title: 'New reaction to your comment',
    message: `${userName} reacted with ${emoji}`,
    priority: 0,
    requireInteraction: false
  });
}

// Show a notification when someone upvotes your comment
export function showUpvoteNotification(userName) {
  chrome.notifications.create(`upvote-${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
    title: 'Your comment was upvoted',
    message: `${userName} upvoted your comment`,
    priority: 0,
    requireInteraction: false
  });
}

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId.startsWith('comment-')) {
    if (buttonIndex === 0) {
      // View button clicked - open the comment popover
      // You can send a message to content script to open popover
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'openCommentFromNotification',
            notificationId: notificationId
          });
        }
      });
    }
    // Clear the notification
    chrome.notifications.clear(notificationId);
  }
});

// Clear notification when clicked
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
  
  // Optionally open the relevant page
  if (notificationId.startsWith('comment-')) {
    // Handle opening the comment
  }
});

// Example usage in background.js:
// When listening to Firestore for new comments, check if it's on user's content
// and show notification if they're not the author of the new comment
export function setupCommentNotifications(db, currentUserId) {
  // This would be integrated with your Firestore listeners
  // Example pseudocode:
  /*
  onSnapshot(commentsQuery, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const comment = change.doc.data();
        // Check if this is a reply to current user's highlight
        if (comment.parentUserId === currentUserId && comment.userId !== currentUserId) {
          showNewCommentNotification(comment);
        }
      }
    });
  });
  */
}