// Firebase setup for PicoPay
// This connects to the "PicoPay" Firebase project's Realtime Database and Authentication.
import { initializeApp } from "firebase/app";
import {
  getDatabase, ref, onValue, set, get, update, remove, increment,
  push, query, orderByChild, limitToLast, startAt, endAt,
} from "firebase/database";
import { getMessaging, getToken, onMessage, isSupported as isMessagingSupported } from "firebase/messaging";
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
const SIDE =
  typeof window !== "undefined" && window.location.pathname.startsWith("/store")
    ? "store"
    : "customer";

const app = initializeApp(firebaseConfig, SIDE);
export const db = getDatabase(app);
export const auth = getAuth(app);

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

function spath(path) {
  if (!currentStoreId) throw new Error("店舗が特定されていません");
  return `stores/${currentStoreId}/${path}`;
}

const VAPID_KEY = "BKdzxi1YhwTVGdrLzaWou8govXVJu45ftEyWjG1huuOjs1ZfQ92v_2QSOS2AUa1eX7FhSI1sc5gaL14dxmdnoWA";

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

export function onForegroundMessage(callback) {
  const messaging = getMessaging(app);
  return onMessage(messaging, (payload) => {
    callback(payload);
  });
}

export async function sendPushNotification({ tokens, title, body, icon, storeId }) {
  const res = await fetch("/.netlify/functions/send-push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens, title, body, icon, storeId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || "送信リクエストに失敗しました");
  }
  return res.json();
}

export function subscribeToAuth(callback) {
  return onAuthStateChanged(auth, callback);
}
export async function storeSignIn(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}
export async function storeSignOut() {
  await signOut(auth);
}

export function setupRecaptcha(containerId) {
  return new RecaptchaVerifier(auth, containerId, { size: "invisible" });
}
export async function sendPhoneCode(phoneNumber, recaptchaVerifier) {
  return await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier);
}

const DEFAULT_ACCOUNT = {
  pointBalance: 0,
  depositBalance: 0,
  bonusEligible: false,
};

export async function getAccountVerificationInfo(customerId) {
  const [phoneSnap, requireSnap] = await Promise.all([
    get(sref(`accounts/${customerId}/profile/phone`)),
    get(sref(`accounts/${customerId}/requireVerification`)),
  ]);
  return {
    phone: phoneSnap.val() || null,
    requireVerification: requireSnap.val() !== false,
  };
}

export function subscribeToAccount(customerId, callback) {
  const accountRef = sref(`accounts/${customerId}`);
  const unsubscribe = onValue(accountRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      callback(data);
    } else {
      set(accountRef, DEFAULT_ACCOUNT);
      callback(DEFAULT_ACCOUNT);
    }
  });
  return unsubscribe;
}

export async function getAccountOnce(customerId) {
  const snapshot = await get(sref(`accounts/${customerId}`));
  return snapshot.val() || DEFAULT_ACCOUNT;
}

export async function saveAccount(customerId, account) {
  await set(sref(`accounts/${customerId}`), account);
}

export async function setCustomerStatus(customerId, status) {
  await update(sref(`accounts/${customerId}`), { status });
}

export function deleteCustomerPermanently(customerId) {
  return callTransact({ action: "deleteCustomer", customerId });
}

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

export async function listCustomers() {
  const snapshot = await get(sref("accounts"));
  const data = snapshot.val() || {};
  return Object.entries(data)
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
      pushTokens: normalizePushTokens(acc.pushTokens),
    }));
}

export { DEFAULT_ACCOUNT };

export async function getCustomerEntry(customerId) {
  const acc = (await get(sref(`accounts/${customerId}`))).val();
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
    pushTokens: normalizePushTokens(acc.pushTokens),
  };
}

export async function getStoreSettings() {
  const snapshot = await get(sref("storeSettings"));
  return snapshot.val() || {};
}

export async function saveStoreSettings(settings) {
  await update(sref("storeSettings"), settings);
}

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

export function termKeyOf(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  if (m >= 4 && m <= 9) return `${y}-H1`;
  if (m >= 10) return `${y}-H2`;
  return `${y - 1}-H2`;
}

export function termLabel(key) {
  const [y, half] = key.split("-");
  const year = Number(y);
  return half === "H1"
    ? `${year}/4/1〜${year}/9/30`
    : `${year}/10/1〜${year + 1}/3/31`;
}

export async function ensureStatsStarted() {
  const snap = await get(sref("stats/startedAt"));
  if (!snap.exists()) await set(sref("stats/startedAt"), Date.now());
}

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

function termRange(termKey) {
  const [yStr, half] = termKey.split("-");
  const y = Number(yStr);
  return half === "H1"
    ? { from: new Date(y, 3, 1).getTime(), to: new Date(y, 9, 1).getTime() - 1 }
    : { from: new Date(y, 9, 1).getTime(), to: new Date(y + 1, 3, 1).getTime() - 1 };
}

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
      if (h.kind === "purchasePoint") continue;
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

export function closedTermKeysSince(startedAt, now = new Date()) {
  if (!startedAt) return [];
  const keys = [];
  const start = new Date(startedAt);
  for (let y = start.getFullYear() - 1; y <= now.getFullYear(); y += 1) {
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

export function subscribeToWeather(callback) {
  return onValue(sref("weather"), (snapshot) => callback(snapshot.val() || {}));
}

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
    throw new Error(`地域判定の処理が見つかりません(応答コード ${res.status})`);
  }
  if (!res.ok) throw new Error(`${json.error || "地域の判定に失敗しました"}(${res.status})`);
  return json;
}

export async function appendTransactions(customerId, entries) {
  if (!entries || entries.length === 0) return;
  const updates = {};
  for (const entry of entries) {
    const key = push(sref(`transactions/${customerId}`)).key;
    updates[spath(`transactions/${customerId}/${key}`)] = entry;
  }
  await update(ref(db), updates);
}

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

export async function resolveStoreForAdmin(uid) {
  const snapshot = await get(ref(db, `storeAdmins/${uid}`));
  return snapshot.val() || null;
}

export async function resolveStoreForCustomer(customerId) {
  const snapshot = await get(ref(db, `customerIndex/${customerId}`));
  return snapshot.val() || null;
}

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

export function cancelTransaction(customerId, transactionId) {
  return callTransact({ action: "cancel", customerId, transactionId });
}

export async function spinGacha(customerId) {
  const result = await callTransact({ action: "gacha", customerId });
  return result.rate || 0;
}

export async function fetchVerificationInfo(customerId) {
  const res = await fetch(
    `/.netlify/functions/account-check?id=${encodeURIComponent(customerId)}`
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "確認できませんでした");
  return json;
}

export async function updateNotifyPrefs(customerId, prefs, pushToken) {
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

export function subscribeToPushIndex(callback) {
  return onValue(sref("pushIndex"), (snap) => callback(snap.val() || {}));
}

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
