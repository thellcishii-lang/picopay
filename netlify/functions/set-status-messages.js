// Sets the wording PicoPay shows for each service status. Called by the AI
// Console — never from a browser.
//
// The text lives in the database rather than in the code so it can be
// changed without a rewrite and a deploy. Two levels:
//
//   storeId given   → only that store
//   storeId omitted → the shared default every store falls back to
//
// PicoPay reads the store's own text first and falls back to the shared one,
// so a店舗-specific override doesn't have to repeat everything.
//
// Omitting storeId changes what every store shows at once. This function
// will do it — that's the point of having a shared default — but the AI
// Console is expected to confirm with a human before sending a call with no
// storeId (2026-08-06 decision). The guard belongs on the hub side, where a
// person is in the conversation.
//
// Protected by CREATE_STORE_SECRET, same as the other AI Console endpoints.
const admin = require("firebase-admin");

const DATABASE_URL =
  "https://picopay-5a53e-default-rtdb.asia-southeast1.firebasedatabase.app";

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL,
  });
}

// 書き換えられる文言。キーはそのまま画面のどこに出るかに対応する。
const FIELDS = [
  "warningStore", // 店舗の概況に出す⚠️の文言
  "suspendedStore", // 停止中に店舗画面に出す文言
  "suspendedCustomer", // 停止中にお客様画面に出す文言
  "terminatedStore", // 廃止後に店舗画面(ログイン不可時)に出す文言
  "terminatedCustomer", // 廃止後にお客様画面に出す文言
];

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "POSTで呼び出してください" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "リクエストの形式が不正です" }) };
  }

  if (body.secret !== process.env.CREATE_STORE_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: "認証できませんでした" }) };
  }

  const { storeId = null, messages } = body;
  if (!messages || typeof messages !== "object") {
    return { statusCode: 400, body: JSON.stringify({ error: "messages が必要です" }) };
  }

  const updates = {};
  const applied = [];
  for (const key of FIELDS) {
    if (!(key in messages)) continue;
    const value = messages[key];
    // null を渡すと、その項目だけ共通の文言に戻る(店舗ごとの上書きを外す)。
    const path = storeId
      ? `stores/${storeId}/statusMessages/${key}`
      : `sharedStatusMessages/${key}`;
    updates[path] = value === null || value === "" ? null : String(value);
    applied.push(key);
  }

  if (applied.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `変更できる項目は ${FIELDS.join(" / ")} です` }),
    };
  }

  const db = admin.database();

  try {
    if (storeId) {
      const store = (await db.ref(`storeList/${storeId}`).get()).val();
      if (!store) {
        return { statusCode: 404, body: JSON.stringify({ error: "店舗が見つかりません" }) };
      }
    }
    await db.ref().update(updates);
    return {
      statusCode: 200,
      body: JSON.stringify({ scope: storeId || "all", applied }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
