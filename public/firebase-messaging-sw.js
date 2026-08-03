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

// Shows the notification when a push arrives while the app isn't in the
// foreground (e.g. screen locked, browser closed).
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "PicoPay";
  const body = payload.notification?.body || "";
  const icon = payload.notification?.icon || "/favicon.svg";
  self.registration.showNotification(title, { body, icon });
});
