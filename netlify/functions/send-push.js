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

  const { tokens, title, body, icon, storeId } = payload;
  if (!Array.isArray(tokens) || tokens.length === 0 || !body) {
    return { statusCode: 400, body: "tokens (array) and body are required" };
  }

  // 重複排除
  const uniqueTokens = [...new Set(tokens)];

  try {
    const messages = uniqueTokens.map((token) => ({
      token,
      notification: {
        title: title || "PicoPay",
        body,
        ...(icon ? { imageUrl: icon } : {}),
      },
    }));

    // FCM v12: sendEach replaces sendEachForMulticast
    const result = await admin.messaging().sendEach(messages);

    // 無効トークンを特定
    const invalidTokens = [];
    result.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const code = resp.error?.code || "";
        if (
          code === "messaging/invalid-registration-token" ||
          code === "messaging/registration-token-not-registered"
        ) {
          invalidTokens.push(uniqueTokens[idx]);
        }
      }
    });

    // 無効トークンを Realtime Database から自動削除
    if (invalidTokens.length > 0 && storeId) {
      const db = admin.database();
      const storeRef = db.ref(`stores/${storeId}`);
      const accountsSnap = await storeRef.child("accounts").once("value");
      const accounts = accountsSnap.val() || {};
      const updates = {};

      for (const [customerId, acc] of Object.entries(accounts)) {
        if (!acc.pushTokens) continue;

        let hasInvalid = false;
        if (Array.isArray(acc.pushTokens)) {
          hasInvalid = invalidTokens.some((t) => acc.pushTokens.includes(t));
        } else if (typeof acc.pushTokens === "object") {
          hasInvalid = invalidTokens.some((t) => acc.pushTokens[t]);
        }

        if (!hasInvalid) continue;

        // accounts/{cid}/pushTokens から削除
        if (Array.isArray(acc.pushTokens)) {
          const remaining = acc.pushTokens.filter((t) => !invalidTokens.includes(t));
          updates[`accounts/${customerId}/pushTokens`] = remaining.length > 0 ? remaining : null;
        } else {
          const remaining = { ...acc.pushTokens };
          for (const t of invalidTokens) delete remaining[t];
          updates[`accounts/${customerId}/pushTokens`] = Object.keys(remaining).length > 0 ? remaining : null;
        }

        // pushIndex/{cid}/tokens からも削除
        const idxSnap = await storeRef.child(`pushIndex/${customerId}`).once("value");
        const idx = idxSnap.val() || {};
        if (idx.tokens) {
          if (Array.isArray(idx.tokens)) {
            const remaining = idx.tokens.filter((t) => !invalidTokens.includes(t));
            updates[`pushIndex/${customerId}/tokens`] = remaining.length > 0 ? remaining : null;
          } else if (typeof idx.tokens === "object") {
            const remaining = { ...idx.tokens };
            for (const t of invalidTokens) delete remaining[t];
            updates[`pushIndex/${customerId}/tokens`] = Object.keys(remaining).length > 0 ? remaining : null;
          }
        }

        // トークンが全部消えたら pushIndex 自体も消す
        const newTokens = updates[`pushIndex/${customerId}/tokens`];
        const tokenCount = Array.isArray(newTokens)
          ? newTokens.length
          : newTokens && typeof newTokens === "object"
          ? Object.keys(newTokens).length
          : 0;
        if (tokenCount === 0) {
          updates[`pushIndex/${customerId}`] = null;
        }
      }

      if (Object.keys(updates).length > 0) {
        await storeRef.update(updates);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        successCount: result.successCount,
        failureCount: result.failureCount,
        invalidTokensRemoved: invalidTokens.length,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
