// ============================================
// PicoPay - src/firebase.js（完全書き換え版）
// ============================================

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signOut,
  onAuthStateChanged,
  RecaptchaVerifier,
} from 'firebase/auth';
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  onValue,
  remove,
} from 'firebase/database';
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported as isMessagingSupported,
} from 'firebase/messaging';

// ---- Firebase 初期化 ----
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';

// ---- マルチテナント用パス接頭辞 ----
function spath(path) {
  const tenantId = localStorage.getItem('tenantId') || 'default';
  if (!path) return tenantId;
  return `${tenantId}/${path}`;
}

// ---- 定数 ----
export const DEFAULT_ACCOUNT = {
  balance: 0,
  status: 'active',
  createdAt: null,
};

// ============================================
// 店舗認証（App.jsx から import される）
// ============================================

export async function storeSignIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function sendPhoneCode(phoneNumber, appVerifier) {
  return signInWithPhoneNumber(auth, phoneNumber, appVerifier);
}

export async function storeSignOut() {
  return signOut(auth);
}

export function subscribeToAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function setupRecaptcha(containerId) {
  return new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
    callback: () => {},
  });
}

// ============================================
// アカウント管理
// ============================================

export async function createAccount(accountData) {
  const customerId = crypto.randomUUID();
  const path = spath(`accounts/${customerId}`);
  await set(ref(db, path), {
    ...accountData,
    id: customerId,
    createdAt: Date.now(),
  });
  return customerId;
}

export async function getCustomerEntry(customerId) {
  const snapshot = await get(ref(db, spath(`accounts/${customerId}`)));
  return snapshot.val();
}

export async function listCustomers() {
  const snapshot = await get(ref(db, spath('accounts')));
  if (!snapshot.exists()) return [];
  const customers = [];
  snapshot.forEach((child) => {
    customers.push({ id: child.key, ...child.val() });
  });
  return customers;
}

export function subscribeToAccount(customerId, callback) {
  return onValue(ref(db, spath(`accounts/${customerId}`)), (snap) => {
    callback(snap.val());
  });
}

export function subscribeToAccountTransactions(customerId, callback) {
  return onValue(ref(db, spath(`transactions/${customerId}`)), (snap) => {
    const txs = [];
    if (snap.exists()) {
      snap.forEach((child) => txs.push({ id: child.key, ...child.val() }));
    }
    callback(txs);
  });
}

export async function listAccountTransactions(customerId) {
  const snapshot = await get(ref(db, spath(`transactions/${customerId}`)));
  if (!snapshot.exists()) return [];
  const txs = [];
  snapshot.forEach((child) => txs.push({ id: child.key, ...child.val() }));
  return txs;
}

export async function getAccountOnce(customerId) {
  const snapshot = await get(ref(db, spath(`accounts/${customerId}`)));
  return snapshot.val() || DEFAULT_ACCOUNT;
}

export async function setCustomerStatus(customerId, status) {
  await update(ref(db, spath(`accounts/${customerId}`)), { status });
}

export async function deleteCustomerPermanently(customerId) {
  await remove(ref(db, spath(`accounts/${customerId}`)));
  await remove(ref(db, spath(`transactions/${customerId}`)));
}

export async function reissueCustomerAccess(customerId) {
  const newPin = Math.floor(1000 + Math.random() * 9000).toString();
  await update(ref(db, spath(`accounts/${customerId}`)), {
    pin: newPin,
    reissuedAt: Date.now(),
  });
  return newPin;
}

// ============================================
// ブランディング・設定
// ============================================

export async function getBranding(storeId) {
  const snapshot = await get(ref(db, spath(`branding/${storeId}`)));
  return snapshot.val();
}

export async function saveBranding(storeId, brandingData) {
  if (!storeId) throw new Error('storeId is required');
  if (!brandingData) throw new Error('brandingData is required');
  await set(ref(db, spath(`branding/${storeId}`)), {
    ...brandingData,
    updatedAt: Date.now(),
  });
}

export async function getStoreSettings(storeId) {
  const snapshot = await get(ref(db, spath(`stores/${storeId}/settings`)));
  return snapshot.val();
}

export async function saveStoreSettings(storeId, settings) {
  await set(ref(db, spath(`stores/${storeId}/settings`)), {
    ...settings,
    updatedAt: Date.now(),
  });
}

export async function getStatusMessages() {
  const snapshot = await get(ref(db, spath('statusMessages')));
  return snapshot.val() || {};
}

// ============================================
// プッシュ通知（FCM）
// ============================================

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isPwa() {
  if (window.navigator.standalone === true) return true;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return false;
}

export async function requestPushToken() {
  const supported = await isMessagingSupported().catch(() => false);
  if (!supported) return { token: null, error: 'unsupported' };
  if (!('serviceWorker' in navigator)) return { token: null, error: 'no-sw' };
  if (isIos() && !isPwa()) return { token: null, error: 'ios-not-pwa' };

  try {
    const existingReg = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    const registration = existingReg || await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { token: null, error: 'denied' };

    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (!token) return { token: null, error: 'no-token' };
    return { token, error: null };
  } catch (e) {
    return { token: null, error: e.message };
  }
}

export async function sendPushNotification(token, payload) {
  // TODO: バックエンド経由で FCM API v1 を呼ぶべき
  // フロントエンドから直接送るのはセキュリティ的に非推奨
  console.warn('[FCM] sendPushNotification はバックエンド実装が必要です', token, payload);
}

export function onForegroundMessage(handler) {
  const messaging = getMessaging(app);
  return onMessage(messaging, (payload) => {
    console.log('[FCM] Foreground message:', payload);
    handler(payload);
  });
}

export async function updateNotifyPrefs(customerId, prefs, pushToken) {
  let tokens = {};
  if (prefs.push && pushToken) tokens[pushToken] = true;
  const hasTokens = Object.keys(tokens).length > 0;

  const updates = {};
  updates[spath(`accounts/${customerId}/notifyOptIn`)] = prefs;
  updates[spath(`accounts/${customerId}/pushTokens`)] = hasTokens ? tokens : null;
  updates[spath(`pushIndex/${customerId}`)] = prefs.push && hasTokens ? { push: true, tokens } : null;
  await update(ref(db), updates);
}

export function subscribeToPushIndex(callback) {
  return onValue(ref(db, spath('pushIndex')), (snap) => {
    callback(snap.val() || {});
  });
}

export function normalizePushTokens(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'object') return Object.keys(val);
  return [];
}

// ============================================
// 取引（入金・支払い・取消）
// ============================================

export async function chargeAccount(customerId, amount, metadata = {}) {
  const txId = crypto.randomUUID();
  const now = Date.now();
  const path = spath(`transactions/${customerId}/${txId}`);
  await set(ref(db, path), {
    type: 'charge',
    value: amount,  // ← gross ではなく value
    ...metadata,
    createdAt: now,
  });
  // 残高更新
  const account = await getAccountOnce(customerId);
  const newBalance = (account.balance || 0) + amount;
  await update(ref(db, spath(`accounts/${customerId}`)), { balance: newBalance });
  return txId;
}

export async function payFromAccount(customerId, amount, metadata = {}) {
  const txId = crypto.randomUUID();
  const now = Date.now();
  const path = spath(`transactions/${customerId}/${txId}`);
  await set(ref(db, path), {
    type: 'payment',
    value: amount,  // ← gross ではなく value
    ...metadata,
    createdAt: now,
  });
  const account = await getAccountOnce(customerId);
  const newBalance = (account.balance || 0) - amount;
  if (newBalance < 0) throw new Error('残高不足');
  await update(ref(db, spath(`accounts/${customerId}`)), { balance: newBalance });
  return txId;
}

export async function cancelTransaction(customerId, txId) {
  const snap = await get(ref(db, spath(`transactions/${customerId}/${txId}`)));
  if (!snap.exists()) throw new Error('取引が見つかりません');
  const tx = snap.val();
  await update(ref(db, spath(`transactions/${customerId}/${txId}`)), {
    cancelled: true,
    cancelledAt: Date.now(),
  });
  // 残高巻き戻し
  const account = await getAccountOnce(customerId);
  const delta = tx.type === 'charge' ? -tx.value : tx.value;
  const newBalance = (account.balance || 0) + delta;
  await update(ref(db, spath(`accounts/${customerId}`)), { balance: newBalance });
}

export async function listTransactions(customerId) {
  return listAccountTransactions(customerId);
}

// ============================================
// 統計
// ============================================

export async function getStats(storeId) {
  const snapshot = await get(ref(db, spath(`stats/${storeId}`)));
  return snapshot.val() || { totalSales: 0, totalCharges: 0, count: 0 };
}

export async function ensureStatsStarted(storeId) {
  const snap = await get(ref(db, spath(`stats/${storeId}`)));
  if (!snap.exists()) {
    await set(ref(db, spath(`stats/${storeId}`)), {
      totalSales: 0,
      totalCharges: 0,
      count: 0,
      startedAt: Date.now(),
    });
  }
}

// ============================================
// 店舗・ロール管理
// ============================================

export function setCurrentStore(storeId) {
  localStorage.setItem('tenantId', storeId);
}

export async function resolveStoreForAdmin(adminId) {
  const snapshot = await get(ref(db, `admins/${adminId}/stores`));
  return snapshot.val() || [];
}

export async function resolveStoreForCustomer(customerId) {
  const snapshot = await get(ref(db, spath(`accounts/${customerId}/storeId`)));
  return snapshot.val();
}

export function subscribeToRoles(storeId, callback) {
  return onValue(ref(db, spath(`stores/${storeId}/roles`)), (snap) => {
    callback(snap.val() || {});
  });
}

export async function saveRole(storeId, roleId, roleData) {
  await set(ref(db, spath(`stores/${storeId}/roles/${roleId}`)), {
    ...roleData,
    updatedAt: Date.now(),
  });
}

export async function deleteRole(storeId, roleId) {
  await remove(ref(db, spath(`stores/${storeId}/roles/${roleId}`)));
}

export async function verifyRolePassword(storeId, roleId, password) {
  const snapshot = await get(ref(db, spath(`stores/${storeId}/roles/${roleId}`)));
  const role = snapshot.val();
  if (!role) return false;
  return role.password === password;
}

// ============================================
// 天気
// ============================================

export function subscribeToWeather(areaCode, callback) {
  return onValue(ref(db, `weather/${areaCode}`), (snap) => {
    callback(snap.val());
  });
}

export async function lookupWeatherArea(query) {
  // TODO: 実際の天気API連携が必要
  // スタブ実装
  return { code: query, name: query };
}

// ============================================
// その他
// ============================================

export async function exportAllStoreData(storeId) {
  const [accountsSnap, txSnap, brandingSnap] = await Promise.all([
    get(ref(db, spath('accounts'))),
    get(ref(db, spath('transactions'))),
    get(ref(db, spath(`branding/${storeId}`))),
  ]);
  return {
    accounts: accountsSnap.val() || {},
    transactions: txSnap.val() || {},
    branding: brandingSnap.val() || {},
    exportedAt: Date.now(),
  };
}

export async function spinGacha(customerId, cost) {
  const account = await getAccountOnce(customerId);
  if ((account.balance || 0) < cost) throw new Error('残高不足');
  const prizes = ['A賞', 'B賞', 'C賞', 'はずれ'];
  const result = prizes[Math.floor(Math.random() * prizes.length)];
  await payFromAccount(customerId, cost, { type: 'gacha', result });
  return result;
}

export async function fetchVerificationInfo(code) {
  const snapshot = await get(ref(db, spath(`verifications/${code}`)));
  return snapshot.val();
}
