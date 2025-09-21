// Text selector utilities for finding and restoring text selections

import { UI_CONFIG } from './firebase-config.js';

// Generate unique hash for anchor
export function generateAnchorId(anchor) {
  const str = `${anchor.url}|${anchor.selector}|${anchor.selectedText}|${anchor.startOffset}|${anchor.endOffset}`;
  return hashString(str);
}

// Simple string hash function
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

// Find element and text position from anchor data
export function findTextFromAnchor(anchor) {
  // First try: exact selector match
  let element = document.querySelector(anchor.selector);
  
  if (element) {
    const match = findTextInElement(element, anchor);
    if (match) return match;
  }
  
  // Second try: fuzzy search with context
  return fuzzyFindText(anchor);
}

// Find text within a specific element
function findTextInElement(element, anchor) {
  const fullText = element.textContent;
  const { selectedText, contextBefore, contextAfter, startOffset, endOffset } = anchor;
  
  // Try exact offset match first
  if (fullText.substring(startOffset, endOffset) === selectedText) {
    return {
      element,
      startOffset,
      endOffset,
      confidence: 1.0
    };
  }
  
  // Try context-based search
  const searchPattern = contextBefore + selectedText + contextAfter;
  const patternIndex = fullText.indexOf(searchPattern);
  
  if (patternIndex !== -1) {
    const newStartOffset = patternIndex + contextBefore.length;
    const newEndOffset = newStartOffset + selectedText.length;
    
    return {
      element,
      startOffset: newStartOffset,
      endOffset: newEndOffset,
      confidence: 0.9
    };
  }
  
  // Try just selected text
  const textIndex = fullText.indexOf(selectedText);
  if (textIndex !== -1) {
    // Verify with partial context
    const foundContextBefore = fullText.substring(
      Math.max(0, textIndex - UI_CONFIG.CONTEXT_CHARS),
      textIndex
    );
    const foundContextAfter = fullText.substring(
      textIndex + selectedText.length,
      Math.min(fullText.length, textIndex + selectedText.length + UI_CONFIG.CONTEXT_CHARS)
    );
    
    const contextMatch = calculateSimilarity(
      contextBefore + contextAfter,
      foundContextBefore + foundContextAfter
    );
    
    if (contextMatch > 0.7) {
      return {
        element,
        startOffset: textIndex,
        endOffset: textIndex + selectedText.length,
        confidence: contextMatch
      };
    }
  }
  
  return null;
}

// Fuzzy search across the document
function fuzzyFindText(anchor) {
  const { selectedText, contextBefore, contextAfter } = anchor;
  const searchPattern = contextBefore + selectedText + contextAfter;
  
  // Search all text nodes in the document
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  let bestMatch = null;
  let bestScore = 0;
  
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    
    // Skip our own UI elements
    if (parent.closest('#mercurius-sidebar-container')) continue;
    
    const text = node.textContent;
    const index = text.indexOf(selectedText);
    
    if (index !== -1) {
      const foundContextBefore = text.substring(
        Math.max(0, index - UI_CONFIG.CONTEXT_CHARS),
        index
      );
      const foundContextAfter = text.substring(
        index + selectedText.length,
        Math.min(text.length, index + selectedText.length + UI_CONFIG.CONTEXT_CHARS)
      );
      
      const score = calculateSimilarity(
        searchPattern,
        foundContextBefore + selectedText + foundContextAfter
      );
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          element: parent,
          node: node,
          startOffset: index,
          endOffset: index + selectedText.length,
          confidence: score
        };
      }
    }
  }
  
  return bestMatch;
}

// Calculate similarity between two strings (0-1)
function calculateSimilarity(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  
  if (len1 === 0 && len2 === 0) return 1;
  if (len1 === 0 || len2 === 0) return 0;
  
  // Levenshtein distance
  const matrix = [];
  
  for (let i = 0; i <= len2; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= len1; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= len2; i++) {
    for (let j = 1; j <= len1; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  const distance = matrix[len2][len1];
  const maxLen = Math.max(len1, len2);
  
  return 1 - (distance / maxLen);
}

// Create Range object from anchor match
export function createRangeFromMatch(match) {
  const range = document.createRange();
  
  if (match.node) {
    // Text node match
    range.setStart(match.node, match.startOffset);
    range.setEnd(match.node, match.endOffset);
  } else {
    // Element match - need to find text nodes
    const textNodes = getTextNodesInElement(match.element);
    let currentOffset = 0;
    let startSet = false;
    
    for (const node of textNodes) {
      const nodeLength = node.textContent.length;
      
      if (!startSet && currentOffset + nodeLength >= match.startOffset) {
        range.setStart(node, match.startOffset - currentOffset);
        startSet = true;
      }
      
      if (currentOffset + nodeLength >= match.endOffset) {
        range.setEnd(node, match.endOffset - currentOffset);
        break;
      }
      
      currentOffset += nodeLength;
    }
  }
  
  return range;
}

// Get all text nodes in element
function getTextNodesInElement(element) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }
  
  return textNodes;
}

// Validate anchor against current page content
export function validateAnchor(anchor) {
  const match = findTextFromAnchor(anchor);
  
  if (!match) {
    return { valid: false, confidence: 0 };
  }
  
  return {
    valid: match.confidence > 0.5,
    confidence: match.confidence,
    element: match.element,
    range: createRangeFromMatch(match)
  };
}