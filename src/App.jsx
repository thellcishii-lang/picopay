import { PICO_PLACEHOLDER, resolveBrandImage } from "./components.jsx";

function modeFromPath() {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/store")
    ? "store"
    : "customer";
}

function depositExpiryNoticeAt(settings, lastVisitAt) {
  if (!settings?.depositExpiryEnabled || !settings?.depositExpiryNoticeEnabled || !lastVisitAt) return null;
  const expiresAt = lastVisitAt + (settings.depositExpiryYears || 1) * 365 * 24 * 60 * 60 * 1000;
  const noticeAt = expiresAt - 30 * 24 * 60 * 60 * 1000;
  return Date.now() >= noticeAt && Date.now() < expiresAt ? expiresAt : null;
}

function statusMessage(key, storeMsgs = {}, sharedMsgs = {}) {
  return storeMsgs[key] || sharedMsgs[key] || "";
}

import React, { useState, useEffect, useCallback, useRef } from "react";
import ModeTopBar from "./TopBar.jsx";
import { C, StoreView, CustomerView, PICO_PLACEHOLDER, resolveBrandImage } from "./components.jsx";
import { buildTerms } from "./terms.js";
import {
  subscribeToAccount,
  subscribeToAccountTransactions,
  listAccountTransactions,
  getAccountOnce,
  updateNotifyPrefs,
  createAccount,
  listCustomers,
  subscribeToPushIndex,
  getCustomerEntry,
  getStoreSettings,
  getStatusMessages,
  getBranding,
  saveBranding,
  saveStoreSettings,
  setCustomerStatus,
  deleteCustomerPermanently,
  reissueCustomerAccess,
  requestPushToken,
  sendPushNotification,
  getStats,
  ensureStatsStarted,
  chargeAccount,
  payFromAccount,
  cancelTransaction,
  exportAllStoreData,
  spinGacha,
  fetchVerificationInfo,
  listTransactions,
  subscribeToWeather,
  lookupWeatherArea,
  setCurrentStore,
  resolveStoreForAdmin,
  resolveStoreForCustomer,
  subscribeToRoles,
  saveRole,
  deleteRole,
  verifyRolePassword,
  DEFAULT_ACCOUNT,
  auth,
  subscribeToAuth,
  storeSignIn,
  storeSignOut,
  setupRecaptcha,
  sendPhoneCode,
} from "./firebase.js";

// Which role this page is depends on the URL, not a button:
//   /store    → store admin screen (share this URL with staff devices)
//   /customer → customer screen (share this URL, or the setup link, with customers)
//   anything else defaults to /store, so the bare site URL still works.
function modeFromPath() {
  const path = window.location.pathname;
  if (path.startsWith("/customer")) return "customer";
  if (path.startsWith("/store")) return "store";
  // トップが開かれた時。iOSはblob:のmanifestを読めず開く先が効かないため、
  // ホーム画面のアイコンからだとここに来る。端末にお客様IDが残っていれば
  // お客様として扱う。
  return localStorage.getItem("picopay-customer-id") ? "customer" : "store";
}

// ---------------- STORE LOGIN ----------------
const DAY_MS = 24 * 60 * 60 * 1000;

// 表示する文言は、店舗ごとの設定 → 全店舗共通 → 組み込みの既定 の順に
// 探す。AI Console から set-status-messages.js で書き換えられる。
const DEFAULT_STATUS_MESSAGES = {
  warningStore: "重要なお知らせがあります。登録メールをご確認下さい。",
  suspendedStore: "現在、決済・チャージがご利用いただけません。登録メールをご確認下さい。",
  suspendedCustomer:
    "現在ご利用出来ない状況となっております。ご利用の店舗にお問い合わせください。",
  terminatedStore: "このアカウントはご利用いただけません。",
  terminatedCustomer:
    "現在ご利用出来ない状況となっております。ご利用の店舗にお問い合わせください。",
};

function statusMessage(key, storeMessages = {}, sharedMessages = {}) {
  return storeMessages[key] || sharedMessages[key] || DEFAULT_STATUS_MESSAGES[key];
}

// 失効予告の期日。店舗が「執行通知」をオフにしたら即座に消えるよう、
// 判定そのものが店舗設定を見ている。ご来店(チャージ・お会計)で
// lastVisitAt が進めば、次の描画で自動的に消える。
function depositExpiryNoticeAt(settings = {}, lastVisitAt, now = Date.now()) {
  if (!settings.depositExpiryEnabled || !settings.depositExpiryNoticeEnabled) return null;
  if (!lastVisitAt) return null;
  const expiresAt = lastVisitAt + (settings.depositExpiryYears || 1) * 365 * DAY_MS;
  if (expiresAt <= now) return null; // 既に失効(次の決済時にサーバーが0にする)
  return expiresAt - now <= 30 * DAY_MS ? expiresAt : null;
}

function StoreLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await storeSignIn(email, password);
    } catch (e) {
      setError("ログインできませんでした(メールアドレスかパスワードが違います)");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-10">
      <div className="rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
        <div className="text-sm font-bold" style={{ color: C.ink }}>
          店舗ログイン
        </div>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="メールアドレス"
          className="mt-3 w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.cream, color: C.ink }}
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="パスワード(6文字以上)"
          className="mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.cream, color: C.ink }}
        />
        {error && (
          <div className="mt-2 text-[11px] font-semibold" style={{ color: C.coral }}>
            {error}
          </div>
        )}
        <button
          onClick={submit}
          disabled={busy || !email || password.length < 6}
          className="mt-3 w-full rounded-full py-2.5 text-sm font-bold"
          style={{
            background: email && password.length >= 6 ? C.teal : C.line,
            color: email && password.length >= 6 ? "#fff" : C.mute,
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "処理中…" : "ログイン"}
        </button>
        {/* 店舗が自分でアカウントを作る導線は削除した(2026-08-07)。店舗
            アカウントは申込みと決済を経て AI Console が create-store.js を
            呼んで作るもので、ここから自由に作れると仕組みと矛盾する。 */}
      </div>
    </div>
  );
}

// ---------------- CUSTOMER PHONE VERIFICATION ----------------
// 利用規約の本文。同意画面からも、お客様画面の下のボタンからも、同じものを
// 出す。onBack があれば「戻る」を出す(お客様画面から開いた時)。
function TermsScreen({ storeSettings, onBack }) {
  const sections = buildTerms(storeSettings);
  return (
    <div className="min-h-screen" style={{ background: C.cream }}>
      <div className="max-w-md mx-auto px-4 py-5">
        <div className="text-base font-bold" style={{ color: C.ink }}>利用規約</div>
        <div className="mt-3 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
          {sections.map((sec, i) => (
            <div key={i} className={i === 0 ? "" : "mt-4"}>
              {sec.title && (
                <div className="text-[12px] font-bold" style={{ color: C.ink }}>{sec.title}</div>
              )}
              <div className="text-[11px] mt-1 whitespace-pre-wrap leading-relaxed" style={{ color: C.mute }}>
                {sec.body}
              </div>
            </div>
          ))}
        </div>
        {onBack && (
          <button
            onClick={onBack}
            className="mt-4 w-full rounded-full py-3 text-sm font-bold"
            style={{ background: C.paper, border: `1px solid ${C.line}`, color: C.ink }}
          >
            戻る
          </button>
        )}
      </div>
    </div>
  );
}

// お客様画面に入る一番手前の関門(2026-08-07)。
//
// 以前は SMS 認証の画面にだけ同意チェックを置いていたため、SMS 認証を
// 使わない設定の店舗ではそもそも同意を取れていなかった。QRを読み込んだ
// 直後のここに置けば、SMS 認証の有無にかかわらず必ず通る。
// 同意した事実は保存しない(運営は関与しないため) — 端末側にだけ残す。
function TermsGate({ storeSettings, onAgree }) {
  const [agreed, setAgreed] = useState(false);
  const [reading, setReading] = useState(false);

  if (reading) return <TermsScreen storeSettings={storeSettings} onBack={() => setReading(false)} />;

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: C.cream }}>
      <div className="max-w-md w-full px-4">
        <div className="rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
          <div className="text-sm font-bold" style={{ color: C.ink }}>ご利用の前に</div>
          <div className="text-[12px] mt-2" style={{ color: C.mute }}>
            {storeSettings.storeName || "当店"}の利用規約をお読みのうえ、ご同意ください。
          </div>
          <button
            onClick={() => setReading(true)}
            className="mt-3 w-full rounded-xl py-2.5 text-[12px] font-semibold"
            style={{ background: C.cream, color: C.teal }}
          >
            利用規約を読む
          </button>
          <label className="mt-3 flex items-center gap-2 text-[12px]" style={{ color: C.ink }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>利用規約に同意します</span>
          </label>
          <button
            onClick={onAgree}
            disabled={!agreed}
            className="mt-3 w-full rounded-full py-2.5 text-sm font-bold"
            style={{ background: agreed ? C.teal : C.line, color: agreed ? "#fff" : C.mute }}
          >
            はじめる
          </button>
        </div>
      </div>
    </div>
  );
}

function PhoneVerifyGate({ expectedPhone, onVerified }) {
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const recaptchaContainerId = "picopay-recaptcha";
  const verifierRef = useRef(null);

  const send = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!verifierRef.current) verifierRef.current = setupRecaptcha(recaptchaContainerId);
      const result = await sendPhoneCode(expectedPhone, verifierRef.current);
      setConfirmation(result);
    } catch (e) {
      // A failed attempt often leaves the reCAPTCHA verifier in a bad
      // state — drop it so the next click creates a fresh one.
      if (verifierRef.current) {
        try { verifierRef.current.clear(); } catch (_) {}
        verifierRef.current = null;
      }
      setError(`SMSを送信できませんでした: ${e?.code || ""} ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await confirmation.confirm(code);
      if (result.user.phoneNumber !== expectedPhone) {
        setError("登録されている電話番号と一致しません");
        return;
      }
      onVerified();
    } catch (e) {
      setError("コードが正しくありません");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-8">
      <div className="rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
        <div className="text-sm font-bold" style={{ color: C.ink }}>本人確認(SMS認証)</div>
        <div className="text-[12px] mt-1" style={{ color: C.mute }}>
          登録された電話番号({expectedPhone})宛にSMSで確認コードを送ります
        </div>
        {!confirmation ? (
          <button
            onClick={send}
            disabled={busy}
            className="mt-3 w-full rounded-full py-2.5 text-sm font-bold"
            style={{ background: C.teal, color: "#fff", opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "送信中…" : "SMSを送信する"}
          </button>
        ) : (
          <>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="SMSで届いたコード"
              className="mt-3 w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: C.cream, color: C.ink }}
            />
            <button
              onClick={verify}
              disabled={busy || !code}
              className="mt-2 w-full rounded-full py-2.5 text-sm font-bold"
              style={{ background: code ? C.teal : C.line, color: code ? "#fff" : C.mute, opacity: busy ? 0.6 : 1 }}
            >
              {busy ? "確認中…" : "確認する"}
            </button>
          </>
        )}
        {error && (
          <div className="mt-2 text-[11px] font-semibold" style={{ color: C.coral }}>
            {error}
          </div>
        )}
      </div>
      <div id={recaptchaContainerId} />
    </div>
  );
}

// Turns a horizontal logo image into a square icon (for the home-screen
// icon), by centering it on a padded square canvas. Returns a Promise of a
// data URL.
function padLogoToSquareIcon(logoDataUrl, size = 512, background = "#FBF7F0") {
  return new Promise((resolve) => {
    const img = new Image();
    // 画像が Storage の URL になった(2026-08-06)。別ドメインの画像をそのまま
    // canvas に描くと toDataURL() が使えなくなる(汚染された canvas)ので、
    // CORS 付きで取りに行く。Storage 側に CORS 設定が無い場合は読み込み
    // 自体が失敗するため、その時はロゴの加工を諦めて既定アイコンに戻す。
    img.crossOrigin = "anonymous";
    img.onerror = () => resolve(null);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, size, size);
      const pad = size * 0.15;
      const maxW = size - pad * 2;
      const maxH = size - pad * 2;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      try {
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        resolve(null); // canvas が汚染されている場合
      }
    };
    img.src = logoDataUrl;
  });
}

export default function App() {
  const [mode] = useState(modeFromPath);

  // ---- Auth state (shared: applies to whichever mode this page is) ----
  const [authUser, setAuthUser] = useState(undefined); // undefined = not checked yet, null = signed out
  // Which store this session is looking at. Nothing can read or write until
  // it's known, so the screens wait on it.
  //   undefined = not resolved yet, null = resolved but no store found
  const [storeId, setStoreId] = useState(undefined);
  useEffect(() => {
    const unsubscribe = subscribeToAuth(setAuthUser);
    return () => unsubscribe();
  }, []);

  // Shared branding/settings the store configures once — logo/icon, store
  // name, and the customer-side hero image. Fetched on both sides (store
  // needs it to edit, customer needs it to render their own header).
  const [storeSettings, setStoreSettingsState] = useState({});
  // The three brand images live apart from storeSettings — that node is
  // read in full on every charge/sale (transact.js needs the bonus rates),
  // and a few hundred KB of embedded images doesn't belong in something
  // read that often.
  const [branding, setBrandingState] = useState({});
  // Each settings panel reads its starting value from storeSettings when it
  // first renders. If the screen appears before the settings have arrived,
  // every panel starts on its default and shows those instead — which is why
  // a reload looked like the settings had reset. The screen now waits.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [statusMessages, setStatusMessages] = useState({ store: {}, shared: {} });
  useEffect(() => {
    if (!storeId) return;
    setSettingsLoaded(false);
    Promise.all([getStoreSettings(), getBranding(), getStatusMessages()]).then(
      ([settings, brandingData, msgs]) => {
        setStatusMessages(msgs);
        setStoreSettingsState(settings);
        setBrandingState(brandingData);
        setSettingsLoaded(true);
      }
    );
  }, [mode, storeId]);

  // rankingEnabled/weatherEnabled used to be local, per-device state, which
  // meant toggling them in store settings never actually reached the
  // customer's screen (each device had its own default). They now live in
  // the shared storeSettings, same as everything else configurable.
  const rankingEnabled = storeSettings.rankingEnabled ?? true;
  const weatherEnabled = storeSettings.weatherEnabled ?? true;

  // Whenever branding changes, update the home-screen ("Add to Home
  // Screen") icon: the square icon if the store uploaded one, or the
  // horizontal logo padded into a square, or fall back to PicoPay's own
  // icon if nothing is configured.
  useEffect(() => {
    let cancelled = false;
    const apply = async () => {
      let iconUrl = null;
      const icon = resolveBrandImage(branding.iconImage, PICO_PLACEHOLDER.icon);
      const logo = resolveBrandImage(branding.logoImage, PICO_PLACEHOLDER.logo);
      if (storeSettings.brandMode === "iconName" && icon) {
        iconUrl = icon;
      } else if (storeSettings.brandMode === "logo" && logo) {
        iconUrl = await padLogoToSquareIcon(logo);
      }
      if (cancelled) return;
      const favicon = iconUrl || "/favicon.svg";
      document.getElementById("app-favicon")?.setAttribute("href", favicon);
      document.getElementById("app-touch-icon")?.setAttribute("href", favicon);

      // start_url は「今どちらの画面を開いているか」に合わせる。固定で
      // /store にしていると、お客様がホーム画面に追加したアイコンから
      // 店舗用ログイン画面が開いてしまう不具合が実機で確認されたため
      // (2026-08-06)。myCustomerIdはこのuseEffectより後で定義されるため
      // (参照エラーになる)ここでは使わず、パスの種別だけで切り替える。
      //
      // URLは必ず絶対で書く(2026-08-07)。この manifest はブラウザ内で
      // 組み立てて blob: に置いて渡しているが、blob: から見ると「/」で
      // 始まる書き方が何を指すのか解決できず、start_url も icons の src も
      // 「URL is invalid」として丸ごと捨てられる。src が捨てられると
      // ホーム画面のアイコンが設定されず既定のものに戻ってしまう。
      const origin = window.location.origin;
      // お客様側は、開く先にお客様IDまで含める(2026-08-07)。iPhone では
      // ホーム画面に追加したアプリと Safari とで保存領域が別なので、Safari
      // で開いた時に端末へ覚えさせたお客様IDが引き継がれない。IDを付けて
      // おかないと「どのお客様か分からない状態」で開いてしまう。
      //
      // myCustomerId の state はこの useEffect より後で定義されるため、
      // ここでは同じ手順(URLの id → 端末に覚えたID)で直接取り出す。
      let startUrl;
      if (window.location.pathname.startsWith("/store")) {
        startUrl = origin + "/store";
      } else {
        const fromLink = new URLSearchParams(window.location.search).get("id");
        const savedId = fromLink || localStorage.getItem("picopay-customer-id");
        startUrl = origin + "/customer" + (savedId ? `?id=${savedId}` : "");
      }
      // 店舗のロゴは Storage の URL、ロゴを加工したものは data: URL で、
      // どちらも既に絶対。既定の favicon だけ origin を付ける。
      const iconSrc = iconUrl || `${origin}/favicon.svg`;

      const manifest = {
        name: storeSettings.storeName || "PicoPay",
        short_name: storeSettings.storeName || "PicoPay",
        start_url: startUrl,
        display: "standalone",
        background_color: "#FBF7F0",
        theme_color: "#0E6E5C",
        icons: [{ src: iconSrc, sizes: "any", type: iconUrl ? "image/png" : "image/svg+xml" }],
      };
      const blob = new Blob([JSON.stringify(manifest)], { type: "application/json" });
      document.getElementById("app-manifest")?.setAttribute("href", URL.createObjectURL(blob));
    };
    apply();
    return () => {
      cancelled = true;
    };
  }, [storeSettings.brandMode, branding.iconImage, branding.logoImage, storeSettings.storeName]);

  // ---- Store-side: the full customer list ----
  const [customers, setCustomers] = useState([]);
  const refreshCustomers = useCallback(async () => {
    const list = await listCustomers();
    setCustomers(list);
  }, []);

  // 1人だけ差し替える版。会計・取消・状態変更のように「誰が変わったか」が
  // 分かっている操作では、全顧客を読み直さずこちらを使う(2026-08-06)。
  const refreshOneCustomer = useCallback(async (customerId) => {
    if (!customerId) return;
    const entry = await getCustomerEntry(customerId);
    setCustomers((prev) => {
      if (!entry) return prev.filter((c) => c.id !== customerId);
      const idx = prev.findIndex((c) => c.id === customerId);
      if (idx === -1) return [...prev, entry];
      const next = [...prev];
      next[idx] = entry;
      return next;
    });
  }, []);
  useEffect(() => {
    if (mode === "store" && authUser && storeId) refreshCustomers();
  }, [mode, authUser, storeId, refreshCustomers]);


  // Running totals for the dashboard. The start date is stamped on the first
  // store sign-in, so everything shown is "since the store began using this".
  const [stats, setStats] = useState({});
  const [weather, setWeather] = useState({});
  // What the person at the till is currently allowed to do. Starts at other1
  // (no password) every time the app opens, and drops back after 30 minutes
  // so a till left unattended doesn't stay unlocked.
  // 配信の宛先。顧客一覧とは別に見張る(2026-08-07)。一覧はログイン時に
  // 一度読むだけなので、お客様が後から通知を許可しても反映されなかった。
  const [pushIndex, setPushIndex] = useState({});
  useEffect(() => {
    if (mode !== "store" || !storeId) return;
    return subscribeToPushIndex(setPushIndex);
  }, [mode, storeId]);

  const [roles, setRoles] = useState({});
  const [activeRole, setActiveRole] = useState("other1");
  useEffect(() => {
    if (!storeId) return;
    return subscribeToRoles(setRoles);
  }, [storeId]);
  useEffect(() => {
    if (activeRole === "other1") return;
    const timer = setTimeout(() => setActiveRole("other1"), 30 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [activeRole]);

  // 店舗ログアウト時は権限も最低権限に戻す(2026-08-07)。以前は認証を
  // 切るだけで activeRole が画面に残っていたため、ログインし直すと
  // 権限を持ったままの状態に戻ってしまっていた。
  const handleStoreSignOut = useCallback(async () => {
    setActiveRole("other1");
    await storeSignOut();
  }, []);

  const permissions =
    activeRole === "owner"
      ? { blacklist: true, deleteCustomer: true, settingsBasic: true, settingsFull: true, aggregate: true, owner: true }
      : roles[activeRole] || {};
  useEffect(() => {
    if (!storeId) return;
    return subscribeToWeather(setWeather);
  }, [storeId]);
  const refreshStats = useCallback(async () => {
    setStats(await getStats());
  }, []);
  useEffect(() => {
    if (mode !== "store" || !authUser || !storeId) return;
    // 基準日(3/31・9/30)の残高を記録する処理は廃止した(2026-08-07)。
    // 必要になった時に店舗が期間を指定してデータを出せるので、事前に
    // 記録しておく必要がない。期ごとの数字はstats/termsに貯まっている。
    ensureStatsStarted().then(refreshStats);
  }, [mode, authUser, storeId, refreshStats]);

  const handleSaveStoreSettings = async (updates) => {
    await saveStoreSettings(updates);
    setStoreSettingsState((prev) => ({ ...prev, ...updates }));
  };

  const handleSetRankingEnabled = (value) => handleSaveStoreSettings({ rankingEnabled: value });
  const handleSetWeatherEnabled = (value) => handleSaveStoreSettings({ weatherEnabled: value });

  const handleRegisterCustomer = async ({ name, phone, email, referredBy }) => {
    // SMS認証は必須(2026-08-07)。店舗が選べる形はやめた。
    const customerId = await createAccount({ name, phone, email, referredBy });
    await refreshOneCustomer(customerId);
    return customerId;
  };

  const handleSetCustomerStatus = async (customerId, status) => {
    await setCustomerStatus(customerId, status);
    await refreshOneCustomer(customerId);
  };

  const handleDeleteCustomer = async (customerId) => {
    await deleteCustomerPermanently(customerId);
    // getCustomerEntry が null を返すので、一覧からも取り除かれる
    await refreshOneCustomer(customerId);
  };

  const handleReissueCustomer = async ({ customerId, newPhone, idPhotoDataUrl }) => {
    await reissueCustomerAccess({ customerId, newPhone, idPhotoDataUrl });
    await refreshOneCustomer(customerId);
  };

  const handleUpdateNotifyPrefs = async (customerId, prefs) => {
    let pushToken = null;
    if (prefs.push) {
      const result = await requestPushToken();
      pushToken = result.token;
      if (!pushToken) {
        // iOS PWA でない場合など、トークン取得失敗の理由をコンソールに出力
        console.warn("[Push] トークン取得失敗:", result.error);
      }
    }
    await updateNotifyPrefs(customerId, prefs, pushToken);
  };

  const handleSendPush = async (tokens, body) => {
    if (!tokens || tokens.length === 0) return;
    const title = storeSettings.storeName || "PicoPay";
    await sendPushNotification({ tokens, title, body });
  };

  // Money never moves in the browser any more — these just tell the server
  // what happened and let it work out the amounts from the store's settings.
  const handleCharge = async (amount, customerId) => {
    if (!customerId) return;
    await chargeAccount(customerId, amount);
    refreshOneCustomer(customerId);
    refreshStats();
  };

  const handleDeduct = async (amount, customerId) => {
    if (!customerId) return;
    await payFromAccount(customerId, amount);
    refreshOneCustomer(customerId);
    refreshStats();
  };

  const handleCancelTransaction = async (customerId, transactionId) => {
    const result = await cancelTransaction(customerId, transactionId);
    refreshOneCustomer(customerId);
    refreshStats();
    return result;
  };

  // 概況に出すのは預かり金(現金)だけ。法的に問題になるのはこちらで、
  // ポイントは関係ないため合算しない(2026-08-07)。
  const totalBalance = customers.reduce((s, c) => s + (c.depositBalance || 0), 0);

  // ---- Customer-side: this device's own account ----
  const [myCustomerId, setMyCustomerId] = useState(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const fromLink = params.get("id");
    if (fromLink) {
      localStorage.setItem("picopay-customer-id", fromLink);
      return fromLink;
    }
    return localStorage.getItem("picopay-customer-id");
  });
  // Staff → their store. Customer → the store their id belongs to.
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      if (mode === "store") {
        if (!authUser) {
          setStoreId(authUser === null ? null : undefined);
          return;
        }
        const id = await resolveStoreForAdmin(authUser.uid);
        if (cancelled) return;
        setCurrentStore(id);
        setStoreId(id);
      } else {
        if (!myCustomerId) {
          setStoreId(null);
          return;
        }
        const id = await resolveStoreForCustomer(myCustomerId);
        if (cancelled) return;
        setCurrentStore(id);
        setStoreId(id);
      }
    };
    resolve();
    return () => {
      cancelled = true;
    };
  }, [mode, authUser, myCustomerId]);

  const [setupInput, setSetupInput] = useState("");
  const [account, setAccount] = useState(DEFAULT_ACCOUNT);
  const [accountLoaded, setAccountLoaded] = useState(false);
  // The customer's own history, subscribed separately from the account and
  // capped at the most recent 50 — the account itself no longer carries it.
  const [myTransactions, setMyTransactions] = useState([]);
  useEffect(() => {
    if (!myCustomerId || !storeId) return;
    return subscribeToAccountTransactions(myCustomerId, setMyTransactions, 50);
  }, [myCustomerId, storeId]);
  // The phone number on file for this account, and whether verification is
  // required at all — fetched via a public, read-only lookup so we can
  // decide whether the gate is needed *before* the customer is
  // authenticated (see fetchVerificationInfo in firebase.js).
  const [myPhone, setMyPhone] = useState(undefined); // undefined = not checked yet, null = no phone on file
  // Has this device's phone been verified against this account's phone yet?
  const [phoneVerified, setPhoneVerified] = useState(false);

  useEffect(() => {
    if (mode !== "customer" || !myCustomerId || !storeId) return;
    let cancelled = false;
    fetchVerificationInfo(myCustomerId).then(({ phone }) => {
      if (!cancelled) setMyPhone(phone);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, myCustomerId, storeId]);

  // この端末で既にそのお客様の電話番号として認証済みなら、認証画面は飛ばす。
  // SMS認証は必須なので「要否」の分岐は無い(2026-08-07)。
  useEffect(() => {
    if (myPhone === undefined) return; // still checking
    if (!myPhone || authUser?.phoneNumber === myPhone) {
      setPhoneVerified(true);
    }
  }, [myPhone, authUser]);

  useEffect(() => {
    if (mode !== "customer" || !myCustomerId || !phoneVerified || !storeId) return;
    setAccountLoaded(false);
    const unsubscribe = subscribeToAccount(myCustomerId, (data) => {
      setAccount(data);
      setAccountLoaded(true);
    });
    return () => unsubscribe();
  }, [mode, myCustomerId, phoneVerified, storeId]);

  // Returns the rate the server drew, so the wheel can land on it.
  const handleUseBonusSpin = async () => {
    if (!myCustomerId) return 0;
    return await spinGacha(myCustomerId);
  };

  const confirmSetup = () => {
    // Accept a plain ID, a scanned "PICOPAY-SETUP:<id>" value, or a full setup URL.
    const raw = setupInput.trim();
    let id = raw;
    if (raw.startsWith("PICOPAY-SETUP:")) id = raw.split(":")[1];
    else if (raw.includes("?id=")) id = raw.split("?id=")[1];
    if (!id) return;
    localStorage.setItem("picopay-customer-id", id);
    setMyCustomerId(id);
  };

  // AI Console が書いた状態をそのまま読む。日数の計算は一切しない。
  const serviceStatus = storeSettings.serviceStatus || "active";
  const msg = (key) => statusMessage(key, statusMessages.store, statusMessages.shared);
  const expiryNoticeAt = depositExpiryNoticeAt(storeSettings, account?.lastVisitAt);

  // 規約への同意。端末側にだけ残す(同意した事実はサーバーに保存しない)。
  const [termsAgreed, setTermsAgreed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("picopay-terms-agreed") === "1";
  });
  const [showTerms, setShowTerms] = useState(false);

  const needsPhoneGate = mode === "customer" && myPhone !== undefined && myPhone && !phoneVerified;

  return (
    <div className="min-h-screen" style={{ background: C.cream, fontFamily: "'Hiragino Sans', system-ui, sans-serif" }}>
      {/* 店舗の設定が揃うまでヘッダーの中身を出さない(2026-08-07)。
          ログイン前(店舗未特定)は既定の表示でよいので loaded 扱いにする。 */}
      <ModeTopBar
        mode={mode}
        storeSettings={storeSettings}
        branding={branding}
        loaded={!storeId || settingsLoaded}
      />
      {mode === "store" ? (
        authUser === undefined ? (
          <div className="min-h-screen flex items-center justify-center" style={{ background: C.cream }}>
            <div className="text-sm" style={{ color: C.mute }}>読み込み中…</div>
          </div>
        ) : !authUser ? (
          <StoreLogin />
        ) : storeId === undefined ? (
          <div className="min-h-screen flex items-center justify-center" style={{ background: C.cream }}>
            <div className="text-sm" style={{ color: C.mute }}>読み込み中…</div>
          </div>
        ) : !storeId ? (
          // Signed in, but this account isn't attached to any store — normally
          // only possible if the store was removed, or sign-up happened
          // outside the申込フロー.
          <div className="max-w-md mx-auto px-4 pt-10">
            <div className="rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
              <div className="text-sm font-bold" style={{ color: C.ink }}>店舗が見つかりません</div>
              <div className="text-[12px] mt-1" style={{ color: C.mute }}>
                このアカウントには店舗が紐づいていません。お申し込み時のメールをご確認いただくか、サポートまでご連絡ください。
              </div>
              <button
                onClick={handleStoreSignOut}
                className="mt-3 w-full rounded-full py-2.5 text-sm font-bold"
                style={{ background: C.cream, color: C.mute }}
              >
                ログアウト
              </button>
            </div>
          </div>
        ) : !settingsLoaded ? (
          <div className="min-h-screen flex items-center justify-center" style={{ background: C.cream }}>
            <div className="text-sm" style={{ color: C.mute }}>読み込み中…</div>
          </div>
        ) : serviceStatus === "terminated" ? (
          // 60日ロック後はスタッフのログインも不可。ここに来る時点で認証は
          // 通っているが、それ以上先の画面は見せない。
          <div className="max-w-md mx-auto px-4 pt-10">
            <div className="rounded-2xl p-4 text-center" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
              <div className="text-sm font-bold" style={{ color: C.ink }}>
                {msg("terminatedStore")}
              </div>
              <button
                onClick={handleStoreSignOut}
                className="mt-3 w-full rounded-full py-2.5 text-sm font-bold"
                style={{ background: C.cream, color: C.mute }}
              >
                ログアウト
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* 決済失敗の警告(warning)と停止(suspended)。文言はAI Console
                から差し替えられる。日付は出さない — 具体的な期日は
                AI Consoleが送るメールの中にある。 */}
            {(serviceStatus === "warning" || serviceStatus === "suspended") && (
              <div className="max-w-md mx-auto px-4 pt-4">
                <div
                  className="rounded-xl p-3 text-[12px] font-bold flex items-start gap-2"
                  style={{ background: "#FFF6E5", color: "#B3261E", border: "1px solid #F0DBA0" }}
                >
                  <span aria-hidden="true">⚠️</span>
                  <span>{msg(serviceStatus === "warning" ? "warningStore" : "suspendedStore")}</span>
                </div>
              </div>
            )}
            <StoreView
              totalBalance={totalBalance}
              onCharge={handleCharge}
              onDeduct={handleDeduct}
              rankingEnabled={rankingEnabled}
              setRankingEnabled={handleSetRankingEnabled}
              weatherEnabled={weatherEnabled}
              setWeatherEnabled={handleSetWeatherEnabled}
              customers={customers}
              onRegisterCustomer={handleRegisterCustomer}
              onFetchCustomerDetail={async (id) => {
                const [acc, history] = await Promise.all([
                  getAccountOnce(id),
                  listAccountTransactions(id, 50),
                ]);
                return { ...acc, history };
              }}
              onSetCustomerStatus={handleSetCustomerStatus}
              onDeleteCustomer={handleDeleteCustomer}
              onReissueCustomer={handleReissueCustomer}
              storeSettings={storeSettings}
              onSaveStoreSettings={handleSaveStoreSettings}
              onSendPush={handleSendPush}
              pushIndex={pushIndex}
              onSignOut={handleStoreSignOut}
              stats={stats}
              onLoadTransactions={listTransactions}
              weather={weather}
              onLookupArea={lookupWeatherArea}
              roles={roles}
              activeRole={activeRole}
              permissions={permissions}
              onVerifyRole={async (role, password) => {
                const result = await verifyRolePassword(role, password);
                setActiveRole(result.role);
                return result;
              }}
              onExitRole={() => setActiveRole("other1")}
              onSaveRole={saveRole}
              onDeleteRole={deleteRole}
              onCancelTransaction={handleCancelTransaction}
              onExportAllData={exportAllStoreData}
              branding={branding}
              onSaveBranding={async (fields) => {
                // サーバーが返すのは保存後のURL。画面側もそれで置き換える
                // (選んだ時点の data URI のまま持ち続けると、次の読み込みで
                // URL に変わった時に一瞬ちらつく)。
                const saved = await saveBranding(fields);
                setBrandingState((prev) => ({ ...prev, ...saved }));
              }}
            />
          </>
        )
      ) : !myCustomerId ? (
        <div className="max-w-md mx-auto px-4 pt-8">
          <div className="rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
            <div className="text-sm font-bold" style={{ color: C.ink }}>PicoPayへようこそ</div>
            <div className="text-[12px] mt-1" style={{ color: C.mute }}>
              お店で発行されたお客様IDを入力してください(最初の1回だけです)
            </div>
            <input
              value={setupInput}
              onChange={(e) => setSetupInput(e.target.value)}
              placeholder="例: cust-xxxxxxxx"
              className="mt-3 w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: C.cream, color: C.ink }}
            />
            <button
              onClick={confirmSetup}
              disabled={!setupInput.trim()}
              className="mt-3 w-full rounded-full py-2.5 text-sm font-bold"
              style={{ background: setupInput.trim() ? C.teal : C.line, color: setupInput.trim() ? "#fff" : C.mute }}
            >
              設定する
            </button>
          </div>
        </div>
      ) : myPhone === undefined ? (
        <div className="min-h-screen flex items-center justify-center" style={{ background: C.cream }}>
          <div className="text-sm" style={{ color: C.mute }}>読み込み中…</div>
        </div>
      ) : !termsAgreed ? (
        <TermsGate
          storeSettings={storeSettings}
          onAgree={() => {
            localStorage.setItem("picopay-terms-agreed", "1");
            setTermsAgreed(true);
          }}
        />
      ) : showTerms ? (
        <TermsScreen storeSettings={storeSettings} onBack={() => setShowTerms(false)} />
      ) : needsPhoneGate ? (
        <PhoneVerifyGate
          expectedPhone={myPhone}
          onVerified={() => setPhoneVerified(true)}
        />
      ) : !accountLoaded ? (
        <div className="min-h-screen flex items-center justify-center" style={{ background: C.cream }}>
          <div className="text-sm" style={{ color: C.mute }}>読み込み中…</div>
        </div>
      ) : account.status && account.status !== "active" ? (
        <div className="max-w-md mx-auto px-4 pt-8">
          <div className="rounded-2xl p-4 text-center" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
            <div className="text-sm font-bold" style={{ color: C.ink }}>
              現在このアカウントはご利用いただけません
            </div>
            <div className="text-[12px] mt-2" style={{ color: C.mute }}>
              詳しくは導入店舗までお問い合わせください
            </div>
          </div>
        </div>
      ) : serviceStatus === "suspended" || serviceStatus === "terminated" ? (
        // 店舗自体が停止中。AI Console が書いた状態を読んでいるだけで、
        // 何日経ったかの計算はこちらでは持たない。個々のお客様の
        // アカウント状態(ブラックリスト等)とは別の、店舗単位の停止。
        <div className="max-w-md mx-auto px-4 pt-8">
          <div className="rounded-2xl p-4 text-center" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
            <div className="text-sm font-bold" style={{ color: C.ink }}>
              {msg(serviceStatus === "terminated" ? "terminatedCustomer" : "suspendedCustomer")}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* 預かり金の失効予告(2026-08-06決定)。判定そのものが店舗設定を
              見ているので、店舗が「執行通知」をオフにした瞬間に全顧客一律で
              消える。ご来店(チャージ・お会計)でlastVisitAtが進めば、
              次の描画で自動的に消える。 */}
          {expiryNoticeAt && (
            <div className="max-w-md mx-auto px-4 pt-4">
              <div className="rounded-xl p-3 text-[12px]" style={{ background: "#FFF6E5", color: "#8A6100", border: "1px solid #F0DBA0" }}>
                預かり残高は{new Date(expiryNoticeAt).toLocaleDateString("ja-JP")}
                に失効します。ご来店・ご利用で継続されます。
              </div>
            </div>
          )}
          <CustomerView
            pointBalance={account.pointBalance || 0}
            depositBalance={account.depositBalance || 0}
            cumulativeSpend={account.cumulativeSpend || 0}
            customerName={account.profile?.name || null}
            bonusEligible={account.bonusEligible || false}
            onUseBonusSpin={handleUseBonusSpin}
            history={myTransactions}
            rankingEnabled={rankingEnabled}
            customerId={myCustomerId}
            storeSettings={storeSettings}
            branding={branding}
            notifyOptIn={account.notifyOptIn || null}
            onUpdateNotifyPrefs={(prefs) => handleUpdateNotifyPrefs(myCustomerId, prefs)}
            onOpenTerms={() => setShowTerms(true)}
          />
        </>
      )}
    </div>
  );
}
