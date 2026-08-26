// GET /api/status — используется главной страницей сайта (index.html) для
// живой диагностики: сервер отвечает, Firebase Admin проинициализировался,
// NOTIFY_SECRET задан. Ничего секретного не возвращает (сам ключ/секрет
// наружу не отдаёт, только факт "настроено / не настроено").

const { checkConfig } = require('../lib/firebase');

module.exports = (req, res) => {
  const status = checkConfig();
  res.status(200).json({
    server: 'ok',
    time: new Date().toISOString(),
    firebase: status.firebaseOk ? 'connected' : 'error',
    projectId: status.projectId || null,
    notifySecretConfigured: status.secretSet,
    error: status.error || null,
  });
};
