// Uploads (or deletes) a store's brand images.
//
// The images themselves used to live in the Realtime Database as data URIs,
// re-downloaded every time a customer opened the app. They now live in Cloud
// Storage with only the URL in the database, so the browser caches them like
// any other image and the second view costs nothing.
//
// 2026-08-06: the hero banner (the big 800×280 image on the customer's
// payment screen) was removed entirely — it was the bulk of that cost, and
// dropping it was simpler than optimising it. What's left is the logo and
// the icon, both small.
//
// Why this goes through a function instead of the browser uploading straight
// to Storage: Storage security rules can read Firestore, but not the
// Realtime Database — and storeAdmins (who belongs to which store) lives in
// the Realtime Database. A browser-side upload could therefore only be
// guarded by "is signed in at all", and customers sign in too (SMS auth), so
// any customer could have replaced any store's branding. Checking here with
// admin credentials keeps it to that store's own staff, and matches how
// every other privileged action already works (transact.js, verify-role.js).
//
// Storage rules should be read-only to the public and closed to writes —
// this function uses admin credentials and bypasses them.
const admin = require("firebase-admin");

const DATABASE_URL =
  "https://picopay-5a53e-default-rtdb.asia-southeast1.firebasedatabase.app";
const BUCKET = "picopay-5a53e.firebasestorage.app";

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL,
    storageBucket: BUCKET,
  });
}

const FIELDS = ["logoImage", "iconImage"];
const MAX_BYTES = 2 * 1024 * 1024; // 2MB — 圧縮済みの画像なら十分すぎる余裕

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

  const { idToken, storeId, field, dataUrl } = body;
  if (!idToken || !storeId || !field) {
    return { statusCode: 400, body: JSON.stringify({ error: "入力が足りません" }) };
  }
  if (!FIELDS.includes(field)) {
    return { statusCode: 400, body: JSON.stringify({ error: "対象の画像が不正です" }) };
  }

  const db = admin.database();

  try {
    // 本人確認 → その店舗のスタッフかどうか。お客様のログインでは通らない。
    const decoded = await admin.auth().verifyIdToken(idToken);
    const staffStore = (await db.ref(`storeAdmins/${decoded.uid}`).get()).val();
    if (!staffStore || staffStore !== storeId) {
      return { statusCode: 403, body: JSON.stringify({ error: "この店舗を操作する権限がありません" }) };
    }

    const bucket = admin.storage().bucket();
    const path = `stores/${storeId}/branding/${field}`;
    const file = bucket.file(path);

    // 空文字は「店舗が意図して削除した」の意味。Storage の実体も消す
    // (残すと保管料がかかり続ける)。null ではなく空文字なのは、null だと
    // キーごと消えて「未設定」と区別が付かなくなるため。
    if (dataUrl === "") {
      await file.delete().catch(() => {});
      await db.ref(`stores/${storeId}/branding/${field}`).set("");
      return { statusCode: 200, body: JSON.stringify({ field, url: "" }) };
    }

    const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl || "");
    if (!match) {
      return { statusCode: 400, body: JSON.stringify({ error: "画像の形式が不正です" }) };
    }
    const [, contentType, base64] = match;
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length > MAX_BYTES) {
      return { statusCode: 413, body: JSON.stringify({ error: "画像が大きすぎます" }) };
    }

    await file.save(buffer, {
      contentType,
      // ブラウザに長くキャッシュさせる。差し替えた時に古い画像が残らない
      // よう、URL に更新時刻を付けて別物として扱わせる。
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    });
    await file.makePublic();

    const url = `https://storage.googleapis.com/${BUCKET}/${path}?v=${Date.now()}`;
    await db.ref(`stores/${storeId}/branding/${field}`).set(url);

    return { statusCode: 200, body: JSON.stringify({ field, url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
