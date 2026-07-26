# PicoPay

自家型前払式決済サービス「PicoPay」の実装です。Firebase Realtime Databaseで
店舗⇄お客様の残高・履歴をリアルタイムに共有します。

## ローカルで動かす

```bash
npm install
npm run dev
```

ブラウザで表示されたURL(例: http://localhost:5173)を開くと動きます。

## デプロイ手順(GitHub → Netlify)

1. このフォルダの中身をGitHubの新しいリポジトリにpushする
2. Netlifyで「Import from Git」→ そのリポジトリを選択
3. ビルド設定:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. デプロイが終わると、NetlifyのURL(例: picopay.netlify.app)でPicoPayが動きます

## 使い方

- 開いたら右上の「店舗」「お客様」で表示を切り替えられます
- この切り替えは、開いてる端末(ブラウザ)ごとに記憶されます(localStorage)
- 実際のチャージ・残高・履歴は全端末で共有されます(Firebase Realtime Database)
- 店舗の「決済」タブでチャージ・お会計を行うと、お客様側の画面にリアルタイムで反映されます

## 構成

- `src/firebase.js` — Firebase接続・データの読み書き
- `src/components.jsx` — 画面の部品(設定画面・決済画面・登録画面・店舗/お客様ビュー)
- `src/App.jsx` — 全体を組み立てるメインの部品
- `src/TopBar.jsx` — ヘッダー(店舗/お客様の切り替え)

## 今後やること

- Firebaseのセキュリティルール設定(テストモードは30日で自動ロックされます)
- Pay.jp連携(運営⇄導入店舗間の課金)
- ゾーイ(chatBOT)の組み込み
- QRコードの実際の読み取り機能
