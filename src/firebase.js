// Firebase setup for PicoPay
// This connects to the "PicoPay" Firebase project's Realtime Database and Authentication.
import { initializeApp } from "firebase/app";
import {
  getDatabase, ref, onValue, set, get, update, remove, increment,
  push, query, orderByChild, limitToLast, startAt, endAt,
} from "firebase/database";
import { getMessaging, getToken, isSupported as isMessagingSupported } from "firebase/messaging";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
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

// 店舗用とお客様用で、Firebase アプリの名前を分ける(2026-08-07)。
//
// ログイン状態は「アプリ名」ごとに別の場所へ保存される。1つの名前を共有して
// いると、同じブラウザでお客様の SMS 認証を通した時点で店舗のログインが
// 上書きされ、決済が「この操作を行う権限がありません」で 403 になる。
// テストで1台を使い回すたびに壊れるうえ、店舗の人が自分のスマホをお客様
// として使う場面でも同じことが起きる。
//
// 1つのタブは /store か /customer のどちらかなので、そのタブで使う側の
// 名前で初期化すれば足りる。
const SIDE =
  typeof window !== "undefined" && window.location.pathname.startsWith("/store")
    ? "store"
    : "customer";

const app = initializeApp(firebaseConfig, SIDE);
export const db = getDatabase(app);
export const auth = getAuth(app);

// ---- Which store are we looking at? ----
// Every store's data lives under stores/<storeId>/. Rather than threading the
// store id through every call site, it's resolved once at sign-in (staff) or
// from the customer id (customer) and held here. `sref` builds a path inside
// the current store; anything outside a store (the lookup indexes, the store
// list) uses ref(db, ...) directly.
let currentStoreId = null;

export function setCurrentStore(storeId) {
  currentStoreId = storeId;
}

export function getCurrentStore() {
  return currentStoreId;
}

function sref(path = "") {
  if (!currentStoreId) throw new Error("店舗が特定されていません");
  return ref(db, path ? `stores/${currentStoreId}/${path}` : `stores/${currentStoreId}`);
}

// Path string for multi-location updates, which take paths from the root.
function spath(path) {
  if (!currentStoreId) throw new Error("店舗が特定されていません");
  return `stores/${currentStoreId}/${path}`;
}

// ---- Push notifications (Web Push via Firebase Cloud Messaging) ----
// Generated in Firebase console → Project settings → Cloud Messaging →
// Web configuration → "Web Push certificates". This is safe to keep in
// client code — it identifies the project, not a secret credential.
const VAPID_KEY = "BKdzxi1YhwTVGdrLzaWou8govXVJu45ftEyWjG1huuOjs1ZfQ92v_2QSOS2AUa1eX7FhSI1sc5gaL14dxmdnoWA";

// Asks the browser for notification permission and, if granted, returns
// this device's FCM token (used to target push notifications at it).
// Returns null if unsupported (e.g. desktop-only Safari) or not granted.
function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isPwa() {
  if (window.navigator.standalone === true) return true;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return false;
}
export async function requestPushToken() {
  const supported = await isMessagingSupported().catch(() => false);
  if (!supported) {
    console.warn("[FCM] このブラウザはプッシュ通知に対応していません");
    return { token: null, error: "unsupported" };
  }
  if (!("serviceWorker" in navigator)) {
    console.warn("[FCM] Service Worker が利用できません");
    return { token: null, error: "no-sw" };
  }

  if (isIos() && !isPwa()) {
    console.warn("[FCM] iOS Safari はホーム画面に追加後、PWA として開く必要があります");
    return { token: null, error: "ios-not-pwa" };
  }

  try {
    const existingReg = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
    const registration = existingReg || await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("[FCM] 通知許可が得られませんでした:", permission);
      return { token: null, error: "denied" };
    }

    const messaging = getMessaging(app);
    const token = await getToken(messaging, { 
      vapidKey: VAPID_KEY, 
      serviceWorkerRegistration: registration 
    });
    
    if (!token) {
      console.warn("[FCM] トークンの取得に失敗しました");
      return { token: null, error: "no-token" };
    }
    
    console.log("[FCM] トークン取得成功:", token.slice(0, 20) + "...");
    return { token, error: null };
  } catch (e) {
    console.error("[FCM] トークン取得中にエラー:", e);
    return { token: null, error: e.message };
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

// Transactions live under `transactions/<customerId>`, not in here. Keeping
// them nested meant every read of an account — and the customer list reads
// them all — downloaded the entire transaction history along with it, which
// is billed by the byte and grows forever.
const DEFAULT_ACCOUNT = {
  pointBalance: 0,
  depositBalance: 0,
  bonusEligible: false,
};

// Read just a customer's phone number (public by design — see security
// rules) so the app can decide whether to show the phone verification gate
// *before* the customer is authenticated (otherwise it's a chicken-and-egg
// problem: you'd need to be verified to read the data that tells you
// verification is needed). Also reads whether verification is required at
// all for this account (store staff can turn it off per customer).
export async function getAccountVerificationInfo(customerId) {
  const [phoneSnap, requireSnap] = await Promise.all([
    get(sref(`accounts/${customerId}/profile/phone`)),
    get(sref(`accounts/${customerId}/requireVerification`)),
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
  const accountRef = sref(`accounts/${customerId}`);
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
  const snapshot = await get(sref(`accounts/${customerId}`));
  return snapshot.val() || DEFAULT_ACCOUNT;
}

// Overwrite the full account object for a customer.
export async function saveAccount(customerId, account) {
  await set(sref(`accounts/${customerId}`), account);
}

// Set a customer's status: "active" | "blacklisted" | "suspended".
// Blacklisted/suspended customers are blocked from transacting (checked at
// scan time and shown on their own screen) but their data is kept.
export async function setCustomerStatus(customerId, status) {
  await update(sref(`accounts/${customerId}`), { status });
}

// 顧客の完全削除。データは消さず、削除の印を付けて残高だけ0にする
// (2026-08-07)。実際の処理はサーバー側(transact.js)。ブラウザからは
// 残高を書き換えられないルールなので、ここで直接消すことはできない。
export function deleteCustomerPermanently(customerId) {
  return callTransact({ action: "deleteCustomer", customerId });
}

// Re-issue access for a customer who lost their phone or changed their
// number. Requires the store to have confirmed a photo ID first. The photo
// is stored under a separate `idPhotos/` path (not nested inside the
// account) so that bulk-loading the customer list doesn't have to pull
// every photo along with it. If the phone number changed, this also updates
// the profile so future SMS verification checks against the new number.
export async function reissueCustomerAccess({ customerId, newPhone, idPhotoDataUrl }) {
  if (idPhotoDataUrl) {
    await set(sref(`idPhotos/${customerId}`), {
      dataUrl: idPhotoDataUrl,
      verifiedAt: Date.now(),
    });
  }
  if (newPhone) {
    await update(sref(`accounts/${customerId}/profile`), { phone: newPhone });
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
  await update(ref(db), {
    [spath(`accounts/${customerId}`)]: account,
    // Without this the fixed customer URL can't tell which store the id
    // belongs to.
    [`customerIndex/${customerId}`]: currentStoreId,
  });
  return customerId;
}
function normalizePushTokens(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === "object") return Object.keys(val);
  return [];
}
// List all registered customers (for the store's customer list screen).
export async function listCustomers() {
  const snapshot = await get(sref("accounts"));
  const data = snapshot.val() || {};
  return Object.entries(data)
    // 完全削除した人はデータとしては残しているが、一覧には出さない
    // (2026-08-07)。
    .filter(([, acc]) => acc.status !== "deleted")
    .map(([id, acc]) => ({
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
// 1人分だけを一覧用の形で読む。会計・登録・状態変更のたびに listCustomers()
// で全顧客を読み直していたが、それだと1会計ごとに顧客数ぶんの読み込みが
// 発生する(2026-08-06)。変わったのは1人なので、その1人だけ差し替える。
export async function getCustomerEntry(customerId) {
  const acc = (await get(sref(`accounts/${customerId}`))).val();
  // null を返すと呼び出し側(App.jsx)が一覧から取り除く。完全削除した人は
  // データとしては残っているが一覧には出さないので、ここでも null を返す。
  if (!acc || acc.status === "deleted") return null;
  return {
    id: customerId,
    name: acc.profile?.name || "(名前未登録)",
    phone: acc.profile?.phone || null,
    email: acc.profile?.email || null,
    balance: (acc.pointBalance || 0) + (acc.depositBalance || 0),
    pointBalance: acc.pointBalance || 0,
    depositBalance: acc.depositBalance || 0,
    notifyOptIn: acc.notifyOptIn || null,
    pushTokens: acc.pushTokens || [],
  };
}

export async function getStoreSettings() {
  const snapshot = await get(sref("storeSettings"));
  return snapshot.val() || {};
}

export async function saveStoreSettings(settings) {
  await update(sref("storeSettings"), settings);
}

// The three brand images, kept apart from storeSettings. storeSettings is
// read in full on every charge and sale (the server needs the bonus rates),
// and a few hundred KB of embedded logo/icon/hero images has no business
// riding along with that every time.
// 状態表示の文言。店舗ごとの上書きと、全店舗共通の既定。どちらも
// AI Console が set-status-messages.js 経由で書き換える(2026-08-06)。
export async function getStatusMessages() {
  const [storeSnap, sharedSnap] = await Promise.all([
    get(sref("statusMessages")),
    get(ref(db, "sharedStatusMessages")),
  ]);
  return { store: storeSnap.val() || {}, shared: sharedSnap.val() || {} };
}

export async function getBranding() {
  const snapshot = await get(sref("branding"));
  return snapshot.val() || {};
}

// ブランド画像(ロゴ・アイコン・ヒーロー)は Firebase Storage に置き、
// データベースには URL だけを持つ(2026-08-06)。
//
// 以前は画像そのもの(data URI)をデータベースに入れていた。決済のたびに
// 読まれる問題は storeSettings から branding に分けて解消したが、お客様が
// アプリを開くたびに読む経路はそのまま残っていた。ヒーロー画像1枚で
// 80〜150KB あり、これが画面表示のたびに毎回流れていた。
//
// アップロードはブラウザから直接ではなくサーバー(upload-branding.js)を
// 通す。Storage のルールは Realtime Database の storeAdmins を参照できず、
// ブラウザ側では「ログインしているか」しか判定できない。お客様も SMS 認証で
// ログインするため、それだけだと誰でも他店の画像を差し替えられてしまう。
export async function saveBranding(fields) {
  const idToken = await auth.currentUser.getIdToken();
  const results = {};
  for (const [field, value] of Object.entries(fields)) {
    const res = await fetch("/.netlify/functions/upload-branding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, storeId: currentStoreId, field, dataUrl: value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "画像の保存に失敗しました");
    results[field] = data.url;
  }
  return results;
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
  const snap = await get(sref("stats/startedAt"));
  if (!snap.exists()) await set(sref("stats/startedAt"), Date.now());
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
    updates[spath("stats/cashTotal")] = increment(cash);
    updates[spath(`stats/terms/${term}/cash`)] = increment(cash);
  }
  let pointTotal = 0;
  for (const key of POINT_CATEGORIES) {
    const value = points[key] || 0;
    if (!value) continue;
    pointTotal += value;
    updates[spath(`stats/points/${key}`)] = increment(value);
    updates[spath(`stats/terms/${term}/points/${key}`)] = increment(value);
  }
  if (pointTotal) {
    updates[spath("stats/pointTotal")] = increment(pointTotal);
    updates[spath(`stats/terms/${term}/point`)] = increment(pointTotal);
  }
  if (Object.keys(updates).length === 0) return;
  await update(ref(db), updates);
}

export async function getStats() {
  const snapshot = await get(sref("stats"));
  return snapshot.val() || {};
}

// Flattens every customer's history into one list for the 集計 screen.
// This reads the whole accounts node, which is why it only runs when the
// store actually opens the transaction list — never on the dashboard.
// Entries written before timestamps existed are skipped: without a date
// there's no way to say which term they belong to.
// 期の開始・終了(JST)を求める。termKey は "2026-H1"(4/1〜9/30)か
// "2026-H2"(10/1〜翌3/31)。
function termRange(termKey) {
  const [yStr, half] = termKey.split("-");
  const y = Number(yStr);
  return half === "H1"
    ? { from: new Date(y, 3, 1).getTime(), to: new Date(y, 9, 1).getTime() - 1 }
    : { from: new Date(y, 9, 1).getTime(), to: new Date(y + 1, 3, 1).getTime() - 1 };
}

// 集計画面の取引履歴。
//
// 以前は accounts と transactions を丸ごと読んでから絞り込んでいたため、
// 読む量が「その店舗の全履歴」に比例して永久に増え続けていた(2026-08-06に
// 判明)。今は transact.js が書いている店舗単位の索引 txIndex を、ts の
// 範囲と件数を指定して引く。読む量は「画面に出す分」だけになる。
//
// before は「これより古いものを続きとして読む」ためのカーソル(前ページの
// 最後の ts)。名前での絞り込みは索引に名前を持たせていないので、顧客一覧
// (小さい)を引いて突き合わせる。
export async function listTransactions({
  termKey = null,
  nameQuery = "",
  limit = 50,
  before = null,
} = {}) {
  const range = termKey ? termRange(termKey) : null;
  let upper = range ? range.to : Number.MAX_SAFE_INTEGER;
  if (before) upper = Math.min(upper, before - 1);
  const lower = range ? range.from : 0;

  // 名前で絞る時は、その名前の顧客IDを先に確定させる。accounts は残高と
  // 名前だけの小さいノードなので、ここを読むのは問題にならない。
  let allowedIds = null;
  let names = {};
  const accounts = (await get(sref("accounts"))).val() || {};
  for (const [id, acc] of Object.entries(accounts)) {
    names[id] = acc.profile?.name || "(名前未登録)";
  }
  if (nameQuery) {
    allowedIds = new Set(
      Object.keys(names).filter((id) => names[id].includes(nameQuery) || id.includes(nameQuery))
    );
    if (allowedIds.size === 0) return { rows: [], nextBefore: null, done: true };
  }

  // 表示から外れる行(購入ポイント単独・取消済み・名前の絞り込み外)がある
  // ぶん、要求件数ちょうどだと足りなくなる。少し多めに引いて、埋まるまで
  // 遡る。
  const rows = [];
  let cursor = upper;
  let done = false;
  for (let pass = 0; pass < 5 && rows.length < limit; pass += 1) {
    const snap = await get(
      query(sref("txIndex"), orderByChild("ts"), startAt(lower), endAt(cursor), limitToLast(limit * 2))
    );
    const batch = [];
    snap.forEach((child) => {
      batch.push({ id: child.key, ...child.val() });
    });
    if (batch.length === 0) {
      done = true;
      break;
    }
    batch.sort((a, b) => b.ts - a.ts);
    for (const h of batch) {
      if (h.kind === "purchasePoint") continue; // お会計の行に付与分として出る
      if (h.canceled) continue;
      if (allowedIds && !allowedIds.has(h.customerId)) continue;
      rows.push({ ...h, customerName: names[h.customerId] || "(名前未登録)" });
      if (rows.length >= limit) break;
    }
    cursor = batch[batch.length - 1].ts - 1;
    if (cursor < lower) {
      done = true;
      break;
    }
  }

  return {
    rows,
    nextBefore: rows.length ? rows[rows.length - 1].ts : null,
    done: done || rows.length < limit,
  };
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


// Today's rain probability, written by the hourly weather job. Read-only
// here — the browser never calls 気象庁 directly, so every device shows the
// same number and the forecast isn't fetched once per open tab.
export function subscribeToWeather(callback) {
  return onValue(sref("weather"), (snapshot) => callback(snapshot.val() || {}));
}

// Resolves a postal code to a 気象庁 forecast area. Runs only when the store
// saves its weather settings.
export async function lookupWeatherArea(zip) {
  let res;
  try {
    res = await fetch(`/.netlify/functions/lookup-area?zip=${encodeURIComponent(zip)}`);
  } catch (e) {
    throw new Error("通信に失敗しました(オフラインの可能性があります)");
  }
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch (e) {
    // A non-JSON body means the request never reached the function — most
    // often the function isn't deployed and Netlify returned the SPA's
    // index.html instead. Say so plainly rather than "判定に失敗しました".
    throw new Error(`地域判定の処理が見つかりません(応答コード ${res.status})`);
  }
  if (!res.ok) throw new Error(`${json.error || "地域の判定に失敗しました"}(${res.status})`);
  return json;
}

// ---- Transactions ----
// Stored per customer under transactions/<customerId>/<pushId>, deliberately
// outside the account. Accounts are read constantly (the customer list reads
// every one of them on every sale); transactions are read rarely and grow
// without limit, so the two don't belong in the same place.

export async function appendTransactions(customerId, entries) {
  if (!entries || entries.length === 0) return;
  const updates = {};
  for (const entry of entries) {
    const key = push(sref(`transactions/${customerId}`)).key;
    updates[spath(`transactions/${customerId}/${key}`)] = entry;
  }
  await update(ref(db), updates);
}

// Newest first. `limit` caps what comes down the wire — the customer's screen
// asks for a page at a time rather than the whole history.
export async function listAccountTransactions(customerId, limit = 50) {
  const snapshot = await get(
    query(sref(`transactions/${customerId}`), orderByChild("ts"), limitToLast(limit))
  );
  const rows = [];
  snapshot.forEach((child) => {
    rows.push({ id: child.key, ...child.val() });
  });
  return rows.reverse();
}

// Live version for the customer's own screen, capped the same way.
export function subscribeToAccountTransactions(customerId, callback, limit = 50) {
  return onValue(
    query(sref(`transactions/${customerId}`), orderByChild("ts"), limitToLast(limit)),
    (snapshot) => {
      const rows = [];
      snapshot.forEach((child) => {
        rows.push({ id: child.key, ...child.val() });
      });
      callback(rows.reverse());
    }
  );
}

// ---- Store lookup and creation ----
// Two indexes sit outside the per-store data, because they're what tells you
// which store to look in:
//   storeAdmins/<uid>       → the store a signed-in staff member belongs to
//   customerIndex/<custId>  → the store a customer belongs to
// The customer index is what lets one fixed URL serve every store: the QR
// carries the customer id, and the id resolves the store.

export async function resolveStoreForAdmin(uid) {
  const snapshot = await get(ref(db, `storeAdmins/${uid}`));
  return snapshot.val() || null;
}

export async function resolveStoreForCustomer(customerId) {
  const snapshot = await get(ref(db, `customerIndex/${customerId}`));
  return snapshot.val() || null;
}

// Store creation lives server-side (netlify/functions/create-store.js): it
// has to create the staff login and write storeAdmins, and neither should be
// possible from a browser.

// ---- Roles ----
// Four levels of access on one shared device: other1 (no password, what the
// screen starts as), other2, other3, admin, and adminオーナー. The password
// check happens server-side (netlify/functions/verify-role.js) because the
// device is shared — anything the browser can read, every member of staff
// can read.
export const PERMISSIONS = [
  { key: "blacklist", label: "ブラックリスト・一時停止" },
  { key: "deleteCustomer", label: "会員削除" },
  { key: "settingsBasic", label: "設定の変更(オン/オフを除く)" },
  { key: "settingsFull", label: "設定画面すべて(各種集計を除く)" },
  { key: "aggregate", label: "各種集計" },
];

export const ROLE_LABELS = {
  other1: "その他1",
  other2: "その他2",
  other3: "その他3",
  admin: "admin",
  owner: "adminオーナー",
};

export function subscribeToRoles(callback) {
  return onValue(sref("roles"), (snapshot) => callback(snapshot.val() || {}));
}

export async function getRoles() {
  const snapshot = await get(sref("roles"));
  return snapshot.val() || {};
}

// Permissions and passwords are saved separately: the permissions are fine
// for staff to see, the passwords are not.
export async function saveRole(role, { perms, password }) {
  const updates = { [spath(`roles/${role}`)]: perms || {} };
  if (password) updates[spath(`roleAuth/${role}`)] = password;
  await update(ref(db), updates);
}

export async function deleteRole(role) {
  await update(ref(db), {
    [spath(`roles/${role}`)]: null,
    [spath(`roleAuth/${role}`)]: null,
  });
}

export async function verifyRolePassword(role, password) {
  const res = await fetch("/.netlify/functions/verify-role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storeId: currentStoreId, role, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "確認できませんでした");
  return json;
}

// ---- Money ----
// Charges, sales and gacha spins all go through one server function. The
// browser says what happened; the server decides what it's worth and is the
// only thing allowed to write a balance.
async function callTransact(payload) {
  const user = auth.currentUser;
  if (!user) throw new Error("ログインが必要です");
  const idToken = await user.getIdToken();
  const res = await fetch("/.netlify/functions/transact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, idToken, storeId: currentStoreId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "処理に失敗しました");
  return json;
}

export function chargeAccount(customerId, amount) {
  return callTransact({ action: "charge", customerId, amount });
}

export function payFromAccount(customerId, amount) {
  return callTransact({ action: "payment", customerId, amount });
}

// Reverses a whole batch (a charge and its bonus, or a sale and its point
// award) as one unit. Staff-only, same-day only — the server enforces both.
export function cancelTransaction(customerId, transactionId) {
  return callTransact({ action: "cancel", customerId, transactionId });
}

// Returns the winning rate the server drew, so the screen can show it.
export async function spinGacha(customerId) {
  const result = await callTransact({ action: "gacha", customerId });
  return result.rate || 0;
}

// The phone number behind an account, needed before the customer is
// verified. It used to be world-readable for that reason; now the check
// happens server-side so the numbers aren't sitting in the open.
export async function fetchVerificationInfo(customerId) {
  const res = await fetch(
    `/.netlify/functions/account-check?id=${encodeURIComponent(customerId)}`
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "確認できませんでした");
  return json;
}

// The customer's own notification settings — the only part of their account
// the browser may still write, so it's written field by field rather than by
// saving the whole object back.
export async function updateNotifyPrefs(customerId, prefs, pushToken) {
  // 新しいトークンを取得したら、古いトークンはすべて置き換える
  // （同じ端末で複数トークンが発行されると同じ通知が何度も届くため）
  let tokens = {};
  if (prefs.push && pushToken) {
    tokens[pushToken] = true;
  }
  
  const hasTokens = Object.keys(tokens).length > 0;

  const updates = {};
  updates[spath(`accounts/${customerId}/notifyOptIn`)] = prefs;
  updates[spath(`accounts/${customerId}/pushTokens`)] = hasTokens ? tokens : null;
  
  updates[spath(`pushIndex/${customerId}`)] = prefs.push && hasTokens
    ? { push: true, tokens }
    : null;

  await update(ref(db), updates);
}

// 配信の宛先の見張り。変更があった時だけ流れてくる。
export function subscribeToPushIndex(callback) {
  return onValue(sref("pushIndex"), (snap) => callback(snap.val() || {}));
}

// Full data export for the store's own records — separate from the
// operator's automatic backup. That one exists whether or not anyone
// remembers to run it; this one is a copy the store keeps for itself,
// triggered on demand from the settings screen.
// 店舗が自分の手元に控えを取るための書き出し。運営側ではバックアップを
// 持たない方針にしたので(2026-08-07)、控えが要る店舗はこれを押して自分の
// パソコンに保存する。
//
// 中身は顧客一覧と取引履歴の2つ。画面側でそれぞれCSVにする。
// 完全削除した人も、取引履歴が残っている以上ここには含める(一覧には
// 「削除済み」と分かる形で出す)。
export async function exportAllStoreData() {
  const [accountsSnap, txSnap] = await Promise.all([
    get(sref("accounts")),
    get(sref("transactions")),
  ]);
  const accounts = accountsSnap.val() || {};
  const transactions = txSnap.val() || {};

  const customers = Object.entries(accounts).map(([id, acc]) => ({
    id,
    name: acc.profile?.name || "(名前未登録)",
    phone: acc.profile?.phone || "",
    email: acc.profile?.email || "",
    pointBalance: acc.pointBalance || 0,
    depositBalance: acc.depositBalance || 0,
    status: acc.status === "deleted" ? "削除済み" : "",
  }));

  const rows = [];
  for (const [customerId, entries] of Object.entries(transactions)) {
    const name = accounts[customerId]?.profile?.name || "(名前未登録)";
    for (const e of Object.values(entries || {})) {
      rows.push({ ...e, customerId, customerName: name });
    }
  }
  rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  return { customers, transactions: rows };
}
