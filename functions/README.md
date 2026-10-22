# Sami Trading Challenge Tracker - Cloud Functions

## Functionality
1. **`onChatMessageCreated`**: Automatic Firestore trigger that executes when a new message is posted to `chat_messages/{messageId}`.
   - Determines channel visibility.
   - For hidden channels (`visibility === 'hidden'`), filters recipients to only `allowedMemberIds`.
   - Sends multicast FCM push notifications to active devices.
   - Cleans up dead/unregistered tokens.
2. **`onPrivateMessageCreated`**: Triggers when a 1-on-1 private message is saved in `private_messages/{messageId}`.
   - Sends targeted FCM notification to `receiverId`.
   - Includes deep link data (`chatType: 'private'`, `partnerId`, `messageId`).
3. **`onUserWarningCreated`**: Triggers when a moderator/owner issues a warning or kick in `user_warnings/{warningId}`.
   - Sends urgent alert to `targetUserId` via Android notification channel `sami_important_alerts`.

## Deployment
To deploy these functions to your Firebase project:
```bash
firebase deploy --only functions
```
