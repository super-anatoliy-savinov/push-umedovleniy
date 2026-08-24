// Serverless-функция для Vercel — замена server/index.js (Express-сервер
// для Render). Разница: здесь нет своего постоянно работающего процесса —
// Vercel запускает этот код только по запросу и сам выключает после
// ответа, поэтому нет самого понятия "засыпания" и пингер не нужен.
//
// Работает с теми же переменными окружения, что и раньше:
//   FIREBASE_SERVICE_ACCOUNT — весь JSON сервисного аккаунта одной строкой
//   NOTIFY_SECRET            — тот же секрет, что в --dart-define=NOTIFY_SECRET
//
// Приложению НИЧЕГО менять не нужно — это тот же самый POST /notify с тем
// же телом запроса, просто на другом домене (вместо
// https://push-umedovleniy.onrender.com будет что-то вроде
// https://твой-проект.vercel.app).

const admin = require('firebase-admin');

// Firebase Admin инициализируем ОДИН раз и переиспользуем между вызовами
// (Vercel может "разогревать" контейнер между запросами) — если сделать
// это внутри handler на каждый вызов, будет ошибка "app already exists".
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
const messaging = admin.messaging();
const SECRET = process.env.NOTIFY_SECRET || '';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  if (!SECRET || req.headers['x-notify-secret'] !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { fromUid, toUid, text } = req.body || {};
  if (!fromUid || !toUid || !text) {
    return res.status(400).json({ error: 'fromUid, toUid и text обязательны' });
  }

  try {
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
      return res.status(200).json({ sent: true });
    } catch (err) {
      if (err.code === 'messaging/registration-token-not-registered') {
        await db.collection('users').doc(toUid).update({ fcmToken: null });
        return res.status(200).json({ skipped: 'stale token, cleared' });
      }
      console.error('FCM send error:', err);
      return res.status(500).json({ error: 'send failed' });
    }
  } catch (err) {
    console.error('Unexpected error in /api/notify:', err);
    return res.status(500).json({ error: 'internal error' });
  }
};