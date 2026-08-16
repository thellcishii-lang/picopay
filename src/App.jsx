import React, { useState, useEffect, useCallback } from "react";
import {
  subscribeToAuth,
  storeSignIn,
  storeSignOut,
  setCurrentStore,
  getCurrentStore,
  listCustomers,
  getCustomerEntry,
  createAccount,
  setCustomerStatus,
  deleteCustomerPermanently,
  reissueCustomerAccess,
  updateNotifyPrefs,
  requestPushToken,
  sendPushNotification,
  subscribeToPushIndex,
  getStoreSettings,
  saveStoreSettings,
  getBranding,
  saveBranding,
  getStatusMessages,
  getStats,
  recordStats,
  ensureStatsStarted,
  subscribeToWeather,
  lookupWeatherArea,
  subscribeToRoles,
  getRoles,
  saveRole,
  deleteRole,
  verifyRolePassword,
  chargeAccount,
  payFromAccount,
  cancelTransaction,
  spinGacha,
  fetchVerificationInfo,
  subscribeToAccount,
  subscribeToAccountTransactions,
  getAccountOnce,
  listAccountTransactions,
  listTransactions,
  resolveStoreForAdmin,
  resolveStoreForCustomer,
  exportAllStoreData,
  DEFAULT_ACCOUNT,
} from "./firebase.js";
import {
  StoreLogin,
  StoreDashboard,
  CustomerScreen,
  CustomerRegistration,
  ChargeScreen,
  CustomerDetailPanel,
  SettingsPanel,
  WeatherCampaignSettings,
  RankSettings,
  GachaSettings,
  DepositBonusSettings,
  PointSettings,
  SystemSafetySettings,
  IssuerInfoSettings,
  DepositExpirySettings,
  ChannelBroadcastSection,
  StatusMessageEditor,
  RoleManager,
  TransactionList,
  C,
  PICO_PLACEHOLDER,
  resolveBrandImage,
} from "./components.jsx";

function modeFromPath() {
  if (typeof window === "undefined") return "store";
  return window.location.pathname.startsWith("/store") ? "store" : "customer";
}

function SmsGate({ expectedPhone, onVerified }) {
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  const sendCode = async () => {
    setSending(true);
    setError(null);
    try {
      const { sendPhoneCode, setupRecaptcha } = await import("./firebase.js");
      const verifier = setupRecaptcha("recaptcha-container");
      const conf = await sendPhoneCode(expectedPhone, verifier);
      setConfirmation(conf);
    } catch (e) {
      setError(e.message || "SMSの送信に失敗しました");
    } finally {
      setSending(false);
    }
  };

  const verifyCode = async () => {
    setError(null);
    try {
      await confirmation.confirm(code);
      onVerified();
    } catch (e) {
      setError("確認コードが正しくありません");
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6" style={{ background: C.cream }}>
      <div className="w-full max-w-sm rounded-2xl p-6 shadow-lg" style={{ background: "#fff" }}>
        <h2 className="text-lg font-bold" style={{ color: C.ink }}>本人確認(SMS認証)</h2>
        <p className="mt-2 text-sm" style={{ color: C.muted }}>
          登録された電話番号({expectedPhone})宛にSMSで確認コードを送ります
        </p>
        <div id="recaptcha-container" className="mt-3" />
        {!confirmation ? (
          <button
            onClick={sendCode}
            disabled={sending}
            className="mt-3 w-full rounded-lg py-2.5 text-sm font-bold text-white"
            style={{ background: C.teal, opacity: sending ? 0.6 : 1 }}
          >
            {sending ? "送信中…" : "確認コードを送信"}
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
              onClick={verifyCode}
              className="mt-3 w-full rounded-lg py-2.5 text-sm font-bold text-white"
              style={{ background: C.teal }}
            >
              確認
            </button>
          </>
        )}
        {error && (
          <p className="mt-2 text-sm" style={{ color: C.coral }}>{error}</p>
        )}
      </div>
    </div>
  );
}

function padLogoToSquareIcon(logoDataUrl, size = 512, background = "#FBF7F0") {
  return new Promise((resolve) => {
    const img = new Image();
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
        resolve(null);
      }
    };
    img.src = logoDataUrl;
  });
}

export default function App() {
  const [mode] = useState(modeFromPath);

  const [authUser, setAuthUser] = useState(undefined);
  const [storeId, setStoreId] = useState(undefined);
  useEffect(() => {
    const unsubscribe = subscribeToAuth(setAuthUser);
    return () => unsubscribe();
  }, []);

  const [storeSettings, setStoreSettingsState] = useState({});
  const [branding, setBrandingState] = useState({});
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

  const rankingEnabled = storeSettings.rankingEnabled ?? true;
  const weatherEnabled = storeSettings.weatherEnabled ?? true;

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

      const origin = window.location.origin;
      let startUrl;
      if (window.location.pathname.startsWith("/store")) {
        startUrl = origin + "/store";
      } else {
        const fromLink = new URLSearchParams(window.location.search).get("id");
        const savedId = fromLink || localStorage.getItem("picopay-customer-id");
        startUrl = origin + "/customer" + (savedId ? `?id=${savedId}` : "");
      }

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

  const [customers, setCustomers] = useState([]);
  const refreshCustomers = useCallback(async () => {
    const list = await listCustomers();
    setCustomers(list);
  }, []);

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

  const [stats, setStats] = useState({});
  const [weather, setWeather] = useState({});
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
    ensureStatsStarted().then(refreshStats);
  }, [mode, authUser, storeId, refreshStats]);

  const handleSaveStoreSettings = async (updates) => {
    await saveStoreSettings(updates);
    setStoreSettingsState((prev) => ({ ...prev, ...updates }));
  };

  const handleSetRankingEnabled = (value) => handleSaveStoreSettings({ rankingEnabled: value });
  const handleSetWeatherEnabled = (value) => handleSaveStoreSettings({ weatherEnabled: value });

  const handleRegisterCustomer = async ({ name, phone, email, referredBy }) => {
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
        // Permission denied, or the browser doesn't support push
      }
    }
    await updateNotifyPrefs(customerId, prefs, pushToken);
  };

  const handleSendPush = async (tokens, body) => {
    if (!tokens || tokens.length === 0) return;
    const title = storeSettings.storeName || "PicoPay";
    await sendPushNotification({ tokens, title, body, storeId: currentStoreId });
  };

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

  const totalBalance = customers.reduce((s, c) => s + (c.depositBalance || 0), 0);

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
  const [myTransactions, setMyTransactions] = useState([]);
  useEffect(() => {
    if (!myCustomerId || !storeId) return;
    return subscribeToAccountTransactions(myCustomerId, setMyTransactions, 50);
  }, [myCustomerId, storeId]);

  const [myPhone, setMyPhone] = useState(undefined);
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

  useEffect(() => {
    if (myPhone === undefined) return;
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

  const handleUseBonusSpin = async () => {
    if (!myCustomerId) return 0;
    return await spinGacha(myCustomerId);
  };

  const confirmSetup = () => {
    const raw = setupInput.trim();
    let id = raw;
    if (raw.startsWith("PICOPAY-SETUP:")) id = raw.split(":")[1];
    else if (raw.includes("?id=")) id = raw.split("?id=")[1];
    if (!id) return;
    localStorage.setItem("picopay-customer-id", id);
    setMyCustomerId(id);
  };

  const serviceStatus = storeSettings.serviceStatus || "active";
  const depositExpiryNoticeAt = (settings, lastVisitAt) => {
  if (!settings?.depositExpiryEnabled || !lastVisitAt) return null;
  const years = settings.depositExpiryYears || 1;
  const noticeDays = 30;
  const expiryTime = lastVisitAt + years * 365 * 24 * 60 * 60 * 1000;
  const noticeTime = expiryTime - noticeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  if (now < noticeTime || now > expiryTime) return null;
  return noticeTime;
};
  const msg = (key) => {
  const storeMsg = statusMessages.store?.[key];
  const sharedMsg = statusMessages.shared?.[key];
  const defaults = {
    terminatedStore: "この店舗はサービスを終了しました。ご利用ありがとうございました。",
    warningStore: "サービス継続に関する重要なお知らせがあります。詳細はメールをご確認ください。",
    suspendedStore: "この店舗は一時停止中です。詳細は運営までお問い合わせください。",
    terminatedCustomer: "この店舗はサービスを終了しました。残高の払い戻しについては店舗までお問い合わせください。",
    suspendedCustomer: "この店舗は一時停止中です。詳細は店舗までお問い合わせください。",
  };
  return storeMsg || sharedMsg || defaults[key] || key;
};
  const expiryNoticeAt = depositExpiryNoticeAt(storeSettings, account?.lastVisitAt);

  const [termsAgreed, setTermsAgreed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("picopay-terms-agreed") === "1";
  });
  const [showTerms, setShowTerms] = useState(false);

  const needsPhoneGate = mode === "customer" && myPhone !== undefined && myPhone && !phoneVerified;

  return (
    <div className="min-h-screen" style={{ background: C.cream }}>
      <header className="flex items-center justify-between px-4 py-3" style={{ background: C.teal }}>
        <h1 className="text-lg font-bold text-white">
          {storeSettings.storeName || "PicoPay"}
        </h1>
      </header>

      {mode === "store" ? (
        authUser === undefined ? (
          <div className="flex min-h-screen items-center justify-center" style={{ color: C.muted }}>
            読み込み中…
          </div>
        ) : !authUser ? (
          <StoreLogin onSignIn={storeSignIn} />
        ) : storeId === undefined ? (
          <div className="flex min-h-screen items-center justify-center" style={{ color: C.muted }}>
            読み込み中…
          </div>
        ) : !storeId ? (
          <div className="flex min-h-screen flex-col items-center justify-center px-6">
            <h2 className="text-xl font-bold" style={{ color: C.ink }}>店舗が見つかりません</h2>
            <p className="mt-2 text-sm" style={{ color: C.muted }}>
              このアカウントには店舗が紐づいていません。お申し込み時のメールをご確認いただくか、サポートまでご連絡ください。
            </p>
          </div>
        ) : !settingsLoaded ? (
          <div className="flex min-h-screen items-center justify-center" style={{ color: C.muted }}>
            読み込み中…
          </div>
        ) : serviceStatus === "terminated" ? (
          <div className="flex min-h-screen flex-col items-center justify-center px-6">
            <h2 className="text-xl font-bold" style={{ color: C.ink }}>{msg("terminatedStore")}</h2>
          </div>
        ) : (
          <>
            {(serviceStatus === "warning" || serviceStatus === "suspended") && (
              <div className="px-4 py-2 text-center text-sm text-white" style={{ background: serviceStatus === "warning" ? "#C9A227" : C.coral }}>
                {msg(serviceStatus === "warning" ? "warningStore" : "suspendedStore")}
              </div>
            )}
            <StoreDashboard
              customers={customers}
              totalBalance={totalBalance}
              onRefresh={refreshCustomers}
              onCharge={handleCharge}
              onDeduct={handleDeduct}
              onRegister={handleRegisterCustomer}
              onFetchDetail={async (id) => {
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
                const saved = await saveBranding(fields);
                setBrandingState((prev) => ({ ...prev, ...saved }));
              }}
            />
          </>
        )
      ) : !myCustomerId ? (
        <div className="flex min-h-screen flex-col items-center justify-center px-6">
          <h2 className="text-xl font-bold" style={{ color: C.ink }}>PicoPayへようこそ</h2>
          <p className="mt-2 text-sm" style={{ color: C.muted }}>
            お店で発行されたお客様IDを入力してください(最初の1回だけです)
          </p>
          <input
            value={setupInput}
            onChange={(e) => setSetupInput(e.target.value)}
            placeholder="例: cust-xxxxxxxx"
            className="mt-3 w-full max-w-xs rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "#fff", color: C.ink }}
          />
          <button
            onClick={confirmSetup}
            className="mt-3 w-full max-w-xs rounded-lg py-2.5 text-sm font-bold text-white"
            style={{ background: C.teal }}
          >
            決定
          </button>
        </div>
      ) : myPhone === undefined ? (
        <div className="flex min-h-screen items-center justify-center" style={{ color: C.muted }}>
          読み込み中…
        </div>
      ) : !termsAgreed ? (
        <div className="flex min-h-screen flex-col items-center justify-center px-6">
          <h2 className="text-xl font-bold" style={{ color: C.ink }}>利用規約</h2>
          <p className="mt-2 text-sm" style={{ color: C.muted }}>
            本サービスをご利用いただくには、利用規約への同意が必要です。
          </p>
          <button
            onClick={() => {
              localStorage.setItem("picopay-terms-agreed", "1");
              setTermsAgreed(true);
            }}
            className="mt-4 w-full max-w-xs rounded-lg py-2.5 text-sm font-bold text-white"
            style={{ background: C.teal }}
          >
            同意して続ける
          </button>
        </div>
      ) : showTerms ? (
        <div className="px-6 py-8">
          <h2 className="text-xl font-bold" style={{ color: C.ink }}>利用規約</h2>
          <p className="mt-2 text-sm" style={{ color: C.muted }}>（規約本文）</p>
          <button
            onClick={() => setShowTerms(false)}
            className="mt-4 rounded-lg px-4 py-2 text-sm font-bold text-white"
            style={{ background: C.teal }}
          >
            閉じる
          </button>
        </div>
      ) : needsPhoneGate ? (
        <SmsGate expectedPhone={myPhone} onVerified={() => setPhoneVerified(true)} />
      ) : !accountLoaded ? (
        <div className="flex min-h-screen items-center justify-center" style={{ color: C.muted }}>
          読み込み中…
        </div>
      ) : account.status && account.status !== "active" ? (
        <div className="flex min-h-screen flex-col items-center justify-center px-6">
          <h2 className="text-xl font-bold" style={{ color: C.ink }}>現在このアカウントはご利用いただけません</h2>
          <p className="mt-2 text-sm" style={{ color: C.muted }}>
            詳しくは導入店舗までお問い合わせください
          </p>
        </div>
      ) : serviceStatus === "suspended" || serviceStatus === "terminated" ? (
        <div className="flex min-h-screen flex-col items-center justify-center px-6">
          <h2 className="text-xl font-bold" style={{ color: C.ink }}>
            {msg(serviceStatus === "terminated" ? "terminatedCustomer" : "suspendedCustomer")}
          </h2>
        </div>
      ) : (
        <>
          {expiryNoticeAt && (
            <div className="px-4 py-2 text-center text-sm" style={{ background: "#C9A227", color: "#fff" }}>
              預かり残高は{new Date(expiryNoticeAt).toLocaleDateString("ja-JP")}
              に失効します。ご来店・ご利用で継続されます。
            </div>
          )}
          <CustomerScreen
            account={account}
            transactions={myTransactions}
            storeSettings={storeSettings}
            branding={branding}
            onUseBonusSpin={handleUseBonusSpin}
            onUpdateNotifyPrefs={(prefs) => handleUpdateNotifyPrefs(myCustomerId, prefs)}
            onOpenTerms={() => setShowTerms(true)}
          />
        </>
      )}
    </div>
  );
}
