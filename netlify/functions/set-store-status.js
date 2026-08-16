// Sets a store's service status. Called by the AI Console — never from a
// browser.
//
// PicoPay does not decide any of this. It doesn't watch Square, doesn't
// count the 25/60 days after a failed payment, and doesn't send mail — it
// has no mail capability and shouldn't have one. The AI Console is the hub:
// it receives Square's notice, works out the dates, mails the store, and
// then tells this endpoint what the store's state now is. This function
// writes that state down and nothing else.
//
// Statuses:
//   active     … normal
//   warning    … a payment failed. Everything still works; the store's
//                概況 screen shows ⚠️ telling them to check their email.
//                Customers see nothing — the store's billing trouble is
//                not the customer's business unless it actually stops.
//   suspended  … charging and payment blocked. Login still works.
//                Customers now see the "現在ご利用出来ない状況" notice.
//   terminated … login blocked too.
//
// Starting a store (active) issues a fresh password every time, including
// when an old store comes back after being suspended: whoever knew the
// previous one may well have left in the meantime.
//
// Protected by CREATE_STORE_SECRET, the same shared secret the AI Console
// already uses for create-store.js and issue-owner-code.js.
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

const STATUSES = ["active", "warning", "suspended", "terminated"];

function newPassword() {
  // 読み間違えやすい文字(0/O, 1/l/I)を避ける。メールで送られたものを
  // 手で打ち直す場面があるため。
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
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

  if (body.secret !== process.env.CREATE_STORE_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: "認証できませんでした" }) };
  }

  const { storeId, status } = body;
  // 店舗IDは必須。省略を許すと全店舗を一度に止められてしまう。
  if (!storeId) {
    return { statusCode: 400, body: JSON.stringify({ error: "店舗IDは必須です" }) };
  }
  if (!STATUSES.includes(status)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `状態は ${STATUSES.join(" / ")} のいずれかです` }),
    };
  }

  const db = admin.database();

  try {
    const store = (await db.ref(`storeList/${storeId}`).get()).val();
    if (!store) {
      return { statusCode: 404, body: JSON.stringify({ error: "店舗が見つかりません" }) };
    }

    const now = Date.now();
    const updates = {
      [`stores/${storeId}/storeSettings/serviceStatus`]: status,
      [`storeList/${storeId}/serviceStatus`]: status,
      [`storeList/${storeId}/serviceStatusAt`]: now,
    };

    // 開始(再開含む)のときだけ、ログイン用のパスワードを作り直して返す。
    // メールで店舗に届けるのは AI Console 側の仕事。
    let issued = null;
    if (status === "active") {
      const password = newPassword();
      const email = (await db.ref(`stores/${storeId}/private/contactEmail`).get()).val();
      if (!email) {
        return { statusCode: 409, body: JSON.stringify({ error: "店舗の登録メールが見つかりません" }) };
      }
      const user = await admin.auth().getUserByEmail(email);
      await admin.auth().updateUser(user.uid, { password });
      issued = { loginId: email, password };
      updates[`stores/${storeId}/storeSettings/lastPaymentAt`] = now;
    }

    await db.ref().update(updates);

    return { statusCode: 200, body: JSON.stringify({ storeId, status, issued }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
