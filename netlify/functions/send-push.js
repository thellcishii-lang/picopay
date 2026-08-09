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

  // ---- 重複排除 & 文字列のみ抽出 ----
  // 同じ端末で複数回トークンを取得した場合、古いトークンも有効なまま残る。
  // FCMは各トークンに個別に送信するので、重複があると同じ端末に何回も届く。
  const validTokens = [...new Set(tokens)].filter(
    (t) => typeof t === "string" && t.length > 0
  );

  if (validTokens.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "有効なトークンがありません", rawCount: tokens.length }),
    };
  }

  // デバッグ：どんなトークンが来たか
  console.log("[send-push] Raw tokens:", tokens.length, "Unique valid:", validTokens.length);
  console.log("[send-push] Token samples:", validTokens.slice(0, 3).map(t => t.slice(0, 20) + "..."));

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
        fcm_options: {
          link: "/",
        },
      },
      tokens: validTokens,
    };

    const result = await admin.messaging().sendEachForMulticast(message);

    // 安全に失敗を収集（tokenが文字列でない場合もあるため）
    const failures = result.responses
      .map((r, i) => ({ success: r.success, error: r.error, token: validTokens[i] }))
      .filter((r) => !r.success);

    if (failures.length > 0) {
      console.error(
        `[send-push] ${failures.length}/${validTokens.length} failures:`,
        failures.map((f) => ({
          token: typeof f.token === "string" ? f.token.slice(0, 20) + "..." : String(f.token).slice(0, 30),
          error: f.error?.message,
        }))
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        successCount: result.successCount,
        failureCount: result.failureCount,
        dedupedFrom: tokens.length,      // 元の件数
        actualSent: validTokens.length,  // 重複排除後の件数
        failures: failures.map((f) => ({
          tokenPreview: typeof f.token === "string" ? f.token.slice(0, 20) + "..." : String(f.token).slice(0, 30),
          error: f.error?.message,
        })),
      }),
    };
  } catch (e) {
    console.error("[send-push] Exception:", e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
