// Scheduled function — records the balances at each 基準日 (3/31 and 9/30),
// the dates that decide whether the store has to notify the Finance Bureau.
//
// It runs every day rather than only on those two dates: a twice-a-year
// schedule that silently fails leaves a gap nobody notices until the next
// reference date, six months later. A daily run that does nothing 363 days a
// year costs almost nothing and is far easier to verify.
//
// Uses the same service account as send-push (Netlify environment variable
// FIREBASE_SERVICE_ACCOUNT_JSON) — it never reaches the browser.
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

// Netlify runs on UTC; the reference dates are Japanese calendar dates, so
// every date decision here is made in JST (UTC+9).
function jstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

// The term that a reference date closes: 9/30 closes 前期 (that year's H1),
// 3/31 closes 後期 (the previous year's H2).
function closingTermKey(d) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if (m === 9 && day === 30) return `${y}-H1`;
  if (m === 3 && day === 31) return `${y - 1}-H2`;
  return null;
}

exports.handler = async () => {
  const now = jstNow();
  // Runs just after midnight JST, so the day that just ended is "yesterday".
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const termKey = closingTermKey(yesterday);

  if (!termKey) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
  }

  const db = admin.database();

  const existing = await db.ref(`stats/snapshots/${termKey}`).get();
  if (existing.exists()) {
    return { statusCode: 200, body: JSON.stringify({ alreadyRecorded: termKey }) };
  }

  const [accountsSnap, termSnap] = await Promise.all([
    db.ref("accounts").get(),
    db.ref(`stats/terms/${termKey}`).get(),
  ]);

  const accounts = accountsSnap.val() || {};
  let deposit = 0;
  let point = 0;
  for (const acc of Object.values(accounts)) {
    deposit += acc.depositBalance || 0;
    point += acc.pointBalance || 0;
  }

  const term = termSnap.val() || {};

  await db.ref(`stats/snapshots/${termKey}`).set({
    at: Date.now(),
    date: ymd(yesterday),
    deposit,
    point,
    cash: term.cash || 0,
    issuedPoints: term.point || 0,
    late: false,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ recorded: termKey, deposit, point }),
  };
};
