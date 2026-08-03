// Netlify serverless function — this is the only place the Firebase
// service account (a real secret) is used. It never reaches the browser.
// The service account JSON is stored as a Netlify environment variable
// (FIREBASE_SERVICE_ACCOUNT_JSON, set in Netlify's site settings), not in
// this file or in git.
const admin = require("firebase-admin");

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const { tokens, title, body, icon } = payload;
  if (!Array.isArray(tokens) || tokens.length === 0 || !body) {
    return { statusCode: 400, body: "tokens (array) and body are required" };
  }

  try {
    const message = {
      notification: {
        title: title || "PicoPay",
        body,
        ...(icon ? { imageUrl: icon } : {}),
      },
      tokens,
    };
    const result = await admin.messaging().sendEachForMulticast(message);
    return {
      statusCode: 200,
      body: JSON.stringify({
        successCount: result.successCount,
        failureCount: result.failureCount,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
