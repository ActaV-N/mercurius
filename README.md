# Mercurius - Web Comment Extension

A Chrome extension that allows users to leave and view comments on any text selection across the web. Comments are shared with other users and the commented text is highlighted.

## Features

- 💬 Comment on any text selection on any website
- 👥 Share comments with other extension users
- 🔍 Smart text anchoring with context preservation
- 📍 Highlighted commented text
- 👍 Upvote/downvote and emoji reactions
- 🔐 Google Sign-In authentication
- 🔄 Real-time comment synchronization

## Setup Instructions

### 1. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select an existing one
3. Enable **Authentication**:
   - Go to Authentication > Sign-in method
   - Enable Google provider
4. Enable **Firestore Database**:
   - Go to Firestore Database
   - Click "Create database"
   - Choose **Standard version** (not Enterprise version)
     - Standard is perfect for this use case (up to 1MiB document size)
     - Enterprise is for MongoDB compatibility and larger documents (4MiB)
   - Choose **Start in production mode** (for security rules)
   - Select your preferred location (closest to your users)
   - Click "Continue" or "Next"
   - After creation, go to the "Rules" tab and replace with these security rules:
   ```javascript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       // Allow users to read all comments
       match /comments/{document=**} {
         allow read: if true;
         allow create: if request.auth != null;
         allow update: if request.auth != null;
         allow delete: if request.auth != null && request.auth.uid == resource.data.userId;
       }
       
       // Allow users to manage their own user data
       match /users/{userId} {
         allow read: if true;
         allow write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

5. Get your Firebase configuration:
   - Go to Project Settings > General
   - Scroll to "Your apps" and click "Add app" > Web
   - Register app and copy the configuration

### 2. Extension Configuration

1. Update `lib/firebase-config.js` with your Firebase configuration:
```javascript
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

2. Set up OAuth2 for Chrome Extension:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Select your Firebase project
   - Go to APIs & Services > Credentials
   - Create OAuth 2.0 Client ID
   - Application type: Chrome Extension
   - Add your extension ID (you'll get this after loading the extension)

### 3. Install Extension & Get Extension ID

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the Mercurius project folder
5. **Find your Extension ID**: After loading, you'll see your extension card with an ID like:
   - Example: `abcdefghijklmnopqrstuvwxyzabcdef`
   - Copy this ID (you'll need it for OAuth setup)

### 4. Update OAuth Configuration

1. Go back to Google Cloud Console
2. Edit your OAuth 2.0 Client ID
3. Add your extension ID to the authorized Chrome extension
4. Update manifest.json with the OAuth client ID if needed

## Usage

1. **Sign In**: Click the extension icon and sign in with Google
2. **Select Text**: Highlight any text on a webpage
3. **Add Comment**: Click the 💬 button that appears near your selection
4. **View Comments**: Click the extension icon to open the sidebar
5. **Interact**: Upvote, downvote, or add reactions to comments

## Project Structure

```
Mercurius/
├── manifest.json           # Extension manifest
├── background.js          # Service worker for Firebase
├── content.js             # Content script for text selection
├── lib/
│   ├── firebase-config.js # Firebase configuration
│   └── text-selector.js   # Text anchoring utilities
├── sidebar/
│   ├── sidebar.html       # Sidebar UI
│   ├── sidebar.js         # Sidebar functionality
│   └── sidebar.css        # Sidebar styles
├── styles/
│   └── highlights.css     # Highlight styles
└── assets/
    └── icons/             # Extension icons
```

## Technical Details

### Text Anchoring System
The extension uses a robust text anchoring system that stores:
- CSS selector path to the element
- Selected text
- Character offsets (start/end)
- Context before and after (20 chars each)

This allows the extension to accurately find and highlight commented text even if the page structure changes slightly.

### Data Structure
Comments are stored in Firestore with the following structure:
```javascript
{
  url: "page URL",
  anchor: {
    selector: "CSS selector",
    selectedText: "selected text",
    startOffset: 10,
    endOffset: 25,
    contextBefore: "text before",
    contextAfter: "text after"
  },
  text: "comment text",
  userId: "user ID",
  userName: "display name",
  userPhoto: "avatar URL",
  timestamp: Timestamp,
  upvotes: ["userId1", "userId2"],
  downvotes: ["userId3"],
  reactions: {
    "👍": ["userId1"],
    "❤️": ["userId2"]
  }
}
```

## Development

To modify and test the extension:
1. Make your changes
2. Go to `chrome://extensions/`
3. Click the refresh icon on the Mercurius extension card
4. Test your changes

## Troubleshooting

- **Sign-in not working**: Check OAuth2 configuration and extension ID
- **Comments not saving**: Check Firestore security rules and Firebase configuration
- **Highlights not showing**: Ensure content script is loaded (refresh the page)
- **Sidebar not opening**: Check console for errors, ensure proper permissions

## License

MIT