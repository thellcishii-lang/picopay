// Checks a role password and returns what that role is allowed to do.
//
// The passwords can't live anywhere the browser can read: staff share one
// device and one login, so anything readable from that device is readable by
// everyone using it. They're written to stores/<id>/roleAuth (write-only for
// staff, read denied by the rules) and only ever compared here.
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

// Constant-time compare, so a wrong password can't be narrowed down by how
// long the answer takes to come back.
function same(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

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

  const { storeId, role, password } = body;
  if (!storeId || !role || !password) {
    return { statusCode: 400, body: JSON.stringify({ error: "入力が足りません" }) };
  }

  const db = admin.database();

  try {
    // Without a limit, a store id (which is sequential, so easy to guess) plus
    // a script is enough to try passwords all day. Five misses locks that
    // store's check for fifteen minutes.
    const gateRef = db.ref(`stores/${storeId}/roleGate`);
    const gate = (await gateRef.get()).val() || {};
    if (gate.until && Date.now() < gate.until) {
      const wait = Math.ceil((gate.until - Date.now()) / 60000);
      return {
        statusCode: 429,
        body: JSON.stringify({ error: `しばらくお待ちください(あと約${wait}分)` }),
      };
    }
    const fail = async () => {
      const misses = (gate.misses || 0) + 1;
      await gateRef.set(
        misses >= 5
          ? { misses: 0, until: Date.now() + 15 * 60 * 1000 }
          : { misses, until: 0 }
      );
    };
    const pass = async () => {
      if (gate.misses || gate.until) await gateRef.remove();
    };

    // adminオーナー uses a one-time code (issued elsewhere and mailed by the
    // AI Console), not a stored password — it expires and is consumed here.
    if (role === "owner") {
      const ref = db.ref(`stores/${storeId}/ownerCode`);
      const code = (await ref.get()).val();
      if (!code || !code.value) {
        return { statusCode: 401, body: JSON.stringify({ error: "有効なコードがありません" }) };
      }
      if (Date.now() > (code.expiresAt || 0)) {
        await ref.remove();
        return { statusCode: 401, body: JSON.stringify({ error: "コードの有効期限が切れています" }) };
      }
      if (!same(code.value, password)) {
        await fail();
        return { statusCode: 401, body: JSON.stringify({ error: "コードが違います" }) };
      }
      await ref.remove();
      await pass();
      return { statusCode: 200, body: JSON.stringify({ role: "owner" }) };
    }

    const stored = (await db.ref(`stores/${storeId}/roleAuth/${role}`).get()).val();
    if (!stored) {
      return { statusCode: 401, body: JSON.stringify({ error: "この区分は設定されていません" }) };
    }
    if (!same(stored, password)) {
      await fail();
      return { statusCode: 401, body: JSON.stringify({ error: "パスワードが違います" }) };
    }
    await pass();

    const perms = (await db.ref(`stores/${storeId}/roles/${role}`).get()).val() || {};
    return { statusCode: 200, body: JSON.stringify({ role, perms }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
