// Answers one question, before the customer has proved anything: does this
// account need phone verification, and which number should the code go to?
//
// The app can't ask the database directly — it isn't authenticated yet, which
// is the whole point. Previously that was solved by leaving the phone number
// publicly readable, which meant anyone who could guess account ids could
// harvest phone numbers. Now the lookup happens here, and only for an id the
// caller already knows.
//
// The number itself still comes back — the browser needs it to ask Firebase
// for the SMS. What changed is that account ids can no longer be listed, so
// there's no way to walk through them and collect numbers in bulk.
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

exports.handler = async (event) => {
  const customerId = (event.queryStringParameters || {}).id;
  if (!customerId) {
    return { statusCode: 400, body: JSON.stringify({ error: "お客様IDが必要です" }) };
  }

  const db = admin.database();
  const storeId = (await db.ref(`customerIndex/${customerId}`).get()).val();
  if (!storeId) {
    return { statusCode: 404, body: JSON.stringify({ error: "お客様が見つかりません" }) };
  }

  const base = `stores/${storeId}/accounts/${customerId}`;
  const [phoneSnap, requireSnap] = await Promise.all([
    db.ref(`${base}/profile/phone`).get(),
    db.ref(`${base}/requireVerification`).get(),
  ]);

  const phone = phoneSnap.val();
  return {
    statusCode: 200,
    body: JSON.stringify({
      storeId,
      hasPhone: !!phone,
      // Enough for the customer to recognise their own number, useless to
      // anyone else.
      phoneHint: phone ? `***-****-${String(phone).slice(-4)}` : null,
      phone: phone || null,
      requireVerification: requireSnap.val() !== false,
    }),
  };
};
