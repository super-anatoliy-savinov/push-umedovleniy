/**
 * Бесплатный сервер push-уведомлений — замена Cloud Functions.
 * -----------------------------------------------------------------------
 * ПОЧЕМУ ЭТОТ ФАЙЛ ВООБЩЕ СУЩЕСТВУЕТ:
 * Firebase Cloud Functions (папка functions/, которую я делал раньше)
 * требует платный план Blaze — это ограничение именно Firebase, а не
 * FCM (Firebase Cloud Messaging) как таковой. Сам FCM бесплатен всегда,
 * без ограничений и без привязки карты. Ограничение только в том, ГДЕ
 * выполняется код, который вызывает FCM Send — Google требует, чтобы это
 * был сервер с Firebase Admin SDK. Cloud Functions — не единственный
 * вариант такого сервера, просто самый "встроенный".
 *
 * Этот файл — точно такой же сервер, просто на ОБЫЧНОМ бесплатном хостинге
 * (Render, как ты уже используешь для ChallengeForge и других проектов) —
 * никакого Blaze, никакой привязанной карты, полностью бесплатно.
 *
 * Как это работает:
 * 1. Приложение (см. lib/services/notify_service.dart) после отправки
 *    любого сообщения в чат делает обычный HTTP-запрос на этот сервер.
 * 2. Сервер проверяет секретный ключ (чтобы им не мог пользоваться
 *    кто попало), берёт FCM-токен получателя из Firestore (через Firebase
 *    Admin SDK — ключ сервисного аккаунта тоже бесплатный, доступен на
 *    любом плане, включая бесплатный Spark) и отправляет push.
 *
 * Деплой — см. server/README.md.
 */

const express = require('express');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const messaging = admin.messaging();

const app = express();
app.use(express.json());

const SECRET = process.env.NOTIFY_SECRET || '';

app.get('/', (req, res) => res.send('Kompaniya push relay is running'));

app.post('/notify', async (req, res) => {
  try {
    if (!SECRET || req.headers['x-notify-secret'] !== SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const { fromUid, toUid, text } = req.body;
    if (!fromUid || !toUid || !text) {
      return res.status(400).json({ error: 'fromUid, toUid и text обязательны' });
    }

    const [senderDoc, recipientDoc] = await Promise.all([
      db.collection('users').doc(fromUid).get(),
      db.collection('users').doc(toUid).get(),
    ]);

    if (!recipientDoc.exists) {
      return res.status(404).json({ error: 'recipient not found' });
    }

    const recipient = recipientDoc.data();
    const token = recipient.fcmToken;
    if (!token) {
      return res.status(200).json({ skipped: 'no fcm token' });
    }

    const sender = senderDoc.exists ? senderDoc.data() : {};
    const shortText = text.length > 120 ? `${text.slice(0, 120)}…` : text;

    try {
      await messaging.send({
        token,
        notification: {
          title: sender.name || 'Новое сообщение',
          body: shortText,
        },
        data: {
          type: 'chat',
          otherUid: fromUid,
          otherName: sender.name || '',
          otherPhotoUrl: sender.photoUrl || '',
        },
        android: {
          notification: { channelId: 'messages_channel' },
        },
      });
      return res.json({ sent: true });
    } catch (err) {
      if (err.code === 'messaging/registration-token-not-registered') {
        await db.collection('users').doc(toUid).update({ fcmToken: null });
        return res.status(200).json({ skipped: 'stale token, cleared' });
      }
      console.error('FCM send error:', err);
      return res.status(500).json({ error: 'send failed' });
    }
  } catch (err) {
    console.error('Unexpected error in /notify:', err);
    return res.status(500).json({ error: 'internal error' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Push relay listening on port ${port}`));
