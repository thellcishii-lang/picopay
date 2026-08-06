import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// アプリ外枠のキャッシュ+オフライン表示は、プッシュ通知用のService Worker
// (firebase-messaging-sw.js)に統合されている。同じスコープ(/)に別ファイルを
// 二重登録すると片方が上書きされてプッシュ通知が壊れるため、1ファイルに
// まとめてある。
//
// プッシュ通知はお客様が「受け取る」を選んだ時にだけfirebase.js側で登録
// されるため、それだけに任せるとプッシュ通知を使わない人にはオフライン
// 対応も効かなくなる。同じスクリプト・同じスコープでの登録はブラウザ側で
// 冪等に扱われる(既存の登録を再利用するだけ)ので、ここで毎回登録しても
// 二重登録にはならず安全。
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/firebase-messaging-sw.js").catch(() => {
      // 登録に失敗してもアプリ自体は動くので、握りつぶして続行する。
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
