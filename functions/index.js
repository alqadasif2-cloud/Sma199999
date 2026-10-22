/**
 * Cloud Functions for Sami Trading Challenge Tracker
 * Server-authoritative FCM Push Notifications & Real-Time Sync
 *
 * Supported Triggers:
 * 1. onChatMessageCreated: Dispatches push notification for channel messages to authorized members.
 *    - Strictly protects hidden channels: only members in allowedMemberIds receive notification.
 * 2. onPrivateMessageCreated: Dispatches push notification for 1-on-1 private messages to recipient.
 * 3. onUserWarningCreated: Dispatches urgent alert push notification for moderator warnings / kicks.
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const messaging = admin.messaging();

/**
 * Helper to fetch valid active device tokens for a list of user IDs.
 */
async function getDeviceTokensForUsers(userIds) {
  if (!userIds || userIds.length === 0) return [];
  const uniqueUids = Array.from(new Set(userIds)).filter((id) => Number(id) > 0);
  if (uniqueUids.length === 0) return [];

  // Firestore "in" queries allow max 30 items per batch
  const batches = [];
  for (let i = 0; i < uniqueUids.length; i += 25) {
    batches.push(uniqueUids.slice(i, i + 25));
  }

  const tokens = [];
  for (const batch of batches) {
    const snap = await db
      .collection('user_fcm_tokens')
      .where('userId', 'in', batch)
      .get();

    snap.forEach((doc) => {
      const data = doc.data();
      if (data && data.token && typeof data.token === 'string') {
        tokens.push({
          docId: doc.id,
          token: data.token,
          userId: data.userId,
        });
      }
    });
  }

  return tokens;
}

/**
 * Remove invalid/unregistered FCM tokens to prevent stale delivery attempts.
 */
async function cleanupInvalidTokens(invalidDocIds) {
  if (!invalidDocIds || invalidDocIds.length === 0) return;
  const batch = db.batch();
  invalidDocIds.forEach((id) => {
    batch.delete(db.collection('user_fcm_tokens').document(id));
  });
  try {
    await batch.commit();
  } catch (err) {
    console.warn('Failed to cleanup invalid tokens:', err);
  }
}

/**
 * Trigger: On New Channel Message Created
 */
exports.onChatMessageCreated = onDocumentCreated(
  {
    document: 'chat_messages/{messageId}',
    region: 'europe-west2',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const msg = snap.data();
    if (!msg || !msg.channelId || !msg.senderId) return;

    // Load channel details to check visibility and membership
    const channelDoc = await db.collection('community_channels').document(msg.channelId).get();
    if (!channelDoc.exists) return;
    const channel = channelDoc.data();

    // Determine authorized recipients
    let recipientPool = [];
    if (channel.visibility === 'hidden') {
      recipientPool = channel.allowedMemberIds || channel.memberIds || [];
    } else {
      recipientPool = channel.memberIds || [];
    }

    // Exclude the sender
    const targetUserIds = recipientPool
      .map((id) => Number(id))
      .filter((id) => id > 0 && id !== Number(msg.senderId));

    if (targetUserIds.length === 0) return;

    const deviceRecords = await getDeviceTokensForUsers(targetUserIds);
    if (deviceRecords.length === 0) return;

    const rolePrefix =
      Number(msg.senderId) === 1
        ? '👑 القائد Sami'
        : msg.senderRole === 'moderator'
        ? `🛡️ المشرف ${msg.senderName}`
        : msg.senderName || 'متداول';

    const notifBody = msg.fileName
      ? `📎 ملف مرفق: ${msg.fileName}`
      : msg.imageUrl
      ? '📷 صورة'
      : (msg.text || 'رسالة جديدة في القناة');

    const messagePayload = {
      notification: {
        title: `${rolePrefix} • ${channel.name || 'قناة تداول'}`,
        body: notifBody,
      },
      data: {
        chatType: 'channel',
        channelId: String(msg.channelId),
        messageId: String(msg.id || event.params.messageId),
        senderId: String(msg.senderId),
        senderName: String(msg.senderName || ''),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'sami_channel_updates',
          sound: 'default',
          color: '#F59E0B',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: deviceRecords.map((d) => d.token),
    };

    try {
      const response = await messaging.sendEachForMulticast(messagePayload);
      const invalidDocIds = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered'
          ) {
            invalidDocIds.push(deviceRecords[idx].docId);
          }
        }
      });
      if (invalidDocIds.length > 0) {
        await cleanupInvalidTokens(invalidDocIds);
      }
    } catch (err) {
      console.error('Error sending multicast FCM for channel message:', err);
    }
  }
);

/**
 * Trigger: On New Private Message Created
 */
exports.onPrivateMessageCreated = onDocumentCreated(
  {
    document: 'private_messages/{messageId}',
    region: 'europe-west2',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const msg = snap.data();
    if (!msg || !msg.receiverId || !msg.senderId) return;

    const receiverId = Number(msg.receiverId);
    if (!receiverId || receiverId <= 0) return;

    const deviceRecords = await getDeviceTokensForUsers([receiverId]);
    if (deviceRecords.length === 0) return;

    const notifTitle =
      Number(msg.senderId) === 1
        ? '👑 رسالة خاصة من القائد Sami'
        : msg.isReport
        ? `📋 تقرير إداري من المشرف ${msg.senderName}`
        : `💬 رسالة خاصة من ${msg.senderName}`;

    const notifBody = msg.fileName
      ? `📎 ملف مرفق: ${msg.fileName}`
      : msg.imageUrl
      ? '📷 صورة'
      : (msg.text || 'رسالة خاصة جديدة');

    const messagePayload = {
      notification: {
        title: notifTitle,
        body: notifBody,
      },
      data: {
        chatType: 'private',
        partnerId: String(msg.senderId),
        senderId: String(msg.senderId),
        receiverId: String(receiverId),
        messageId: String(msg.id || event.params.messageId),
        senderName: String(msg.senderName || ''),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'sami_direct_messages',
          sound: 'default',
          color: '#F59E0B',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: deviceRecords.map((d) => d.token),
    };

    try {
      const response = await messaging.sendEachForMulticast(messagePayload);
      const invalidDocIds = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered'
          ) {
            invalidDocIds.push(deviceRecords[idx].docId);
          }
        }
      });
      if (invalidDocIds.length > 0) {
        await cleanupInvalidTokens(invalidDocIds);
      }
    } catch (err) {
      console.error('Error sending multicast FCM for private message:', err);
    }
  }
);

/**
 * Trigger: On User Warning / Kick Action Created
 */
exports.onUserWarningCreated = onDocumentCreated(
  {
    document: 'user_warnings/{warningId}',
    region: 'europe-west2',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const warning = snap.data();
    if (!warning || !warning.targetUserId) return;

    const targetUserId = Number(warning.targetUserId);
    if (!targetUserId || targetUserId <= 0) return;

    const deviceRecords = await getDeviceTokensForUsers([targetUserId]);
    if (deviceRecords.length === 0) return;

    const isKick = warning.action === 'kick';
    const notifTitle = isKick
      ? '⚠️ إشعار إداري: تم استبعادك من القناة'
      : '⚠️ تنبيه إداري رسمي من المشرف';
    const notifBody = warning.reason ? `السبب: ${warning.reason}` : 'يرجى مراجعة إدارة القناة';

    const messagePayload = {
      notification: {
        title: notifTitle,
        body: notifBody,
      },
      data: {
        type: isKick ? 'kick' : 'warning',
        channelId: String(warning.channelId || ''),
        warningId: String(warning.id || event.params.warningId),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'sami_important_alerts',
          sound: 'default',
          color: '#EF4444',
        },
      },
      tokens: deviceRecords.map((d) => d.token),
    };

    try {
      await messaging.sendEachForMulticast(messagePayload);
    } catch (err) {
      console.error('Error sending FCM warning notification:', err);
    }
  }
);
