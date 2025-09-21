// Utility functions for Mercurius

/**
 * Creates a unique key for a highlight based on its position and text
 * @param {Object} anchor - The anchor object containing selection info
 * @returns {string} - Unique key for the highlight
 */
export function createHighlightKey(anchor) {
  return `${anchor.selector}::${anchor.startOffset}::${anchor.endOffset}::${anchor.selectedText}`;
}

/**
 * Formats a timestamp to a human-readable relative time
 * @param {Object} timestamp - Firestore timestamp or Date object
 * @returns {string} - Formatted time string
 */
export function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  
  return date.toLocaleDateString();
}

/**
 * Sorts comments by upvotes (descending) then by timestamp (newest first)
 * @param {Array} comments - Array of comment objects
 * @returns {Array} - Sorted comments
 */
export function sortComments(comments) {
  return comments.sort((a, b) => {
    const upvoteDiff = (b.upvoteCount || 0) - (a.upvoteCount || 0);
    if (upvoteDiff !== 0) return upvoteDiff;
    
    // If upvotes are equal, sort by timestamp (newest first)
    const aTime = a.timestamp?.toDate?.() || new Date(0);
    const bTime = b.timestamp?.toDate?.() || new Date(0);
    return bTime.getTime() - aTime.getTime();
  });
}

/**
 * Gets the position of selected text for button placement
 * @param {Selection} selection - Window selection object
 * @returns {Object} - Position object with top and left coordinates
 */
export function getSelectionPosition(selection) {
  if (selection.rangeCount === 0) return null;
  
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  
  return {
    top: rect.top + window.pageYOffset - 40,
    left: rect.left + window.pageXOffset + (rect.width / 2) - 50
  };
}

/**
 * Creates notification data storage key
 * @param {string} type - Notification type (comment, reaction, upvote)
 * @returns {string} - Unique notification ID
 */
export function createNotificationId(type) {
  return `${type}-${Date.now()}`;
}

/**
 * Stores notification data for click handling
 * @param {string} notificationId - Notification ID
 * @param {Object} data - Comment data to store
 */
export function storeNotificationData(notificationId, data) {
  chrome.storage.local.set({
    [notificationId]: {
      url: data.url,
      commentId: data.id,
      anchor: data.anchor
    }
  });
}

/**
 * Retrieves and clears notification data
 * @param {string} notificationId - Notification ID
 * @returns {Promise} - Promise resolving to stored data
 */
export function getNotificationData(notificationId) {
  return new Promise((resolve) => {
    chrome.storage.local.get([notificationId], (result) => {
      chrome.storage.local.remove([notificationId]);
      resolve(result[notificationId]);
    });
  });
}

/**
 * Opens a tab and sends message to content script
 * @param {string} url - URL to open
 * @param {Object} messageData - Data to send to content script
 */
export function openTabWithMessage(url, messageData) {
  chrome.tabs.create({ url }, (tab) => {
    // Wait for the tab to load, then send message
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, messageData);
    }, 2000);
  });
}