// Receives billing events from Square and records them against the store.
//
// This function does NOT decide when to suspend or lock a store — it only
// timestamps two moments: "a payment failed" and "a cancellation was
// requested". billing-status.js (a daily scheduled function) reads those
// timestamps and does the actual day-counting and status transitions. This
// split keeps the webhook fast and idempotent, and keeps the day-counting
// logic in one place instead of duplicated between webhook and batch.
//
// IMPORTANT — not yet wired to real Square events:
// Square's actual webhook event names/payload shape for subscription billing
// (e.g. invoice payment-failure events vs. subscription.updated with a
// CANCELED status) need to be confirmed against Square's current API docs
// once the real Square subscription integration is built. The event-type
// checks below are a reasonable placeholder based on Square's documented
// naming pattern, but MUST be verified against a real test webhook payload
// before this goes live — do not assume this is correct without checking.
//
// Signature verification: Square signs webhook requests with HMAC-SHA256
// over (notification URL + raw body) using a signature key issued when the
// webhook subscription is created in the Square dashboard. That key must be
// set as SQUARE_WEBHOOK_SIGNATURE_KEY in Netlify env vars before this can
// safely trust incoming requests — right now, without it, ANY caller who
// knows this URL could forge a "payment failed" or "cancelled" event for any
// store. Do not deploy this to production without setting that key and
// enabling the verification below.
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

function verifySignature(event) {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!signatureKey) {
    // No key configured yet — refuse to trust the request rather than
    // silently accepting forged events. Set the env var to enable this.
    return false;
  }
  const signature = event.headers["x-square-hmacsha256-signature"];
  if (!signature) return false;

  const notificationUrl = `https://${event.headers.host}${event.path}`;
  const hmac = crypto.createHmac("sha256", signatureKey);
  hmac.update(notificationUrl + (event.body || ""));
  const expected = hmac.digest("base64");

  // Constant-time compare to avoid timing attacks.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "POSTで呼び出してください" }) };
  }

  if (!verifySignature(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: "署名を検証できませんでした" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "リクエストの形式が不正です" }) };
  }

  const eventType = payload.type || "";
  const subscriptionId =
    (payload.data && payload.data.object && payload.data.object.subscription && payload.data.object.subscription.id) ||
    (payload.data && payload.data.id) ||
    null;

  if (!subscriptionId) {
    // Not a subscription-related event we care about — acknowledge and
    // ignore, so Square doesn't retry it forever.
    return { statusCode: 200, body: JSON.stringify({ ignored: true }) };
  }

  const db = admin.database();
  const storeId = (await db.ref(`squareIndex/${subscriptionId}`).get()).val();
  if (!storeId) {
    // Either an unrelated subscription, or squareSubscriptionId was never
    // recorded for this store at create-store.js time. Acknowledge so
    // Square stops retrying, but this is worth investigating if it happens
    // for a subscription that should be ours.
    return { statusCode: 200, body: JSON.stringify({ ignored: true, reason: "unknown_subscription" }) };
  }

  const now = Date.now();
  const base = `stores/${storeId}`;

  // TODO: confirm these event-type strings against a real Square webhook
  // payload before relying on this in production (see file header note).
  const isPaymentFailure = eventType.includes("payment_failed") || eventType.includes("invoice.scheduled_charge_failed");
  const isCancellation =
    eventType.includes("subscription.updated") &&
    ((payload.data.object.subscription || {}).status === "CANCELED");

  if (isPaymentFailure) {
    await db.ref().update({
      [`${base}/storeSettings/paymentFailedAt`]: now,
      [`storeList/${storeId}/paymentFailedAt`]: now,
    });
  } else if (isCancellation) {
    await db.ref().update({
      [`${base}/storeSettings/cancelRequestedAt`]: now,
      [`storeList/${storeId}/cancelRequestedAt`]: now,
    });
  } else if (eventType.includes("payment") && !eventType.includes("failed")) {
    // A successful payment — clear any prior failure flag so billing-status.js
    // doesn't keep counting down from a since-resolved failure.
    await db.ref().update({
      [`${base}/storeSettings/paymentFailedAt`]: null,
      [`storeList/${storeId}/paymentFailedAt`]: null,
      [`${base}/storeSettings/lastPaymentAt`]: now,
    });
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, storeId }) };
};
