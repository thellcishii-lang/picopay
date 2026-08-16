// This service worker runs in the background (even when the PicoPay tab is
// closed) so push notifications can still be received and shown.
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
  const title = payload.notification?.title || "PicoPay";
  const body = payload.notification?.body || "";
  const icon = payload.notification?.icon || "/favicon.svg";
  self.registration.showNotification(title, { body, icon });
});

// 通知タップ時の処理
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlToOpen = new URL("/customer", self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (new URL(client.url).origin === self.location.origin && "focus" in client) {
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

const OFFLINE_HTML = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PicoPay</title>
  <style>
    body { margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background: #FBF7F0; font-family: sans-serif; }
    h1 { color: #0E6E5C; margin-bottom: 8px; }
    p { color: #666; }
  </style>
</head>
<body>
  <h1>PicoPay</h1>
  <p>オフラインです</p>
  <p>通信状態を確認してから、もう一度お試しください</p>
</body>
</html>
`;

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    )
  );
});
