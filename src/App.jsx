import React, { useEffect, useState } from 'react';
import TopBar from './TopBar';

function App() {
  const [lineUserId, setLineUserId] = useState(null);
  const [isLiffReady, setIsLiffReady] = useState(false);

  useEffect(() => {
    // 取得したLIFF IDを設定
    const liffId = "2010946742-QoyJY2TQ";

    window.liff.init({ liffId: liffId })
      .then(() => {
        setIsLiffReady(true);
        if (window.liff.isLoggedIn()) {
          // ログイン済みならアクセストークンからユーザーID(sub)を取得
          const profile = window.liff.getDecodedAccessToken();
          const userId = profile.sub;
          setLineUserId(userId);
          
          console.log("LINE User ID:", userId);
          // TODO: ここで取得した userId を Firebase などのデータベースと紐付ける処理を記述します
        } else {
          // 未ログインの場合は自動でLINEログインへ誘導
          window.liff.login();
        }
      })
      .catch((err) => {
        console.error("LIFF初期化エラー:", err);
      });
  }, []);

  if (!isLiffReady) {
    return <div className="p-4 text-center">Loading LINE...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar />
      <main className="p-4">
        <h1 className="text-xl font-bold mb-2">Picopay ポイントアプリ</h1>
        <p className="text-sm text-gray-600">LINE User ID: {lineUserId || "取得中..."}</p>
        {/* 既存のアプリ画面コンテンツ */}
      </main>
    </div>
  );
}

export default App;
