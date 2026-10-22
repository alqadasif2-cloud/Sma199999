package com.sami.tradingchallengetracker.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.sami.tradingchallengetracker.MainActivity
import com.sami.tradingchallengetracker.R

class SamiFirebaseMessagingService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "SamiFCM"
        const val CHANNEL_UPDATES_ID = "sami_channel_updates"
        const val CHANNEL_DIRECT_ID = "sami_direct_messages"
        const val CHANNEL_ALERTS_ID = "sami_important_alerts"

        fun createNotificationChannels(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val notificationManager =
                    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

                val updatesChannel = NotificationChannel(
                    CHANNEL_UPDATES_ID,
                    "تحديثات القنوات والمجموعات",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "إشعارات الرسائل الجديدة والتحديثات في قنوات التداول"
                    enableLights(true)
                    enableVibration(true)
                    setShowBadge(true)
                }

                val directChannel = NotificationChannel(
                    CHANNEL_DIRECT_ID,
                    "رسائل القائد Sami والمحادثات الخاصة",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "إشعارات الرسائل الخاصة والمراسلات الفردية مع القائد والمشرفين"
                    enableLights(true)
                    enableVibration(true)
                    setShowBadge(true)
                }

                val alertsChannel = NotificationChannel(
                    CHANNEL_ALERTS_ID,
                    "تنبيهات هامة وتوصيات VIP",
                    NotificationManager.IMPORTANCE_MAX
                ).apply {
                    description = "تنبيهات التداول المستعجلة والإشعارات الرسمية المعتمدة"
                    enableLights(true)
                    enableVibration(true)
                    setShowBadge(true)
                }

                notificationManager.createNotificationChannels(
                    listOf(updatesChannel, directChannel, alertsChannel)
                )
            }
        }
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "New FCM Token received: $token")

        val prefs = getSharedPreferences("sami_app_prefs", Context.MODE_PRIVATE)
        prefs.edit().putString("fcm_token", token).apply()

        val loggedUserId = prefs.getLong("logged_user_id", 0L)
        val loggedUserName = prefs.getString("logged_user_name", "") ?: ""

        if (loggedUserId > 0) {
            syncTokenToFirestore(loggedUserId, loggedUserName, token)
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        Log.d(TAG, "From: ${remoteMessage.from}")

        createNotificationChannels(this)

        val data = remoteMessage.data
        val title = remoteMessage.notification?.title
            ?: data["title"]
            ?: "تطبيق Sami"
        val body = remoteMessage.notification?.body
            ?: data["body"]
            ?: "رسالة جديدة في مجتمع Sami للتداول"

        val channelId = data["channelId"]
        val chatType = data["chatType"] ?: if (channelId.isNullOrEmpty()) "private" else "channel"
        val partnerId = data["partnerId"]?.toLongOrNull()
        val messageId = data["messageId"]

        val targetAndroidChannelId = when {
            data["type"] == "warning" || data["type"] == "kick" -> CHANNEL_ALERTS_ID
            chatType == "private" || title.contains("Sami") -> CHANNEL_DIRECT_ID
            else -> CHANNEL_UPDATES_ID
        }

        sendNotification(title, body, targetAndroidChannelId, channelId, chatType, partnerId, messageId)
    }

    private fun sendNotification(
        title: String,
        body: String,
        notificationChannelId: String,
        targetChannelId: String?,
        chatType: String?,
        partnerId: Long?,
        messageId: String?
    ) {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("target_channel_id", targetChannelId)
            putExtra("target_chat_type", chatType)
            if (partnerId != null) putExtra("target_partner_id", partnerId)
            if (messageId != null) putExtra("target_message_id", messageId)
        }

        val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            System.currentTimeMillis().toInt(),
            intent,
            pendingIntentFlags
        )

        val defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

        val notificationBuilder = NotificationCompat.Builder(this, notificationChannelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setSound(defaultSoundUri)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setColor(0xFFF59E0B.toInt()) // Sami Amber Gold
            .setContentIntent(pendingIntent)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))

        try {
            val notificationManager = NotificationManagerCompat.from(this)
            val notificationId = (System.currentTimeMillis() % 100000).toInt()
            notificationManager.notify(notificationId, notificationBuilder.build())
        } catch (e: SecurityException) {
            Log.w(TAG, "Notification permission not granted: ${e.message}")
        }
    }

    private fun syncTokenToFirestore(userId: Long, username: String, token: String) {
        try {
            val db = FirebaseFirestore.getInstance()
            val deviceId = getSharedPreferences("sami_app_prefs", Context.MODE_PRIVATE)
                .getString("device_id", null) ?: "android_${System.currentTimeMillis()}"

            val docId = "token_${userId}_${deviceId}"
            val payload = hashMapOf(
                "id" to docId,
                "token" to token,
                "userId" to userId,
                "username" to username,
                "deviceId" to deviceId,
                "platform" to "android",
                "deviceModel" to "${Build.MANUFACTURER} ${Build.MODEL}",
                "androidVersion" to Build.VERSION.RELEASE,
                "updatedAt" to System.currentTimeMillis()
            )

            db.collection("user_fcm_tokens").document(docId)
                .set(payload, SetOptions.merge())
                .addOnSuccessListener {
                    Log.d(TAG, "FCM token synced to Firestore for user: $userId")
                }
                .addOnFailureListener { e ->
                    Log.w(TAG, "Error syncing FCM token: ${e.message}")
                }
        } catch (e: Exception) {
            Log.w(TAG, "Firestore sync error: ${e.message}")
        }
    }
}
