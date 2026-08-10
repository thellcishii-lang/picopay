// ============================================
// PicoPay - src/firebase.js（完全書き換え版）
// ============================================

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,  // ← 電話認証用に追加
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

// ============================================
// 店舗認証（App.jsx から import される）
// ============================================

/** 店舗サインイン（メール/パスワード） */
export async function storeSignIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

/** 電話番号認証：SMS コード送信 */
export async function sendPhoneCode(phoneNumber, appVerifier) {
  return signInWithPhoneNumber(auth, phoneNumber, appVerifier);
}

/** 店舗サインアウト */
export async function storeSignOut() {
  return signOut(auth);
}

/** 認証状態の監視 */
export function subscribeToAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

/** reCAPTCHA 設定（電話認証などで使用） */
export function setupRecaptcha(containerId) {
  return new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
    callback: () => {
      // reCAPTCHA 解決時のコールバック
    },
  });
}

// ============================================
// アカウント管理
// ============================================

/** 新規顧客アカウント作成 */
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

/** 顧客情報を1件取得 */
export async function getCustomerEntry(customerId) {
  const snapshot = await get(ref(db, spath(`accounts/${customerId}`)));
  return snapshot.val();
}

/** 顧客一覧を取得 */
export async function listCustomers() {
  const snapshot = await get(ref(db, spath('accounts')));
  if (!snapshot.exists()) return [];

  const customers = [];
  snapshot.forEach((child) => {
    customers.push({ id: child.key, ...child.val() });
  });
  return customers;
}

// ============================================
// ブランディング
// ============================================

/** 店舗ブランディング情報を保存 */
export async function saveBranding(storeId, brandingData) {
  if (!storeId) throw new Error('storeId is required');
  if (!brandingData) throw new Error('brandingData is required');

  const path = spath(`branding/${storeId}`);
  await set(ref(db, path), {
    ...brandingData,
    updatedAt: Date.now(),
  });
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

/** FCM プッシュトークンを取得（iOS PWA 対応） */
export async function requestPushToken() {
  const supported = await isMessagingSupported().catch(() => false);
  if (!supported) {
    console.warn('[FCM] このブラウザはプッシュ通知に対応していません');
    return { token: null, error: 'unsupported' };
  }
  if (!('serviceWorker' in navigator)) {
    console.warn('[FCM] Service Worker が利用できません');
    return { token: null, error: 'no-sw' };
  }

  if (isIos() && !isPwa()) {
    console.warn(
      '[FCM] iOS Safari はホーム画面に追加後、PWA として開く必要があります'
    );
    return { token: null, error: 'ios-not-pwa' };
  }

  try {
    const existingReg = await navigator.serviceWorker.getRegistration(
      '/firebase-messaging-sw.js'
    );
    const registration =
      existingReg ||
      (await navigator.serviceWorker.register('/firebase-messaging-sw.js'));

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('[FCM] 通知許可が得られませんでした:', permission);
      return { token: null, error: 'denied' };
    }

    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      console.warn('[FCM] トークンの取得に失敗しました');
      return { token: null, error: 'no-token' };
    }

    console.log('[FCM] トークン取得成功:', token.slice(0, 20) + '...');
    return { token, error: null };
  } catch (e) {
    console.error('[FCM] トークン取得中にエラー:', e);
    return { token: null, error: e.message };
  }
}

/** フォアグラウンド時のメッセージ受信 */
export function onForegroundMessage(handler) {
  const messaging = getMessaging(app);
  return onMessage(messaging, (payload) => {
    console.log('[FCM] Foreground message received:', payload);
    handler(payload);
  });
}

/** プッシュ通知設定を更新 */
export async function updateNotifyPrefs(customerId, prefs, pushToken) {
  let tokens = {};
  if (prefs.push && pushToken) {
    tokens[pushToken] = true;
  }

  const hasTokens = Object.keys(tokens).length > 0;

  const updates = {};
  updates[spath(`accounts/${customerId}/notifyOptIn`)] = prefs;
  updates[spath(`accounts/${customerId}/pushTokens`)] = hasTokens
    ? tokens
    : null;

  updates[spath(`pushIndex/${customerId}`)] =
    prefs.push && hasTokens ? { push: true, tokens } : null;

  await update(ref(db), updates);
}

/** pushTokens を配列として返す互換レイヤー */
export function normalizePushTokens(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'object') return Object.keys(val);
  return [];
}
