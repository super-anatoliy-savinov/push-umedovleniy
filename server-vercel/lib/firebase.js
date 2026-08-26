// Общая инициализация Firebase Admin — используется и в /api/notify, и в
// /api/status. Живёт ВНЕ папки api/, чтобы Vercel не считал этот файл
// отдельным маршрутом (роутами становится только то, что лежит прямо в api/).

const admin = require('firebase-admin');

let cachedProjectId = null;

// Разбирает FIREBASE_SERVICE_ACCOUNT максимально терпимо к типичным
// ошибкам копипаста в веб-форму Vercel:
//  1) обычный валидный JSON одной строкой — просто парсим;
//  2) если внутри private_key настоящие переносы строк "съели" \n и JSON
//     стал невалидным — пробуем восстановить, заменив реальные переносы
//     строк на экранированные \n перед повторным парсингом.
function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw.trim()) {
    throw new Error('Переменная окружения FIREBASE_SERVICE_ACCOUNT не задана (или пустая) в настройках проекта на Vercel');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    try {
      parsed = JSON.parse(raw.replace(/\r?\n/g, '\\n'));
    } catch (e2) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT не является валидным JSON (${e.message}). ` +
        'Скорее всего при вставке в поле на Vercel переносы строк внутри private_key ' +
        'превратились в настоящие — вставь JSON целиком одной строкой, как он есть в скачанном файле.'
      );
    }
  }

  if (!parsed.project_id || !parsed.private_key || !parsed.client_email) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT распарсился как JSON, но это не похоже на ключ сервисного аккаунта ' +
      '(нет project_id / private_key / client_email) — проверь, что скопировал файл целиком.'
    );
  }
  return parsed;
}

function ensureInitialized() {
  if (!admin.apps.length) {
    const serviceAccount = parseServiceAccount();
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    cachedProjectId = serviceAccount.project_id;
  }
  return admin;
}

// Проверка конфигурации без выброса исключения — используется в /api/status,
// чтобы страница диагностики могла показать ПОНЯТНУЮ причину, а не просто
// "не работает".
function checkConfig() {
  const secretSet = !!(process.env.NOTIFY_SECRET && process.env.NOTIFY_SECRET.trim());
  try {
    ensureInitialized();
    return { firebaseOk: true, projectId: cachedProjectId, secretSet };
  } catch (e) {
    return { firebaseOk: false, error: e.message, secretSet };
  }
}

module.exports = { admin, ensureInitialized, checkConfig };
