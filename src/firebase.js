// Firebase setup for PicoPay
// This connects to the "PicoPay" Firebase project's Realtime Database and Authentication.
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, get, update, remove, increment } from "firebase/database";
import { getMessaging, getToken, isSupported as isMessagingSupported } from "firebase/messaging";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyD8k35AAE9s1MeXj5pB7WVrGKg3Wlkv-xA",
  authDomain: "picopay-5a53e.firebaseapp.com",
  databaseURL: "https://picopay-5a53e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "picopay-5a53e",
  storageBucket: "picopay-5a53e.firebasestorage.app",
  messagingSenderId: "479126770039",
  appId: "1:479126770039:web:dcdf6274a257e42a6e9172",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

// ---- Push notifications (Web Push via Firebase Cloud Messaging) ----
// Generated in Firebase console → Project settings → Cloud Messaging →
// Web configuration → "Web Push certificates". This is safe to keep in
// client code — it identifies the project, not a secret credential.
const VAPID_KEY = "BKdzxi1YhwTVGdrLzaWou8govXVJu45ftEyWjG1huuOjs1ZfQ92v_2QSOS2AUa1eX7FhSI1sc5gaL14dxmdnoWA";

// Asks the browser for notification permission and, if granted, returns
// this device's FCM token (used to target push notifications at it).
// Returns null if unsupported (e.g. desktop-only Safari) or not granted.
export async function requestPushToken() {
  const supported = await isMessagingSupported().catch(() => false);
  if (!supported) return null;
  if (!("serviceWorker" in navigator)) return null;

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const messaging = getMessaging(app);
  try {
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    return token || null;
  } catch (e) {
    return null;
  }
}

// Calls the Netlify Function that actually dispatches the push (the real
// Firebase Admin credentials only ever live on that server-side function,
// never in this client code). Returns { successCount, failureCount } or
// throws if the request itself failed.
export async function sendPushNotification({ tokens, title, body, icon }) {
  const res = await fetch("/.netlify/functions/send-push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens, title, body, icon }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || "送信リクエストに失敗しました");
  }
  return res.json();
}

// ---- Auth: store side (email/password) ----
export function subscribeToAuth(callback) {
  return onAuthStateChanged(auth, callback);
}
export async function storeSignIn(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}
export async function storeSignUp(email, password) {
  await createUserWithEmailAndPassword(auth, email, password);
}
export async function storeSignOut() {
  await signOut(auth);
}

// ---- Auth: customer side (phone number / SMS code) ----
// `containerId` is the id of an invisible div already in the DOM.
export function setupRecaptcha(containerId) {
  return new RecaptchaVerifier(auth, containerId, { size: "invisible" });
}
// Sends the SMS and returns a "confirmation" object — call confirmation.confirm(code) next.
export async function sendPhoneCode(phoneNumber, recaptchaVerifier) {
  return await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier);
}

// ---- Account helpers ----
// One "account" = one customer's PicoPay balance/history.
// Path in the database: accounts/<customerId>

const DEFAULT_ACCOUNT = {
  pointBalance: 1200,
  depositBalance: 3000,
  bonusEligible: false,
  history: [
    {
      date: "7/22",
      summary: "お会計・チャージ",
      total: -1800,
      items: [{ label: "お会計(お化粧品)", amount: -1800 }],
    },
    {
      date: "7/20",
      summary: "チャージ+ボーナス15%",
      total: 11500,
      items: [
        { label: "チャージ", amount: 10000 },
        { label: "ボーナス(15%)", amount: 1500 },
      ],
    },
    {
      date: "7/15",
      summary: "お会計",
      total: -2400,
      items: [{ label: "お会計(トリートメント)", amount: -2400 }],
    },
  ],
};

// Read just a customer's phone number (public by design — see security
// rules) so the app can decide whether to show the phone verification gate
// *before* the customer is authenticated (otherwise it's a chicken-and-egg
// problem: you'd need to be verified to read the data that tells you
// verification is needed). Also reads whether verification is required at
// all for this account (store staff can turn it off per customer).
export async function getAccountVerificationInfo(customerId) {
  const [phoneSnap, requireSnap] = await Promise.all([
    get(ref(db, `accounts/${customerId}/profile/phone`)),
    get(ref(db, `accounts/${customerId}/requireVerification`)),
  ]);
  return {
    phone: phoneSnap.val() || null,
    requireVerification: requireSnap.val() !== false, // default true if unset
  };
}

// Subscribe to real-time changes for one customer's account.
// Calls `callback(account)` immediately and again every time the data changes
// anywhere (this device, another device, the store, etc). Returns an
// unsubscribe function.
export function subscribeToAccount(customerId, callback) {
  const accountRef = ref(db, `accounts/${customerId}`);
  const unsubscribe = onValue(accountRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      callback(data);
    } else {
      // No account yet at this path — create it with defaults.
      set(accountRef, DEFAULT_ACCOUNT);
      callback(DEFAULT_ACCOUNT);
    }
  });
  return unsubscribe;
}

// Read an account once (no live subscription) — useful for one-off store-side lookups.
export async function getAccountOnce(customerId) {
  const snapshot = await get(ref(db, `accounts/${customerId}`));
  return snapshot.val() || DEFAULT_ACCOUNT;
}

// Overwrite the full account object for a customer.
export async function saveAccount(customerId, account) {
  await set(ref(db, `accounts/${customerId}`), account);
}

// Set a customer's status: "active" | "blacklisted" | "suspended".
// Blacklisted/suspended customers are blocked from transacting (checked at
// scan time and shown on their own screen) but their data is kept.
export async function setCustomerStatus(customerId, status) {
  await update(ref(db, `accounts/${customerId}`), { status });
}

// Permanently and irreversibly delete a customer's account and all its data.
export async function deleteCustomerPermanently(customerId) {
  await remove(ref(db, `accounts/${customerId}`));
}

// Re-issue access for a customer who lost their phone or changed their
// number. Requires the store to have confirmed a photo ID first. The photo
// is stored under a separate `idPhotos/` path (not nested inside the
// account) so that bulk-loading the customer list doesn't have to pull
// every photo along with it. If the phone number changed, this also updates
// the profile so future SMS verification checks against the new number.
export async function reissueCustomerAccess({ customerId, newPhone, idPhotoDataUrl }) {
  if (idPhotoDataUrl) {
    await set(ref(db, `idPhotos/${customerId}`), {
      dataUrl: idPhotoDataUrl,
      verifiedAt: Date.now(),
    });
  }
  if (newPhone) {
    await update(ref(db, `accounts/${customerId}/profile`), { phone: newPhone });
  }
}

// Create a brand-new customer account (used by store-side registration).
// Generates a short, unique-enough ID and writes fresh default data plus
// whatever profile fields were collected at registration. `phone` must be a
// real number (E.164 format, e.g. +819012345678) since it's what the
// customer will use to verify their identity later.
export async function createAccount({ name, phone, email, requireVerification = true, referredBy = null }) {
  if (!phone) throw new Error("電話番号は必須です(お客様の本人確認に使います)");
  const customerId =
    "cust-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  const account = {
    ...DEFAULT_ACCOUNT,
    pointBalance: 0,
    depositBalance: 0,
    bonusEligible: false,
    history: [],
    profile: { name, phone, email: email || null },
    requireVerification,
    referredBy: referredBy || null,
    referralBonusGiven: false,
  };
  await set(ref(db, `accounts/${customerId}`), account);
  return customerId;
}

// List all registered customers (for the store's customer list screen).
export async function listCustomers() {
  const snapshot = await get(ref(db, "accounts"));
  const data = snapshot.val() || {};
  return Object.entries(data).map(([id, acc]) => ({
    id,
    name: acc.profile?.name || "(名前未登録)",
    phone: acc.profile?.phone || null,
    email: acc.profile?.email || null,
    balance: (acc.pointBalance || 0) + (acc.depositBalance || 0),
    pointBalance: acc.pointBalance || 0,
    depositBalance: acc.depositBalance || 0,
    notifyOptIn: acc.notifyOptIn || null,
    pushTokens: acc.pushTokens || [],
  }));
}

export { DEFAULT_ACCOUNT };

// ---- Store-level settings (shared across all store devices) ----
// Branding (logo/icon/store name), the customer-side hero image, and other
// store-wide configuration the store sets once and every device reads.
export async function getStoreSettings() {
  const snapshot = await get(ref(db, "storeSettings"));
  return snapshot.val() || {};
}

export async function saveStoreSettings(settings) {
  await update(ref(db, "storeSettings"), settings);
}


// ---- Running totals (the store's dashboard + the 集計 screen) ----
// Counting these up from every customer's history on each page load would
// mean reading the entire database every time, so instead each transaction
// adds to a small counter here. Reads stay cheap no matter how many
// transactions pile up.
//
// Terms follow the prepaid-instrument reference dates:
//   前期 = 4/1–9/30  (key "<year>-H1")
//   後期 = 10/1–3/31 (key "<year>-H2", where <year> is the year it started)
export function termKeyOf(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  if (m >= 4 && m <= 9) return `${y}-H1`;
  if (m >= 10) return `${y}-H2`;
  return `${y - 1}-H2`;
}

// Human-readable range for a term key, e.g. "2026-H1" → "2026/4/1〜2026/9/30".
export function termLabel(key) {
  const [y, half] = key.split("-");
  const year = Number(y);
  return half === "H1"
    ? `${year}/4/1〜${year}/9/30`
    : `${year}/10/1〜${year + 1}/3/31`;
}

// Stamps the start date the first time the store signs in. Everything the
// 集計 screen shows is "since this date".
export async function ensureStatsStarted() {
  const snap = await get(ref(db, "stats/startedAt"));
  if (!snap.exists()) await set(ref(db, "stats/startedAt"), Date.now());
}

// `cash` is money actually paid in (charges only — bonuses are never cash).
// `points` is a per-category breakdown, mirroring how the store thinks about
// them: 入金ポイント (depositBonus / weather / gacha), 購入ポイント (purchase),
// 友達紹介ポイント (referral). The grand total is kept alongside so the
// dashboard doesn't have to add the categories up itself.
export const POINT_CATEGORIES = ["depositBonus", "weather", "gacha", "purchase", "referral"];

export async function recordStats({ cash = 0, points = {} }) {
  const term = termKeyOf();
  const updates = {};
  if (cash) {
    updates["stats/cashTotal"] = increment(cash);
    updates[`stats/terms/${term}/cash`] = increment(cash);
  }
  let pointTotal = 0;
  for (const key of POINT_CATEGORIES) {
    const value = points[key] || 0;
    if (!value) continue;
    pointTotal += value;
    updates[`stats/points/${key}`] = increment(value);
    updates[`stats/terms/${term}/points/${key}`] = increment(value);
  }
  if (pointTotal) {
    updates["stats/pointTotal"] = increment(pointTotal);
    updates[`stats/terms/${term}/point`] = increment(pointTotal);
  }
  if (Object.keys(updates).length === 0) return;
  await update(ref(db), updates);
}

export async function getStats() {
  const snapshot = await get(ref(db, "stats"));
  return snapshot.val() || {};
}

// Flattens every customer's history into one list for the 集計 screen.
// This reads the whole accounts node, which is why it only runs when the
// store actually opens the transaction list — never on the dashboard.
// Entries written before timestamps existed are skipped: without a date
// there's no way to say which term they belong to.
export async function listTransactions({ termKey = null, nameQuery = "" } = {}) {
  const snapshot = await get(ref(db, "accounts"));
  const data = snapshot.val() || {};
  const rows = [];
  for (const [id, acc] of Object.entries(data)) {
    const name = acc.profile?.name || "(名前未登録)";
    if (nameQuery && !name.includes(nameQuery) && !id.includes(nameQuery)) continue;
    for (const h of acc.history || []) {
      if (!h.ts) continue;
      // 購入ポイントはお会計の行に付与ポイントとして出るので、単独では出さない
      if (h.kind === "purchasePoint") continue;
      if (termKey && termKeyOf(new Date(h.ts)) !== termKey) continue;
      rows.push({ ...h, customerId: id, customerName: name });
    }
  }
  rows.sort((a, b) => b.ts - a.ts);
  return rows;
}

// Reference-date (基準日) snapshots. The scheduled Netlify function writes
// these just after midnight on 4/1 and 10/1. This is the client-side
// fallback: if a run was missed, the store's 集計 screen records it the next
// time it's opened, flagged `late` so nobody mistakes it for the real
// closing figure.
export function closedTermKeysSince(startedAt, now = new Date()) {
  if (!startedAt) return [];
  const keys = [];
  const start = new Date(startedAt);
  for (let y = start.getFullYear() - 1; y <= now.getFullYear(); y += 1) {
    // 前期 closes 9/30, 後期 closes 3/31 of the following year.
    const candidates = [
      { key: `${y}-H1`, end: new Date(y, 8, 30, 23, 59, 59) },
      { key: `${y}-H2`, end: new Date(y + 1, 2, 31, 23, 59, 59) },
    ];
    for (const c of candidates) {
      if (c.end > start && c.end < now) keys.push(c.key);
    }
  }
  return keys;
}

export async function recordMissingSnapshots() {
  const stats = await getStats();
  if (!stats.startedAt) return;
  const due = closedTermKeysSince(stats.startedAt);
  const missing = due.filter((k) => !(stats.snapshots || {})[k]);
  if (missing.length === 0) return;

  const accountsSnap = await get(ref(db, "accounts"));
  const accounts = accountsSnap.val() || {};
  let deposit = 0;
  let point = 0;
  for (const acc of Object.values(accounts)) {
    deposit += acc.depositBalance || 0;
    point += acc.pointBalance || 0;
  }

  const updates = {};
  for (const key of missing) {
    const term = (stats.terms || {})[key] || {};
    updates[`stats/snapshots/${key}`] = {
      at: Date.now(),
      date: null,
      deposit,
      point,
      cash: term.cash || 0,
      issuedPoints: term.point || 0,
      late: true,
    };
  }
  await update(ref(db), updates);
}

// Today's rain probability, written by the hourly weather job. Read-only
// here — the browser never calls 気象庁 directly, so every device shows the
// same number and the forecast isn't fetched once per open tab.
export function subscribeToWeather(callback) {
  return onValue(ref(db, "weather"), (snapshot) => callback(snapshot.val() || {}));
}

// Resolves a postal code to a 気象庁 forecast area. Runs only when the store
// saves its weather settings.
export async function lookupWeatherArea(zip) {
  const res = await fetch(`/.netlify/functions/lookup-area?zip=${encodeURIComponent(zip)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "地域の判定に失敗しました");
  return json;
}
