// POST /api/notify — вызывается приложением после отправки сообщения в
// чате (см. lib/services/notify_service.dart в Flutter-проекте). Находит
// FCM-токен получателя в Firestore и шлёт push через Firebase Admin SDK.

const { ensureInitialized } = require('../lib/firebase');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      info: 'Это API-эндпоинт для отправки push. Открой корень сайта (/) для диагностики и теста через форму.',
      usage: 'POST { fromUid, toUid, text } с заголовком x-notify-secret',
    });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  let admin;
  try {
    admin = ensureInitialized();
  } catch (e) {
    console.error('Firebase init error:', e.message);
    return res.status(500).json({ error: 'server misconfigured', detail: e.message });
  }

  const SECRET = process.env.NOTIFY_SECRET || '';
  if (!SECRET.trim()) {
    return res.status(500).json({ error: 'server misconfigured', detail: 'NOTIFY_SECRET не задан на сервере' });
  }
  if (req.headers['x-notify-secret'] !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { fromUid, toUid, text } = req.body || {};
  if (!fromUid || !toUid || !text) {
    return res.status(400).json({ error: 'fromUid, toUid и text обязательны' });
  }

  const db = admin.firestore();
  const messaging = admin.messaging();

  try {
    const [senderDoc, recipientDoc] = await Promise.all([
      db.collection('users').doc(fromUid).get(),
      db.collection('users').doc(toUid).get(),
    ]);

    if (!recipientDoc.exists) {
      return res.status(404).json({ error: 'recipient not found', detail: `Нет пользователя users/${toUid}` });
    }

    const recipient = recipientDoc.data();
    const token = recipient.fcmToken;
    if (!token) {
      // Нормальная ситуация: получатель ещё не запускал приложение с этим
      // обновлением, либо не дал разрешение на уведомления.
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
      return res.status(200).json({ sent: true });
    } catch (err) {
      if (err.code === 'messaging/registration-token-not-registered') {
        await db.collection('users').doc(toUid).update({ fcmToken: null });
        return res.status(200).json({ skipped: 'stale token, cleared' });
      }
      console.error('FCM send error:', err);
      return res.status(500).json({ error: 'send failed', detail: err.message, code: err.code });
    }
  } catch (err) {
    console.error('Unexpected /api/notify error:', err);
    return res.status(500).json({ error: 'internal error', detail: err.message });
  }
};
