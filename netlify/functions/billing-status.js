// Daily job that turns the two timestamps square-webhook.js records
// (paymentFailedAt / cancelRequestedAt) into an actual billingStatus.
//
// Two independent tracks, per 2026-08-06 decision, with different anchors:
//
//   Payment failure (paymentFailedAt set): counted from the failed payment
//   itself. +25 days → suspended (checkout/charge blocked, login still
//   works). +60 days → locked (login blocked too).
//
//   Voluntary cancellation (cancelRequestedAt set, no active payment
//   failure): counted from the store's last *successful* payment
//   (lastPaymentAt), not from when the cancellation was requested — there
//   is no "failure" date to anchor to here. +30 days → suspended.
//   +60 days → locked.
//
// If both are set, payment failure takes priority (it's the more urgent,
// shorter timeline) until it resolves.
//
// This does NOT send email — this codebase has no email-sending capability
// (that lives in AI Console, per the existing adminパスワード flow). Instead
// it writes to a `notifications` queue that AI Console (or whatever handles
// outbound email) is expected to poll and clear. That integration doesn't
// exist yet — flagging this as an open dependency, not a finished pipeline.
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

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(ts, now) {
  if (!ts) return null;
  return (now - ts) / DAY_MS;
}

exports.handler = async () => {
  const db = admin.database();
  const now = Date.now();

  const storeList = (await db.ref("storeList").get()).val() || {};
  const results = [];

  for (const storeId of Object.keys(storeList)) {
    const base = `stores/${storeId}`;
    const settings = (await db.ref(`${base}/storeSettings`).get()).val() || {};
    const current = settings.billingStatus || "active";

    // Already fully locked — resuming is a separate, not-yet-built flow
    // (re-application → new Square payment notice → reactivate). Nothing
    // for this daily job to do once locked.
    if (current === "locked") continue;

    let nextStatus = "active";
    let anchor = null;
    let suspendAt = null;
    let lockAt = null;

    if (settings.paymentFailedAt) {
      anchor = settings.paymentFailedAt;
      const d = daysSince(anchor, now);
      suspendAt = anchor + 25 * DAY_MS;
      lockAt = anchor + 60 * DAY_MS;
      if (d >= 60) nextStatus = "locked";
      else if (d >= 25) nextStatus = "suspended";
      else nextStatus = "active";
    } else if (settings.cancelRequestedAt) {
      anchor = settings.lastPaymentAt || settings.cancelRequestedAt;
      const d = daysSince(anchor, now);
      suspendAt = anchor + 30 * DAY_MS;
      lockAt = anchor + 60 * DAY_MS;
      if (d >= 60) nextStatus = "locked";
      else if (d >= 30) nextStatus = "suspended";
      else nextStatus = "active";
    }

    // suspendAt/lockAt は、実際に停止する前の「◯月◯日までご利用いただけます」
    // という予告バナーにお客様画面が使う値なので、ステータスがまだ active の
    // 間から(anchorが立った時点で)先に書いておく。ステータス自体の遷移は
    // 下のnextStatus !== currentのところでのみ行う。
    if (anchor && (settings.billingSuspendAt !== suspendAt || settings.billingLockAt !== lockAt)) {
      await db.ref(base).update({
        "storeSettings/billingSuspendAt": suspendAt,
        "storeSettings/billingLockAt": lockAt,
      });
    }

    if (nextStatus === current) continue;

    const updates = {
      [`${base}/storeSettings/billingStatus`]: nextStatus,
      [`storeList/${storeId}/billingStatus`]: nextStatus,
    };

    // Queue a notification on every transition (active→suspended,
    // suspended→locked). AI Console side needs to watch this node and
    // actually send the email — see file header note.
    updates[`notifications/${storeId}_${nextStatus}_${now}`] = {
      storeId,
      type: nextStatus === "locked" ? "billing_locked" : "billing_suspended",
      reason: settings.paymentFailedAt ? "payment_failure" : "cancellation",
      createdAt: now,
    };

    await db.ref().update(updates);
    results.push({ storeId, from: current, to: nextStatus });
  }

  return { statusCode: 200, body: JSON.stringify({ checked: Object.keys(storeList).length, results }) };
};
