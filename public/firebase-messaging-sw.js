importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyD8k35AAE9s1MeXj5pB7WVrGKg3Wlkv-xA",
  authDomain: "picopay-5a53e.firebaseapp.com",
  databaseURL: "https://picopay-5a53e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "picopay-5a53e",
  storageBucket: "picopay-5a53e.firebasestorage.app",
  messagingSenderId: "479126770039",
  appId: "1:479126770039:web:dcdf6274a257e42a6e9172",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log("[SW] Background message received:", payload);
  
  const title = payload.notification?.title || payload.data?.title || "PicoPay";
  const body = payload.notification?.body || payload.data?.body || "";
  const icon = payload.notification?.icon || payload.data?.icon || "/favicon.svg";
  
  const notificationOptions = {
    body,
    icon,
    badge: "/favicon.svg",
    tag: payload.data?.tag || "picopay-default",
    data: payload.data || {},
    requireInteraction: false,
  };
  
  self.registration.showNotification(title, notificationOptions);
});

// 通知クリック時の処理：アプリを開く
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.link || "/";
  
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

const OFFLINE_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PicoPay</title>
</head>
<body style="margin:0;background:#FBF7F0;font-family:'Hiragino Sans',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding-top:64px;">
  <div style="height:56px;width:56px;border-radius:9999px;background:#FFE4DA;display:flex;align-items:center;justify-content:center;">
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0E6E5C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="3"></rect>
      <path d="M2 10h20"></path>
    </svg>
  </div>
  <div style="margin-top:24px;max-width:360px;width:calc(100% - 32px);border-radius:16px;background:#FFFFFF;border:1px solid #E4DFD3;padding:16px;text-align:center;">
    <div style="font-size:14px;font-weight:bold;color:#0F2E2B;">オフラインです</div>
    <div style="font-size:12px;margin-top:6px;color:#6B7A76;">通信状態を確認してから、もう一度お試しください</div>
  </div>
</body>
</html>`;

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    )
  );
});
