// ============================================
// PicoPay - src/firebase.js（バックエンド整合版）
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

// ============================================
// パス構築ヘルパー（バックエンドと完全整合）
// ============================================

/** localStorage の tenantId = 現在選択中の店舗ID */
function currentStoreId() {
  return localStorage.getItem('tenantId') || 'default';
}

/**
 * 店舗固有データのパスを構築
 * spath('accounts') → 'stores/デフォルト店舗ID/accounts'
 * spath('accounts/xxx') → 'stores/デフォルト店舗ID/accounts/xxx'
 */
function spath(subPath) {
  const storeId = currentStoreId();
  if (!subPath) return `stores/${storeId}`;
  return `stores/${storeId}/${subPath}`;
}

/**
 * 店舗IDを明示的に指定するパス（getBranding などで使用）
 * storePath('店舗A', 'branding') → 'stores/店舗A/branding'
 */
function storePath(storeId, subPath) {
  if (!subPath) return `stores/${storeId}`;
  return `stores/${storeId}/${subPath}`;
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
// アカウント管理（バックエンド: stores/{storeId}/accounts）
// ============================================

export async function createAccount(accountData) {
  const customerId = crypto.randomUUID();
  await set(ref(db, spath(`accounts/${customerId}`)), {
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
// ブランディング・設定（バックエンド整合）
// ============================================

/** ブランディング取得: stores/{storeId}/branding */
export async function getBranding(storeId) {
  const snapshot = await get(ref(db, storePath(storeId, 'branding')));
  return snapshot.val();
}

/** ブランディング保存: stores/{storeId}/branding */
export async function saveBranding(storeId, brandingData) {
  if (!storeId) throw new Error('storeId is required');
  if (!brandingData) throw new Error('brandingData is required');
  await set(ref(db, storePath(storeId, 'branding')), {
    ...brandingData,
    updatedAt: Date.now(),
  });
}

/** 店舗設定取得: stores/{storeId}/storeSettings */
export async function getStoreSettings(storeId) {
  const snapshot = await get(ref(db, storePath(storeId, 'storeSettings')));
  return snapshot.val();
}

/** 店舗設定保存: stores/{storeId}/storeSettings */
export async function saveStoreSettings(storeId, settings) {
  await set(ref(db, storePath(storeId, 'storeSettings')), {
    ...settings,
    updatedAt: Date.now(),
  });
}

/** ステータスメッセージ取得: stores/{storeId}/statusMessages */
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

/** ⚠️ 本番ではバックエンド経由に変更必須 */
export async function sendPushNotification(token, payload) {
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
  updates[spath(`accounts/${customerId}/notifyOptIn`))] = prefs;
  updates[spath(`accounts/${customerId}/pushTokens`))] = hasTokens ? tokens : null;
  updates[spath(`pushIndex/${customerId}`))] = prefs.push && hasTokens ? { push: true, tokens } : null;
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
// 取引（⚠️ フロントエンド直接書き込みは rules で禁止。Netlify Function 経由を推奨）
// ============================================

export async function chargeAccount(customerId, amount, metadata = {}) {
  const txId = crypto.randomUUID();
  await set(ref(db, spath(`transactions/${customerId}/${txId}`)), {
    type: 'charge',
    value: amount,
    ...metadata,
    createdAt: Date.now(),
  });
  const account = await getAccountOnce(customerId);
  const newBalance = (account.balance || 0) + amount;
  await update(ref(db, spath(`accounts/${customerId}`)), { balance: newBalance });
  return txId;
}

export async function payFromAccount(customerId, amount, metadata = {}) {
  const txId = crypto.randomUUID();
  await set(ref(db, spath(`transactions/${customerId}/${txId}`)), {
    type: 'payment',
    value: amount,
    ...metadata,
    createdAt: Date.now(),
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
  const account = await getAccountOnce(customerId);
  const delta = tx.type === 'charge' ? -tx.value : tx.value;
  const newBalance = (account.balance || 0) + delta;
  await update(ref(db, spath(`accounts/${customerId}`)), { balance: newBalance });
}

export async function listTransactions(customerId) {
  return listAccountTransactions(customerId);
}

// ============================================
// 統計（バックエンド整合）
// ============================================

export async function getStats(storeId) {
  const snapshot = await get(ref(db, storePath(storeId, 'stats')));
  return snapshot.val() || { totalSales: 0, totalCharges: 0, count: 0 };
}

export async function ensureStatsStarted(storeId) {
  const snap = await get(ref(db, storePath(storeId, 'stats')));
  if (!snap.exists()) {
    await set(ref(db, storePath(storeId, 'stats')), {
      totalSales: 0,
      totalCharges: 0,
      count: 0,
      startedAt: Date.now(),
    });
  }
}

// ============================================
// 店舗・ロール管理（バックエンド整合）
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
  return onValue(ref(db, storePath(storeId, 'roles')), (snap) => {
    callback(snap.val() || {});
  });
}

export async function saveRole(storeId, roleId, roleData) {
  await set(ref(db, storePath(storeId, `roles/${roleId}`)), {
    ...roleData,
    updatedAt: Date.now(),
  });
}

export async function deleteRole(storeId, roleId) {
  await remove(ref(db, storePath(storeId, `roles/${roleId}`)));
}

export async function verifyRolePassword(storeId, roleId, password) {
  const snapshot = await get(ref(db, storePath(storeId, `roles/${roleId}`)));
  const role = snapshot.val();
  if (!role) return false;
  return role.password === password;
}

// ============================================
// 天気（バックエンド整合: stores/{storeId}/weather）
// ============================================

/** 
 * 店舗の天気情報をリアルタイム購読
 * @param {string} storeId - 店舗ID
 * @param {function} callback - コールバック
 */
export function subscribeToWeather(storeId, callback) {
  return onValue(ref(db, storePath(storeId, 'weather')), (snap) => {
    callback(snap.val());
  });
}

/**
 * 郵便番号 → 気象庁エリアコード変換
 * TODO: 実際のマスターデータまたはAPIで実装
 */
export async function lookupWeatherArea(postalCode) {
  // スタブ: 郵便番号の上位3桁で簡易判定
  const prefix = postalCode?.toString().slice(0, 3);
  const mapping = {
    '100': { code: '130010', name: '東京' },   // 東京
    '150': { code: '130010', name: '東京' },   // 渋谷
    '530': { code: '270000', name: '大阪' },   // 大阪
    '600': { code: '260010', name: '京都' },   // 京都
    '064': { code: '016010', name: '札幌' },   // 札幌
    '812': { code: '400010', name: '福岡' },   // 福岡
    '900': { code: '471010', name: '那覇' },   // 那覇
  };
  return mapping[prefix] || { code: prefix + '0000', name: '不明' };
}

// ============================================
// その他
// ============================================

export async function exportAllStoreData(storeId) {
  const [accountsSnap, txSnap, brandingSnap] = await Promise.all([
    get(ref(db, spath('accounts'))),
    get(ref(db, spath('transactions'))),
    get(ref(db, storePath(storeId, 'branding'))),
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
