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
    // FCM Admin SDK v12 では、Web Push の画像・リンクは webpush 配下に設定
    const message = {
      notification: {
        title: title || "PicoPay",
        body,
      },
      webpush: {
        notification: {
          // 小さなアイコン（ブラウザ通知バー用）
          icon: icon || undefined,
          // 大きな画像（通知カード内に表示される）
          image: icon || undefined,
          // クリック時の遷移先（同じオリジン内のパス）
          click_action: "/",
        },
        fcm_options: {
          link: "/",
        },
      },
      tokens,
    };

    const result = await admin.messaging().sendEachForMulticast(message);

    // デバッグ：失敗したトークンと理由をログに残す（Netlify Functions のログで確認可能）
    const failures = result.responses
      .map((r, i) => ({ success: r.success, error: r.error, token: tokens[i] }))
      .filter((r) => !r.success);

    if (failures.length > 0) {
      console.error(
        `[send-push] ${failures.length}/${tokens.length} failures:`,
        failures.map((f) => ({ token: f.token.slice(0, 20) + "...", error: f.error?.message }))
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        successCount: result.successCount,
        failureCount: result.failureCount,
        failures: failures.map((f) => ({
          tokenPreview: f.token.slice(0, 20) + "...",
          error: f.error?.message,
        })),
      }),
    };
  } catch (e) {
    console.error("[send-push] Exception:", e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
