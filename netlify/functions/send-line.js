// Netlify serverless function for sending LINE messages via Messaging API
// This function uses the LINE Channel Access Token stored as a Netlify environment variable.
const fetch = require("node-fetch"); // node-fetch is included in Netlify Functions environment

exports.handler = async (event) => {
  // セキュリティ: POSTリクエストのみ許可
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  // リクエストボディのパース
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  // 必須パラメータのバリデーション
  const { lineUserIds, message } = payload; // 複数の送信先に対応するため配列で受け取る想定
  if (!Array.isArray(lineUserIds) || lineUserIds.length === 0 || !message) {
    return { statusCode: 400, body: "lineUserIds (array) and message are required" };
  }

  // 環境変数からLINEのチャネルアクセストークンを取得
  const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!LINE_ACCESS_TOKEN) {
    console.error("LINE_CHANNEL_ACCESS_TOKEN is not set in Netlify environment variables.");
    return { statusCode: 500, body: JSON.stringify({ error: "LINE configuration error" }) };
  }

  // LINE Messaging APIのプッシュメッセージ送信エンドポイント
  const url = "https://api.line.me/v2/bot/message/push";

  // 送信結果を格納する配列
  const results = [];

  // 1件ずつ（またはバッチで）LINE APIへリクエスト送信
  // ※ LINEのPush APIは1リクエストで最大5件のメッセージオブジェクトを送れますが、
  //    シンプルにするため、ここでは1ユーザーごとに1メッセージを送る最も単純なループ処理を記載します。
  //    （多数のユーザーに送る場合は、ジョブキューイングシステム等の検討が必要です）
  
  // 今回の仕様（イメージ画像のような一斉配信）に合わせ、最大150件（LINEのPush API制限を考慮しつつ）までを
  // ループで処理する実装例です。実際にはfirebaseから取得したuserIdの配列を渡します。
  const targetUserIds = lineUserIds.slice(0, 150); // 一応の安全策として配列を切り詰め

  for (const userId of targetUserIds) {
    const body = JSON.stringify({
      to: userId,
      messages: [
        {
          type: "text",
          text: message,
        },
      ],
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
        },
        body: body,
      });

      const responseBody = await response.json();

      if (!response.ok) {
        console.error(`Failed to send LINE message to ${userId}:`, responseBody);
        results.push({ userId, success: false, error: responseBody });
      } else {
        // console.log(`Successfully sent LINE message to ${userId}:`, responseBody);
        results.push({ userId, success: true });
      }
    } catch (e) {
      console.error(`Exception sending LINE message to ${userId}:`, e);
      results.push({ userId, success: false, error: e.message });
    }
  }

  // 集計結果を返す
  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "LINE message sending process completed.",
      successCount,
      failureCount,
      results, // デバッグ用に詳細な結果を返す（本番では削っても良い）
    }),
  };
};
