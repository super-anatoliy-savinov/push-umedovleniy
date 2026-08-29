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

  const { fromUid, toUid, text, type, postId, postTitle } = req.body || {};
  if (!fromUid || !toUid || !text) {
    return res.status(400).json({ error: 'fromUid, toUid и text обязательны' });
  }
  // type: 'group' — сообщение из группового чата повода (нужен postId,
  // чтобы по тапу открыть именно этот чат); иначе — обычный личный чат 1-1.
  const isGroup = type === 'group' && !!postId;

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
    const senderName = sender.name || 'Кто-то';
    const shortText = text.length > 120 ? `${text.slice(0, 120)}…` : text;

    // Более живое оформление push: для группового чата в заголовке — сам
    // повод (чтобы сразу понятно, из какой компании сообщение), а не
    // просто имя автора; для личного чата — имя собеседника с иконкой.
    const title = isGroup ? `👥 ${postTitle || 'Компания'}` : `💬 ${senderName}`;
    const body = isGroup ? `${senderName}: ${shortText}` : shortText;

    try {
      await messaging.send({
        token,
        notification: { title, body },
        data: {
          type: isGroup ? 'group' : 'chat',
          otherUid: fromUid,
          otherName: senderName,
          otherPhotoUrl: sender.photoUrl || '',
          postId: isGroup ? postId : '',
          postTitle: isGroup ? (postTitle || '') : '',
        },
        android: {
          notification: {
            channelId: 'messages_channel',
            // Отдельная иконка группового аватара красивее смотрится, но
            // достаточно и стандартной — главное, чтобы заголовок был
            // информативным (уже решено выше).
          },
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
