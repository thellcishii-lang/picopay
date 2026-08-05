// Creates a store. Called after payment clears — never from a browser.
//
// It does two things a browser must not be able to do: create the staff
// login, and write the storeAdmins mapping that decides which data that
// login can reach. The security rules deny both from the client side, so
// this function (running with admin credentials) is the only way in.
//
// Protected by CREATE_STORE_SECRET, set as a Netlify environment variable.
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

// Sequential ids (p10001, p10002, …) so stores list in signup order without
// needing a separate date to sort on. A transaction, so two signups landing
// at the same moment can't take the same number.
async function issueStoreId(db) {
  const result = await db.ref("meta/lastStoreNumber").transaction((current) => (current || 10000) + 1);
  return `p${result.snapshot.val()}`;
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

  const { email, password, companyName, storeName } = body;
  if (!email || !password) {
    return { statusCode: 400, body: JSON.stringify({ error: "メールアドレスとパスワードは必須です" }) };
  }

  const db = admin.database();

  try {
    // If this address already has a login, attach the new store to it rather
    // than failing — that's how 複数拠点契約 works: same person, second store.
    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
    } catch (e) {
      user = await admin.auth().createUser({ email, password });
    }

    const storeId = await issueStoreId(db);
    const now = Date.now();

    await db.ref().update({
      [`stores/${storeId}/storeSettings`]: {
        companyName: companyName || null,
        storeName: storeName || null,
        contactEmail: email,
        createdAt: now,
      },
      [`stores/${storeId}/stats/startedAt`]: now,
      [`storeAdmins/${user.uid}`]: storeId,
      [`storeList/${storeId}`]: {
        companyName: companyName || null,
        storeName: storeName || null,
        contactEmail: email,
        createdAt: now,
        status: "active",
      },
    });

    return { statusCode: 200, body: JSON.stringify({ storeId, uid: user.uid }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
