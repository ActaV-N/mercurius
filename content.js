// Content script for Mercurius - handles text selection and highlighting
let popoverIframe = null;
let authPopoverIframe = null;
let currentUser = null;
let highlights = new Map(); // Store active highlights by unique text key
let highlightToComments = new Map(); // Map highlight key to comment IDs
let pageComments = []; // Store comments for current page

// Inject highlight styles
function injectStyles() {
  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('styles/highlight.css');
  document.head.appendChild(styleLink);
}

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    checkInitialAuthState();
    loadPageHighlights();
  });
} else {
  injectStyles();
  checkInitialAuthState();
  loadPageHighlights();
}

// Check auth state on initialization
function checkInitialAuthState() {
  chrome.runtime.sendMessage({ action: 'getAuthState' }, (response) => {
    if (response && response.user) {
      currentUser = response.user;
    }
  });
}

// Load highlights on page load (without opening popover)
async function loadPageHighlights() {
  // Request comments from background script
  chrome.runtime.sendMessage({ 
    action: 'getPageComments', 
    url: window.location.href 
  }, (response) => {
    if (response && response.comments) {
      pageComments = response.comments;
      // Apply highlights for all comments
      response.comments.forEach(comment => {
        applyHighlight(comment.anchor, comment.id);
      });
    }
  });
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggleAuthPopover') {
    // Update current user if provided
    if (request.user) {
      currentUser = request.user;
    }
    
    // Check if auth popover is currently open by checking DOM
    const authOverlay = document.getElementById('mercurius-auth-overlay');
    const isOpen = !!authOverlay;
    
    if (isOpen) {
      // Popover is open, close it
      removeAuthPopover();
    } else {
      // Popover is closed, open it
      createAuthPopover();
      // Pass auth state to the auth popover
      setTimeout(() => {
        if (authPopoverIframe) {
          authPopoverIframe.contentWindow.postMessage({
            type: 'authStateUpdate',
            user: request.user,
            isAuthenticated: request.isAuthenticated
          }, '*');
        }
      }, 500);
    }
  }
  
  if (request.action === 'userAuthenticated') {
    currentUser = request.user;
    updatePopoverAuth();
    // User is authenticated, no need to show auth popover
    removeAuthPopover();
  }
  
  if (request.action === 'authStateChanged') {
    currentUser = request.user;
    updatePopoverAuth();
  }
  
  if (request.action === 'commentsUpdated') {
    // Refresh highlights when comments are updated
    pageComments = request.comments;
    refreshHighlights();
  }
  
  if (request.action === 'updateHighlightVisibility') {
    // Update highlight visibility based on setting
    const highlightElements = document.querySelectorAll('.mercurius-highlight');
    highlightElements.forEach(el => {
      el.style.display = request.showHighlights ? '' : 'none';
    });
  }
  
  if (request.action === 'openCommentFromNotification') {
    // Open popover for a specific comment from notification
    const { commentId, anchor } = request;
    
    // Wait for page to be ready
    setTimeout(() => {
      // Find or create the highlight for this comment
      if (anchor) {
        applyHighlight(anchor, commentId);
      }
      
      // Open the popover
      createPopover(window.innerWidth - 420, 100);
      
      // Send the anchor and page info to popover
      setTimeout(() => {
        if (popoverIframe) {
          popoverIframe.contentWindow.postMessage({
            type: 'pageLoaded',
            url: window.location.href,
            anchor: anchor
          }, '*');
          
          // Scroll to the specific comment
          if (commentId) {
            popoverIframe.contentWindow.postMessage({
              type: 'scrollToCommentInList',
              commentId: commentId
            }, '*');
          }
        }
      }, 500);
    }, 1000); // Give page time to fully load
  }
});

// Create and inject popover at specific position
function createPopover(x, y) {
  if (popoverIframe) {
    // If popover exists, just show it
    const overlay = document.getElementById('mercurius-comment-overlay');
    const container = document.getElementById('mercurius-popover-container');
    if (overlay && container) {
      overlay.style.display = 'block';
      container.style.display = 'block';
      positionPopover(container, x, y);
    }
    return;
  }
  
  // Create dim overlay for comment popover
  const overlay = document.createElement('div');
  overlay.id = 'mercurius-comment-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.3);
    z-index: 999996;
    cursor: pointer;
  `;
  
  // Create iframe container
  const container = document.createElement('div');
  container.id = 'mercurius-popover-container';
  container.style.cssText = `
    position: fixed;
    width: 400px;
    height: 600px;
    z-index: 999997;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    border-radius: 8px;
    overflow: hidden;
  `;
  
  // Position the popover
  positionPopover(container, x, y);
  
  // Create iframe
  popoverIframe = document.createElement('iframe');
  popoverIframe.id = 'mercurius-popover';
  popoverIframe.src = chrome.runtime.getURL('popover/popover.html');
  popoverIframe.style.cssText = `
    width: 100%;
    height: 100%;
    border: none;
    background: white;
    border-radius: 8px;
  `;
  
  // Add click handler to overlay to close popover
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      removePopover();
    }
  });
  
  container.appendChild(popoverIframe);
  document.body.appendChild(overlay);
  document.body.appendChild(container);
  
  // Load comments for current page
  loadPageComments();
}

// Position popover intelligently based on available space
function positionPopover(container, x, y) {
  const width = 400;
  const height = 600;
  const padding = 20;
  
  // Default position (try to show to the right of the selection)
  let left = x || window.innerWidth - width - padding;
  let top = y || window.innerHeight / 2 - height / 2;
  
  // Adjust if would go off screen
  if (left + width + padding > window.innerWidth) {
    // Show to the left instead
    left = Math.max(padding, x - width - padding);
  }
  
  if (top + height + padding > window.innerHeight) {
    // Adjust top position
    top = Math.max(padding, window.innerHeight - height - padding);
  }
  
  if (top < padding) {
    top = padding;
  }
  
  container.style.left = `${left}px`;
  container.style.top = `${top}px`;
}

// Remove popover
function removePopover() {
  const overlay = document.getElementById('mercurius-comment-overlay');
  const container = document.getElementById('mercurius-popover-container');
  if (overlay) {
    overlay.remove();
  }
  if (container) {
    container.remove();
    popoverIframe = null;
  }
}

// Create and inject auth popover
function createAuthPopover() {
  if (authPopoverIframe) return;
  
  // Create dim overlay
  const overlay = document.createElement('div');
  overlay.id = 'mercurius-auth-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 999998;
    cursor: pointer;
  `;
  
  // Create iframe container
  const container = document.createElement('div');
  container.id = 'mercurius-auth-container';
  container.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 420px;
    height: 580px;
    z-index: 999999;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    border-radius: 12px;
    overflow: hidden;
  `;
  
  // Create iframe
  authPopoverIframe = document.createElement('iframe');
  authPopoverIframe.id = 'mercurius-auth';
  authPopoverIframe.src = chrome.runtime.getURL('auth/auth.html');
  authPopoverIframe.style.cssText = `
    width: 100%;
    height: 100%;
    border: none;
    background: white;
    border-radius: 8px;
  `;
  
  // Add click handler to overlay to close popover
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      removeAuthPopover();
    }
  });
  
  container.appendChild(authPopoverIframe);
  document.body.appendChild(overlay);
  document.body.appendChild(container);
}

// Remove auth popover
function removeAuthPopover() {
  const overlay = document.getElementById('mercurius-auth-overlay');
  const container = document.getElementById('mercurius-auth-container');
  if (overlay) {
    overlay.remove();
  }
  if (container) {
    container.remove();
    authPopoverIframe = null;
  }
}

// Update popover with auth state
function updatePopoverAuth() {
  if (popoverIframe) {
    popoverIframe.contentWindow.postMessage({
      type: 'authStateChanged',
      user: currentUser
    }, '*');
  }
}

// Listen for text selection
document.addEventListener('mouseup', handleTextSelection);
document.addEventListener('touchend', handleTextSelection);

function handleTextSelection(event) {
  // Ignore selections in our popover
  if (event.target.closest('#mercurius-popover-container')) return;
  
  // Check if clicking on the comment button FIRST (before other checks)
  if (event.target.id === 'mercurius-comment-button' || 
      event.target.closest('#mercurius-comment-button')) {
    return; // Don't process further if clicking the button
  }
  
  // Check if clicking on a highlight
  const highlightEl = event.target.closest('.mercurius-highlight');
  if (highlightEl) {
    // Get comment IDs from the highlight
    const commentIds = highlightEl.dataset.commentIds?.split(',') || [];
    
    // Get the highlight key to find the anchor
    const highlightKey = highlightEl.dataset.highlightKey;
    
    // Find any comment with matching IDs to get the anchor
    let anchor = null;
    for (const commentId of commentIds) {
      const comment = pageComments.find(c => c.id === commentId);
      if (comment && comment.anchor) {
        anchor = comment.anchor;
        break;
      }
    }
    
    // If we found an anchor, open the popover
    if (anchor) {
      const rect = highlightEl.getBoundingClientRect();
      createPopover(rect.right + 10, rect.top);
      
      // Send the anchor and page info to popover
      setTimeout(() => {
        if (popoverIframe) {
          popoverIframe.contentWindow.postMessage({
            type: 'pageLoaded',
            url: window.location.href,
            anchor: anchor
          }, '*');
        }
      }, 500);
    }
    return;
  }
  
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();
  
  if (selectedText.length > 2) { // Minimum 3 characters
    const range = selection.getRangeAt(0);
    const anchor = createAnchorFromSelection(range, selectedText);
    
    // Show comment button near selection
    showCommentButton(event.pageX, event.pageY, anchor);
  } else {
    // Hide button if there's no selection
    hideCommentButton();
  }
}

// Create anchor data from selection
function createAnchorFromSelection(range, selectedText) {
  // Get the actual selected text and its position in the document
  const startContainer = range.startContainer;
  const endContainer = range.endContainer;
  
  // Find the common ancestor element
  const commonAncestor = range.commonAncestorContainer;
  const element = commonAncestor.nodeType === Node.TEXT_NODE ? 
    commonAncestor.parentElement : commonAncestor;
  
  // Get CSS selector path
  const selector = getElementSelector(element);
  
  // Calculate the exact position by walking through all text nodes
  let currentOffset = 0;
  let actualStartOffset = -1;
  let actualEndOffset = -1;
  
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  let node;
  while (node = walker.nextNode()) {
    const nodeLength = node.textContent.length;
    
    // Check if this is the start container
    if (node === startContainer) {
      actualStartOffset = currentOffset + range.startOffset;
    }
    
    // Check if this is the end container
    if (node === endContainer) {
      actualEndOffset = currentOffset + range.endOffset;
    }
    
    currentOffset += nodeLength;
  }
  
  // If we didn't find the positions, fall back to searching for the text
  if (actualStartOffset === -1 || actualEndOffset === -1) {
    const fullText = element.textContent;
    const textIndex = fullText.indexOf(selectedText);
    if (textIndex !== -1) {
      actualStartOffset = textIndex;
      actualEndOffset = textIndex + selectedText.length;
    }
  }
  
  return {
    url: window.location.href,
    selector: selector,
    selectedText: selectedText,
    startOffset: actualStartOffset,
    endOffset: actualEndOffset,
    timestamp: Date.now()
  };
}

// Get unique CSS selector for element
function getElementSelector(element) {
  const path = [];
  
  while (element && element.nodeType === Node.ELEMENT_NODE) {
    let selector = element.nodeName.toLowerCase();
    
    if (element.id) {
      selector = '#' + element.id;
      path.unshift(selector);
      break;
    } else {
      let sibling = element;
      let nth = 1;
      
      while (sibling.previousElementSibling) {
        sibling = sibling.previousElementSibling;
        if (sibling.nodeName === element.nodeName) nth++;
      }
      
      if (nth > 1) {
        selector += ':nth-of-type(' + nth + ')';
      }
    }
    
    path.unshift(selector);
    element = element.parentElement;
  }
  
  return path.join(' > ');
}

// Show comment button
let commentButton = null;
let currentAnchor = null;

function showCommentButton(x, y, anchor) {
  hideCommentButton();
  
  currentAnchor = anchor;
  
  // Get the selection to position based on selected text
  const selection = window.getSelection();
  if (selection.rangeCount === 0) return;
  
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  
  commentButton = document.createElement('button');
  commentButton.id = 'mercurius-comment-button';
  
  // Create comment icon similar to the reference image
  commentButton.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 6px;">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" fill="currentColor"/>
    </svg>
    Comment
  `;
  commentButton.title = 'Add comment';
  
  // Position based on selected text, not mouse position
  const buttonTop = rect.top + window.pageYOffset - 40;
  const buttonLeft = rect.left + window.pageXOffset + (rect.width / 2) - 50; // Center above selection
  
  commentButton.style.cssText = `
    position: absolute;
    left: ${buttonLeft}px;
    top: ${buttonTop}px;
    z-index: 2147483647;
    background: #2c3e50;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    white-space: nowrap;
  `;
  
  // Add hover effect
  commentButton.addEventListener('mouseenter', () => {
    commentButton.style.background = '#34495e';
    commentButton.style.transform = 'translateY(-2px)';
  });
  
  commentButton.addEventListener('mouseleave', () => {
    commentButton.style.background = '#2c3e50';
    commentButton.style.transform = 'translateY(0)';
  });
  
  commentButton.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  
  commentButton.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    
    // Get position for popover (to the right of the button)
    const rect = commentButton.getBoundingClientRect();
    openCommentDialog(currentAnchor, rect.right + 10, rect.top);
    // Don't hide the button immediately - let it fade out naturally
  });
  
  document.body.appendChild(commentButton);
  
  // Auto-hide after 5 seconds
  setTimeout(() => hideCommentButton(), 5000);
}

function hideCommentButton() {
  if (commentButton) {
    commentButton.remove();
    commentButton = null;
    currentAnchor = null;
  }
}

// Open comment dialog in popover at specific position
function openCommentDialog(anchor, x, y) {
  createPopover(x, y);
  
  // Send anchor data to popover
  setTimeout(() => {
    if (popoverIframe) {
      popoverIframe.contentWindow.postMessage({
        type: 'newComment',
        anchor: anchor
      }, '*');
      
      // Also send page loaded with anchor for filtering
      popoverIframe.contentWindow.postMessage({
        type: 'pageLoaded',
        url: window.location.href,
        anchor: anchor
      }, '*');
    }
  }, 500);
}

// Load and display comments for current page
async function loadPageComments() {
  // This will be implemented with Firestore
  // For now, just notify popover that page loaded
  if (popoverIframe) {
    setTimeout(() => {
      popoverIframe.contentWindow.postMessage({
        type: 'pageLoaded',
        url: window.location.href,
        anchor: currentAnchor // Pass current anchor if available
      }, '*');
    }, 500);
  }
}

// Apply highlight to text
function applyHighlight(anchor, commentId) {
  try {
    const element = document.querySelector(anchor.selector);
    if (!element) return;
    
    // Create a unique key for this highlight based on selector, text, and position
    const highlightKey = `${anchor.selector}::${anchor.startOffset}::${anchor.endOffset}::${anchor.selectedText}`;
    
    // Check if this text position is already highlighted
    if (highlights.has(highlightKey)) {
      // Just add this comment ID to the existing highlight
      const existingCommentIds = highlightToComments.get(highlightKey) || [];
      if (!existingCommentIds.includes(commentId)) {
        existingCommentIds.push(commentId);
        highlightToComments.set(highlightKey, existingCommentIds);
        
        // Update the data attribute on the existing highlight element
        const highlightElement = highlights.get(highlightKey);
        if (highlightElement) {
          highlightElement.dataset.commentIds = existingCommentIds.join(',');
        }
      }
      return;
    }
    
    // Check if highlights are enabled
    chrome.storage.sync.get(['showHighlights'], (result) => {
      const showHighlights = result.showHighlights !== false; // Default to true
      
      // Use the stored offsets to find the exact text
      const fullText = element.textContent;
      
      // Verify that the text at the stored position matches
      const textAtPosition = fullText.substring(anchor.startOffset, anchor.endOffset);
      
      // ONLY use the stored position, don't search for text elsewhere
      let textIndex;
      let textLength = anchor.selectedText.length;
      
      if (textAtPosition === anchor.selectedText) {
        // Perfect match at stored position
        textIndex = anchor.startOffset;
      } else {
        // Position mismatch - don't highlight to avoid wrong text
        console.warn('Text position mismatch, skipping highlight:', {
          expected: anchor.selectedText,
          found: textAtPosition,
          startOffset: anchor.startOffset,
          endOffset: anchor.endOffset
        });
        return;
      }
      
      // Find text node containing the selected text (excluding already highlighted nodes)
      const textNodes = getTextNodesExcludingHighlights(element);
      let targetNode = null;
      let nodeOffset = 0;
      let startOffset = 0;
      let endOffset = 0;
      
      for (const node of textNodes) {
        const nodeText = node.textContent;
        const nodeLength = nodeText.length;
        
        // Check if the selected text starts in this node
        if (nodeOffset <= textIndex && textIndex < nodeOffset + nodeLength) {
          targetNode = node;
          startOffset = textIndex - nodeOffset;
          // Make sure we only highlight the exact length of selected text
          endOffset = Math.min(startOffset + textLength, nodeLength);
          
          // Verify the text matches exactly
          const nodeSelectedText = nodeText.substring(startOffset, endOffset);
          if (!anchor.selectedText.startsWith(nodeSelectedText)) {
            // Text mismatch - skip this highlight
            return;
          }
          break;
        }
        nodeOffset += nodeLength;
      }
      
      if (!targetNode) return;
      
      // Check if this node is already inside a highlight
      let parentNode = targetNode.parentNode;
      while (parentNode && parentNode !== element) {
        if (parentNode.classList && parentNode.classList.contains('mercurius-highlight')) {
          // This text is already highlighted, don't create nested highlight
          return;
        }
        parentNode = parentNode.parentNode;
      }
      
      // Create highlight span
      const highlightSpan = document.createElement('span');
      highlightSpan.className = 'mercurius-highlight';
      highlightSpan.dataset.highlightKey = highlightKey;
      highlightSpan.dataset.commentIds = commentId;
      highlightSpan.title = 'Click to view comments';
      
      // Hide if highlights are disabled
      if (!showHighlights) {
        highlightSpan.style.display = 'none';
      }
      
      // Apply highlight to text range
      const range = document.createRange();
      range.setStart(targetNode, startOffset);
      range.setEnd(targetNode, endOffset);
      
      try {
        range.surroundContents(highlightSpan);
        highlights.set(highlightKey, highlightSpan);
        highlightToComments.set(highlightKey, [commentId]);
      } catch (e) {
        // If surroundContents fails, use alternative method
        const contents = range.extractContents();
        highlightSpan.appendChild(contents);
        range.insertNode(highlightSpan);
        highlights.set(highlightKey, highlightSpan);
        highlightToComments.set(highlightKey, [commentId]);
      }
    });
  } catch (error) {
    console.error('Error applying highlight:', error);
  }
}

// Get all text nodes in element
function getTextNodes(element) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  let node;
  while (node = walker.nextNode()) {
    if (node.textContent.trim()) {
      textNodes.push(node);
    }
  }
  
  return textNodes;
}

// Get text nodes excluding those already inside highlights
function getTextNodesExcludingHighlights(element) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Check if this node is inside a highlight
        let parent = node.parentNode;
        while (parent && parent !== element) {
          if (parent.classList && parent.classList.contains('mercurius-highlight')) {
            return NodeFilter.FILTER_REJECT;
          }
          parent = parent.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    },
    false
  );
  
  let node;
  while (node = walker.nextNode()) {
    if (node.textContent.trim()) {
      textNodes.push(node);
    }
  }
  
  return textNodes;
}

// Remove highlight
function removeHighlight(commentId) {
  // Find which highlight contains this comment
  for (const [highlightKey, commentIds] of highlightToComments.entries()) {
    if (commentIds.includes(commentId)) {
      // Remove this comment ID from the list
      const updatedIds = commentIds.filter(id => id !== commentId);
      
      if (updatedIds.length === 0) {
        // No more comments for this highlight, remove it entirely
        const highlightSpan = highlights.get(highlightKey);
        if (highlightSpan) {
          const parent = highlightSpan.parentNode;
          while (highlightSpan.firstChild) {
            parent.insertBefore(highlightSpan.firstChild, highlightSpan);
          }
          highlightSpan.remove();
        }
        highlights.delete(highlightKey);
        highlightToComments.delete(highlightKey);
      } else {
        // Still have other comments, just update the data attribute
        highlightToComments.set(highlightKey, updatedIds);
        const highlightSpan = highlights.get(highlightKey);
        if (highlightSpan) {
          highlightSpan.dataset.commentIds = updatedIds.join(',');
        }
      }
      break;
    }
  }
}

// Refresh all highlights
function refreshHighlights() {
  // Clear existing highlights
  highlights.forEach((span, key) => {
    if (span && span.parentNode) {
      const parent = span.parentNode;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      span.remove();
    }
  });
  highlights.clear();
  highlightToComments.clear();
  
  // Reapply highlights
  pageComments.forEach(comment => {
    applyHighlight(comment.anchor, comment.id);
  });
}

// Minimize popover to badge
function minimizePopover() {
  const overlay = document.getElementById('mercurius-comment-overlay');
  const container = document.getElementById('mercurius-popover-container');
  if (overlay) {
    overlay.style.display = 'none';
  }
  if (container) {
    container.style.display = 'none';
  }
}

// Restore popover from minimized state
function restorePopover() {
  const overlay = document.getElementById('mercurius-comment-overlay');
  const container = document.getElementById('mercurius-popover-container');
  if (overlay && container) {
    overlay.style.display = 'block';
    container.style.display = 'block';
  } else {
    createPopover();
  }
}

// Listen for messages from popover or auth popover
window.addEventListener('message', (event) => {
  // Handle messages from auth popover
  if (event.source === authPopoverIframe?.contentWindow) {
    if (event.data.type === 'closeAuthPopover') {
      removeAuthPopover();
    }
    return;
  }
  
  // Handle messages from comment popover
  if (event.source !== popoverIframe?.contentWindow) return;
  
  const { type, data } = event.data;
  
  switch (type) {
    case 'applyHighlight':
      applyHighlight(data.anchor, data.commentId);
      // Also add to pageComments if not already there
      if (!pageComments.find(c => c.id === data.commentId)) {
        pageComments.push({ id: data.commentId, anchor: data.anchor });
      }
      break;
    case 'removeHighlight':
      removeHighlight(data.commentId);
      // Remove from pageComments
      pageComments = pageComments.filter(c => c.id !== data.commentId);
      break;
    case 'scrollToComment':
      // Find the highlight that contains this comment
      let targetHighlight = null;
      for (const [highlightKey, commentIds] of highlightToComments.entries()) {
        if (commentIds.includes(data.commentId)) {
          targetHighlight = highlights.get(highlightKey);
          break;
        }
      }
      
      if (targetHighlight) {
        targetHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Flash effect
        targetHighlight.style.animation = 'mercurius-flash 0.5s ease 2';
        setTimeout(() => {
          targetHighlight.style.animation = '';
        }, 1000);
      }
      break;
    case 'closePopover':
      removePopover();
      break;
    case 'minimizePopover':
      minimizePopover();
      break;
    case 'restorePopover':
      restorePopover();
      break;
    case 'openAuthPopover':
      // Close current popover and handle authentication
      removePopover();
      // Trigger authentication through extension action
      chrome.runtime.sendMessage({ action: 'openAuthFlow' });
      break;
  }
});