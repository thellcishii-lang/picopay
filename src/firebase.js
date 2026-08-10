// ---- Push token request（iOS PWA 対応 + 詳細ログ）----
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

  // iOS は PWA としてインストールされていないと通知不可
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

// フォアグラウンド時のメッセージ受信（iOS PWA で必須）
export function onForegroundMessage(handler) {
  const messaging = getMessaging(app);
  return onMessage(messaging, (payload) => {
    console.log("[FCM] Foreground message received:", payload);
    handler(payload);
  });
}

// ---- Push notification preferences（オブジェクト形式で保存）----
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
  
  // pushIndex も同様にオブジェクト形式で
  updates[spath(`pushIndex/${customerId}`)] = prefs.push && hasTokens
    ? { push: true, tokens }
    : null;

  await update(ref(db), updates);
}

// pushTokens を配列として返す互換レイヤー
function normalizePushTokens(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === "object") return Object.keys(val);
  return [];
}

// listCustomers と getCustomerEntry でも normalizePushTokens を使う
// （既存コードと同じ）
