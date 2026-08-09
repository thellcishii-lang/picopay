const admin = require("firebase-admin");

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://picopay-5a53e-default-rtdb.asia-southeast1.firebasedatabase.app",
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

  // 重複排除 & 文字列のみ抽出
  const validTokens = [...new Set(tokens)].filter(
    (t) => typeof t === "string" && t.length > 0
  );

  if (validTokens.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "有効なトークンがありません", rawCount: tokens.length }),
    };
  }

  console.log("[send-push] Raw:", tokens.length, "Unique:", validTokens.length);

  try {
    const message = {
      notification: {
        title: title || "PicoPay",
        body,
      },
      webpush: {
        notification: {
          icon: icon || undefined,
          image: icon || undefined,
          click_action: "/",
        },
        fcm_options: { link: "/" },
      },
      tokens: validTokens,
    };

    const result = await admin.messaging().sendEachForMulticast(message);

    // ---- 無効トークンを検出してDBから削除 ----
    const invalidTokens = [];
    const failures = [];

    result.responses.forEach((r, i) => {
      if (!r.success) {
        const errCode = r.error?.code || r.error?.message || "";
        const token = validTokens[i];
        failures.push({ token: token.slice(0, 20) + "...", error: errCode });

        // 無効化されたトークンはDBから削除対象
        if (
          errCode.includes("registration-token-not-registered") ||
          errCode.includes("invalid-registration-token") ||
          errCode.includes("messaging/invalid-registration-token")
        ) {
          invalidTokens.push(token);
        }
      }
    });

    // DBから無効トークンを削除（storeIdが渡されていれば）
    if (storeId && invalidTokens.length > 0) {
      const db = admin.database();
      const base = `stores/${storeId}`;
      
      // pushIndexとaccountsの両方から削除
      const pushIndexSnap = await db.ref(`${base}/pushIndex`).get();
      const pushIndex = pushIndexSnap.val() || {};
      
      const updates = {};
      for (const [customerId, data] of Object.entries(pushIndex)) {
        if (!data?.tokens) continue;
        const customerTokens = typeof data.tokens === "object" && !Array.isArray(data.tokens)
          ? Object.keys(data.tokens)
          : Array.isArray(data.tokens) ? data.tokens : [];
        
        const hasInvalid = invalidTokens.some((t) => customerTokens.includes(t));
        if (hasInvalid) {
          const remaining = customerTokens.filter((t) => !invalidTokens.includes(t));
          if (remaining.length === 0) {
            updates[`${base}/pushIndex/${customerId}`] = null;
            updates[`${base}/accounts/${customerId}/pushTokens`] = null;
          } else {
            const newTokens = {};
            remaining.forEach((t) => (newTokens[t] = true));
            updates[`${base}/pushIndex/${customerId}/tokens`] = newTokens;
            updates[`${base}/accounts/${customerId}/pushTokens`] = newTokens;
          }
        }
      }
      
      if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
        console.log("[send-push] Cleaned up invalid tokens:", invalidTokens.length);
      }
    }

    if (failures.length > 0) {
      console.error(`[send-push] ${failures.length}/${validTokens.length} failures:`, failures);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        successCount: result.successCount,
        failureCount: result.failureCount,
        dedupedFrom: tokens.length,
        actualSent: validTokens.length,
        invalidCleaned: invalidTokens.length,
        failures,
      }),
    };
  } catch (e) {
    console.error("[send-push] Exception:", e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
