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
  // Check if notifications are enabled
  chrome.storage.sync.get(['enableNotifications'], (result) => {
    if (result.enableNotifications === false) {
      return; // Don't show notification if disabled
    }
    
    const notificationId = `comment-${Date.now()}`;
    
    // Store the comment data with the notification ID for later retrieval
    chrome.storage.local.set({
      [notificationId]: {
        url: comment.url,
        commentId: comment.id,
        anchor: comment.anchor
      }
    });
    
    chrome.notifications.create(notificationId, {
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
  });
}

// Show a notification when someone reacts to your comment
export function showReactionNotification(userName, emoji, comment) {
  // Check if notifications are enabled
  chrome.storage.sync.get(['enableNotifications'], (result) => {
    if (result.enableNotifications === false) {
      return; // Don't show notification if disabled
    }
    
    const notificationId = `reaction-${Date.now()}`;
    
    // Store the comment data for later retrieval
    chrome.storage.local.set({
      [notificationId]: {
        url: comment.url,
        commentId: comment.id,
        anchor: comment.anchor
      }
    });
    
    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
      title: 'New reaction to your comment',
      message: `${userName} reacted with ${emoji}`,
      priority: 0,
      requireInteraction: false
    });
  });
}

// Show a notification when someone upvotes your comment
export function showUpvoteNotification(userName, comment) {
  // Check if notifications are enabled
  chrome.storage.sync.get(['enableNotifications'], (result) => {
    if (result.enableNotifications === false) {
      return; // Don't show notification if disabled
    }
    
    const notificationId = `upvote-${Date.now()}`;
    
    // Store the comment data for later retrieval
    chrome.storage.local.set({
      [notificationId]: {
        url: comment.url,
        commentId: comment.id,
        anchor: comment.anchor
      }
    });
    
    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
      title: 'Your comment was upvoted',
      message: `${userName} upvoted your comment`,
      priority: 0,
      requireInteraction: false
    });
  });
}

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId.startsWith('comment-')) {
    if (buttonIndex === 0) {
      // View button clicked - retrieve stored comment data
      chrome.storage.local.get([notificationId], (result) => {
        const commentData = result[notificationId];
        if (commentData && commentData.url) {
          // Open the page with the comment
          chrome.tabs.create({ url: commentData.url }, (tab) => {
            // Wait for the tab to load, then send message to open popover
            setTimeout(() => {
              chrome.tabs.sendMessage(tab.id, {
                action: 'openCommentFromNotification',
                commentId: commentData.commentId,
                anchor: commentData.anchor
              });
            }, 2000); // Give page time to load
          });
        }
        // Clean up stored data
        chrome.storage.local.remove([notificationId]);
      });
    }
    // Clear the notification
    chrome.notifications.clear(notificationId);
  }
});

// Clear notification when clicked
chrome.notifications.onClicked.addListener((notificationId) => {
  // Handle all types of notifications (comment, reaction, upvote)
  if (notificationId.startsWith('comment-') || 
      notificationId.startsWith('reaction-') || 
      notificationId.startsWith('upvote-')) {
    // Retrieve stored comment data
    chrome.storage.local.get([notificationId], (result) => {
      const commentData = result[notificationId];
      if (commentData && commentData.url) {
        // Open the page with the comment
        chrome.tabs.create({ url: commentData.url }, (tab) => {
          // Wait for the tab to load, then send message to open popover
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, {
              action: 'openCommentFromNotification',
              commentId: commentData.commentId,
              anchor: commentData.anchor
            });
          }, 2000); // Give page time to load
        });
      }
      // Clean up stored data
      chrome.storage.local.remove([notificationId]);
    });
  }
  chrome.notifications.clear(notificationId);
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