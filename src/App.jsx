import React, { useState, useEffect, useCallback, useRef } from "react";
import ModeTopBar from "./TopBar.jsx";
import { C, StoreView, CustomerView, PICO_PLACEHOLDER, resolveBrandImage } from "./components.jsx";
import {
  subscribeToAccount,
  subscribeToAccountTransactions,
  listAccountTransactions,
  getAccountOnce,
  updateNotifyPrefs,
  createAccount,
  listCustomers,
  getStoreSettings,
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
  recordMissingSnapshots,
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
  storeSignUp,
  storeSignOut,
  setupRecaptcha,
  sendPhoneCode,
} from "./firebase.js";

// Which role this page is depends on the URL, not a button:
//   /store    → store admin screen (share this URL with staff devices)
//   /customer → customer screen (share this URL, or the setup link, with customers)
//   anything else defaults to /store, so the bare site URL still works.
function modeFromPath() {
  return window.location.pathname.startsWith("/customer") ? "customer" : "store";
}

// ---------------- STORE LOGIN ----------------
function StoreLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (isSignup) await storeSignUp(email, password);
      else await storeSignIn(email, password);
    } catch (e) {
      setError(
        isSignup
          ? "登録できませんでした(既に使われているメールアドレスか、パスワードが短すぎる可能性があります)"
          : "ログインできませんでした(メールアドレスかパスワードが違います)"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-10">
      <div className="rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
        <div className="text-sm font-bold" style={{ color: C.ink }}>
          {isSignup ? "店舗アカウントを作成" : "店舗ログイン"}
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
          {busy ? "処理中…" : isSignup ? "登録する" : "ログイン"}
        </button>
        <button
          onClick={() => { setIsSignup((v) => !v); setError(null); }}
          className="mt-2 w-full text-[11px] font-semibold"
          style={{ color: C.teal }}
        >
          {isSignup ? "すでにアカウントがある方はこちら" : "初めての方はこちら(アカウント作成)"}
        </button>
      </div>
    </div>
  );
}

// ---------------- CUSTOMER PHONE VERIFICATION ----------------
function PhoneVerifyGate({ expectedPhone, onVerified, termsUrl }) {
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // 2026-08-06の決定:同意した事実は保存しない(運営は関与しない、という
  // 整理のため)。このチェックはボタンの活性条件としてのみ使う。
  const [agreed, setAgreed] = useState(false);
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
        <label className="mt-3 flex items-start gap-2 text-[11px]" style={{ color: C.mute }}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {termsUrl ? (
              <a href={termsUrl} target="_blank" rel="noreferrer" style={{ color: C.teal, textDecoration: "underline" }}>
                利用規約
              </a>
            ) : (
              "利用規約"
            )}
            に同意します
          </span>
        </label>
        {!confirmation ? (
          <button
            onClick={send}
            disabled={busy || !agreed}
            className="mt-3 w-full rounded-full py-2.5 text-sm font-bold"
            style={{ background: agreed ? C.teal : C.line, color: agreed ? "#fff" : C.mute, opacity: busy ? 0.6 : 1 }}
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
              disabled={busy || !code || !agreed}
              className="mt-2 w-full rounded-full py-2.5 text-sm font-bold"
              style={{ background: code && agreed ? C.teal : C.line, color: code && agreed ? "#fff" : C.mute, opacity: busy ? 0.6 : 1 }}
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
      resolve(canvas.toDataURL("image/png"));
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
  useEffect(() => {
    if (!storeId) return;
    setSettingsLoaded(false);
    Promise.all([getStoreSettings(), getBranding()]).then(([settings, brandingData]) => {
      setStoreSettingsState(settings);
      setBrandingState(brandingData);
      setSettingsLoaded(true);
    });
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

      const manifest = {
        name: storeSettings.storeName || "PicoPay",
        short_name: storeSettings.storeName || "PicoPay",
        start_url: "/store",
        display: "standalone",
        background_color: "#FBF7F0",
        theme_color: "#0E6E5C",
        icons: [{ src: favicon, sizes: "any", type: iconUrl ? "image/png" : "image/svg+xml" }],
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
    ensureStatsStarted()
      // If the scheduled reference-date job ever missed a run, fill the gap
      // here rather than leaving a hole in the record.
      .then(() => recordMissingSnapshots().catch(() => {}))
      .then(refreshStats);
  }, [mode, authUser, storeId, refreshStats]);

  const handleSaveStoreSettings = async (updates) => {
    await saveStoreSettings(updates);
    setStoreSettingsState((prev) => ({ ...prev, ...updates }));
  };

  const handleSetRankingEnabled = (value) => handleSaveStoreSettings({ rankingEnabled: value });
  const handleSetWeatherEnabled = (value) => handleSaveStoreSettings({ weatherEnabled: value });

  const handleRegisterCustomer = async ({ name, phone, email, requireVerification, referredBy }) => {
    const customerId = await createAccount({ name, phone, email, requireVerification, referredBy });
    await refreshCustomers();
    return customerId;
  };

  const handleSetCustomerStatus = async (customerId, status) => {
    await setCustomerStatus(customerId, status);
    await refreshCustomers();
  };

  const handleDeleteCustomer = async (customerId) => {
    await deleteCustomerPermanently(customerId);
    await refreshCustomers();
  };

  const handleReissueCustomer = async ({ customerId, newPhone, idPhotoDataUrl }) => {
    await reissueCustomerAccess({ customerId, newPhone, idPhotoDataUrl });
    await refreshCustomers();
  };

  const handleUpdateNotifyPrefs = async (customerId, prefs) => {
    let pushToken = null;
    if (prefs.push) {
      pushToken = await requestPushToken();
      if (!pushToken) {
        // Permission denied, or the browser doesn't support push — keep the
        // checkbox state the customer chose, but there's no token to save,
        // so nothing will actually be deliverable until they allow it.
      }
    }
    // Only these two fields — the rules no longer allow writing a whole
    // account from the browser, and rewriting it wholesale is how a balance
    // could get clobbered by a stale copy anyway.
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
    refreshCustomers();
    refreshStats();
  };

  const handleDeduct = async (amount, customerId) => {
    if (!customerId) return;
    await payFromAccount(customerId, amount);
    refreshCustomers();
    refreshStats();
  };

  const handleCancelTransaction = async (customerId, transactionId) => {
    const result = await cancelTransaction(customerId, transactionId);
    refreshCustomers();
    refreshStats();
    return result;
  };

  const totalBalance = customers.reduce((s, c) => s + c.balance, 0);

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
  const [requireVerification, setRequireVerification] = useState(true);
  // Has this device's phone been verified against this account's phone yet?
  const [phoneVerified, setPhoneVerified] = useState(false);

  useEffect(() => {
    if (mode !== "customer" || !myCustomerId || !storeId) return;
    let cancelled = false;
    fetchVerificationInfo(myCustomerId).then(({ phone, requireVerification }) => {
      if (!cancelled) {
        setMyPhone(phone);
        setRequireVerification(requireVerification);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mode, myCustomerId, storeId]);

  // If this browser session's Firebase Auth phone number already matches the
  // account's registered phone, or verification isn't required at all, skip
  // the verification screen and load the real account data.
  useEffect(() => {
    if (myPhone === undefined) return; // still checking
    if (!myPhone || !requireVerification || authUser?.phoneNumber === myPhone) {
      setPhoneVerified(true);
    }
  }, [myPhone, requireVerification, authUser]);

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

  const needsPhoneGate = mode === "customer" && myPhone !== undefined && myPhone && !phoneVerified;

  return (
    <div className="min-h-screen" style={{ background: C.cream, fontFamily: "'Hiragino Sans', system-ui, sans-serif" }}>
      <ModeTopBar mode={mode} storeSettings={storeSettings} branding={branding} />
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
                onClick={storeSignOut}
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
        ) : storeSettings.billingStatus === "locked" ? (
          // 60日ロック後はスタッフのログインも不可。ここに来る時点で認証は
          // 通っているが、それ以上先の画面は見せない。
          <div className="max-w-md mx-auto px-4 pt-10">
            <div className="rounded-2xl p-4 text-center" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
              <div className="text-sm font-bold" style={{ color: C.ink }}>
                このアカウントはご利用いただけません
              </div>
              <div className="text-[12px] mt-2" style={{ color: C.mute }}>
                お支払いの確認が取れていないため、サービスをご利用いただけない状態です。再開をご希望の場合は、再度お申し込みください。
              </div>
              <button
                onClick={storeSignOut}
                className="mt-3 w-full rounded-full py-2.5 text-sm font-bold"
                style={{ background: C.cream, color: C.mute }}
              >
                ログアウト
              </button>
            </div>
          </div>
        ) : (
          <>
            {storeSettings.billingStatus === "suspended" && (
              <div className="max-w-md mx-auto px-4 pt-4">
                <div className="rounded-xl p-3 text-[12px]" style={{ background: "#FDEDED", color: "#B3261E", border: "1px solid #F3C9C9" }}>
                  お支払いの確認が取れておらず、決済・チャージ機能が停止しています。
                  {storeSettings.billingLockAt && (
                    <>
                      {new Date(storeSettings.billingLockAt).toLocaleDateString("ja-JP")}
                      までにお支払いが確認できない場合、ログインもできなくなります。
                    </>
                  )}
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
              onSignOut={storeSignOut}
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
              onSaveBranding={saveBranding}
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
      ) : needsPhoneGate ? (
        <PhoneVerifyGate
          expectedPhone={myPhone}
          onVerified={() => setPhoneVerified(true)}
          termsUrl={storeSettings.termsUrl}
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
      ) : storeSettings.billingStatus === "suspended" || storeSettings.billingStatus === "locked" ? (
        // 店舗自体が停止中(引き落とし失敗25日後 or 解約30日後、いずれも到達済み)。
        // 個々のお客様のアカウント状態とは別の、店舗単位の停止。
        <div className="max-w-md mx-auto px-4 pt-8">
          <div className="rounded-2xl p-4 text-center" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
            <div className="text-sm font-bold" style={{ color: C.ink }}>
              現在ご利用出来ない状況です
            </div>
            <div className="text-[12px] mt-2" style={{ color: C.mute }}>
              残高がある場合などは、スクリーンショットなどで保存をしてください。
            </div>
          </div>
        </div>
      ) : (
        <>
          {storeSettings.billingStatus === "active" && storeSettings.billingSuspendAt && (
            // 停止前の予告。引き落とし失敗・解約のいずれかが検知された時点から、
            // 実際に止まる(suspended化する)までの間ずっと表示する。
            <div className="max-w-md mx-auto px-4 pt-4">
              <div className="rounded-xl p-3 text-[12px]" style={{ background: "#FFF6E5", color: "#8A6100", border: "1px solid #F0DBA0" }}>
                {new Date(storeSettings.billingSuspendAt).toLocaleDateString("ja-JP")}
                までご利用いただけます。残高がある場合はご利用店舗にご確認ください。
              </div>
            </div>
          )}
          <CustomerView
            pointBalance={account.pointBalance || 0}
            depositBalance={account.depositBalance || 0}
            bonusEligible={account.bonusEligible || false}
            onUseBonusSpin={handleUseBonusSpin}
            history={myTransactions}
            rankingEnabled={rankingEnabled}
            customerId={myCustomerId}
            storeSettings={storeSettings}
            branding={branding}
            notifyOptIn={account.notifyOptIn || null}
            onUpdateNotifyPrefs={(prefs) => handleUpdateNotifyPrefs(myCustomerId, prefs)}
          />
        </>
      )}
    </div>
  );
}
