// Issues the one-time code for adminオーナー.
//
// Called by the AI Console (which is what actually mails it to the store's
// admin address). Guarded by CREATE_STORE_SECRET so it can't be triggered
// from a browser — otherwise anyone could fill the owner's inbox.
//
// The code is single-use and expires; nothing long-lived is stored, so
// there's no permanent owner password to leak or to be remembered by someone
// who has left.
const admin = require("firebase-admin");
const crypto = require("crypto");

const DATABASE_URL =
  "https://picopay-5a53e-default-rtdb.asia-southeast1.firebasedatabase.app";

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL,
  });
}

const VALID_MINUTES = 10;

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

  const { storeId } = body;
  if (!storeId) {
    return { statusCode: 400, body: JSON.stringify({ error: "店舗IDが必要です" }) };
  }

  const db = admin.database();
  const store = (await db.ref(`storeList/${storeId}`).get()).val();
  if (!store) {
    return { statusCode: 404, body: JSON.stringify({ error: "店舗が見つかりません" }) };
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const expiresAt = Date.now() + VALID_MINUTES * 60 * 1000;

  await db.ref(`stores/${storeId}/ownerCode`).set({ value: code, expiresAt });

  // The caller sends the mail — this function never touches email itself.
  return {
    statusCode: 200,
    body: JSON.stringify({
      code,
      expiresAt,
      validMinutes: VALID_MINUTES,
      adminEmail: (await db.ref(`stores/${storeId}/private/adminEmail`).get()).val() || null,
    }),
  };
};
