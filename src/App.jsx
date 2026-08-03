import React, { useState, useEffect, useCallback, useRef } from "react";
import ModeTopBar from "./TopBar.jsx";
import { C, StoreView, CustomerView } from "./components.jsx";
import {
  subscribeToAccount,
  getAccountOnce,
  getAccountVerificationInfo,
  saveAccount,
  createAccount,
  listCustomers,
  getStoreSettings,
  saveStoreSettings,
  getStoreSecrets,
  saveStoreSecrets,
  setCustomerStatus,
  deleteCustomerPermanently,
  reissueCustomerAccess,
  requestPushToken,
  sendPushNotification,
  DEFAULT_ACCOUNT,
  auth,
  subscribeToAuth,
  storeSignIn,
  storeSignUp,
  storeSignOut,
  setupRecaptcha,
  sendPhoneCode,
} from "./firebase.js";

// モード判定: /customer なら顧客画面、それ以外は店舗管理画面
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

  // Auth 状態
  const [authUser, setAuthUser] = useState(undefined);
  useEffect(() => {
    const unsubscribe = subscribeToAuth(setAuthUser);
    return () => unsubscribe();
  }, []);

  // 店舗設定
  const [storeSettings, setStoreSettingsState] = useState({});
  useEffect(() => {
    getStoreSettings().then(setStoreSettingsState);
  }, [mode]);

  const [storeSecrets, setStoreSecretsState] = useState({});
  useEffect(() => {
    if (mode === "store" && authUser) {
      getStoreSecrets().then(setStoreSecretsState);
    }
  }, [mode, authUser]);

  const rankingEnabled = storeSettings.rankingEnabled ?? true;
  const weatherEnabled = storeSettings.weatherEnabled ?? true;

  // ファビコン・マニフェストの設定
  useEffect(() => {
    let cancelled = false;
    const apply = async () => {
      let iconUrl = null;
      if (storeSettings.brandMode === "iconName" && storeSettings.iconImage) {
        iconUrl = storeSettings.iconImage;
      } else if (storeSettings.brandMode === "logo" && storeSettings.logoImage) {
        iconUrl = await padLogoToSquareIcon(storeSettings.logoImage);
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
  }, [storeSettings.brandMode, storeSettings.iconImage, storeSettings.logoImage, storeSettings.storeName]);

  // 顧客リスト管理（店舗側）
  const [customers, setCustomers] = useState([]);
  const refreshCustomers = useCallback(async () => {
    const list = await listCustomers();
    setCustomers(list);
  }, []);
  useEffect(() => {
    if (mode === "store" && authUser) refreshCustomers();
  }, [mode, authUser, refreshCustomers]);

  const handleSaveStoreSettings = async (updates) => {
    await saveStoreSettings(updates);
    setStoreSettingsState((prev) => ({ ...prev, ...updates }));
  };

  const handleSaveStoreSecrets = async (updates) => {
    await saveStoreSecrets(updates);
    setStoreSecretsState((prev) => ({ ...prev, ...updates }));
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

  const applyToAccount = async (customerId, updater) => {
    const current = await getAccountOnce(customerId);
    if (current.status && current.status !== "active") {
      throw new Error(
        current.status === "blacklisted"
          ? "このお客様はブラックリスト登録されているため、決済できません"
          : "このお客様は現在一時停止中のため、決済できません"
      );
    }
    const next = updater(current);
    await saveAccount(customerId, next);
    refreshCustomers();
    return next;
  };

  const applyToOwnAccount = async (customerId, updater) => {
    const current = await getAccountOnce(customerId);
    const next = updater(current);
    await saveAccount(customerId, next);
    return next;
  };

  const handleUpdateNotifyPrefs = async (customerId, prefs) => {
    let pushToken = null;
    if (prefs.push) {
      pushToken = await requestPushToken();
    }
    await applyToOwnAccount(customerId, (prev) => {
      const existingTokens = prev.pushTokens || [];
      const nextTokens =
        prefs.push && pushToken && !existingTokens.includes(pushToken)
          ? [...existingTokens, pushToken]
          : existingTokens;
      return { ...prev, notifyOptIn: prefs, pushTokens: nextTokens };
    });
  };

  const handleSendPush = async (tokens, body) => {
    if (!tokens || tokens.length === 0) return;
    const title = storeSettings.storeName || "PicoPay";
    await sendPushNotification({ tokens, title, body });
  };

  const computeDepositBonus = (amount) => {
    if (!storeSettings.depositBonusEnabled) return 0;
    if (storeSettings.depositBonusFlatMode) {
      return Math.round(amount * ((storeSettings.depositBonusFlatRate || 0) / 100));
    }
    const tiers = storeSettings.depositBonusTiers || [];
    const tier = tiers.find((t) => t.upTo === null || amount <= t.upTo) || tiers[tiers.length - 1];
    return tier ? Math.round(amount * ((tier.rate || 0) / 100)) : 0;
  };

  const handleCharge = async (amount, customerId) => {
    if (!customerId) return;
    await applyToAccount(customerId, (prev) => {
      const giveReferralBonus =
        storeSettings.referralEnabled && prev.referredBy && !prev.referralBonusGiven;
      const refereeBonus = giveReferralBonus
        ? Math.round(amount * ((storeSettings.referralRefereeRate || 0) / 100))
        : 0;
      const depositBonus = computeDepositBonus(amount);
      const history = [
        {
          date: "今日",
          summary: `チャージ ¥${amount.toLocaleString()}`,
          total: amount,
          items: [{ label: "チャージ", amount }],
        },
        ...(prev.history || []),
      ];
      if (depositBonus > 0) {
        history.unshift({
          date: "今日",
          summary: "入金ボーナス",
          total: depositBonus,
          items: [{ label: "入金ボーナス", amount: depositBonus }],
        });
      }
      if (refereeBonus > 0) {
        history.unshift({
          date: "今日",
          summary: `お友達紹介ボーナス+${storeSettings.referralRefereeRate}%`,
          total: refereeBonus,
          items: [{ label: "お友達紹介ボーナス(紹介された方)", amount: refereeBonus }],
        });
      }
      return {
        ...prev,
        depositBalance: (prev.depositBalance || 0) + amount,
        pointBalance: (prev.pointBalance || 0) + refereeBonus + depositBonus,
        bonusEligible: storeSettings.gachaEnabled !== false && amount >= 10000 ? true : prev.bonusEligible,
        referralBonusGiven: giveReferralBonus ? true : prev.referralBonusGiven,
        history,
      };
    });
  };

  const computePurchasePoints = (amount) => {
    if (!storeSettings.purchasePointEnabled) return 0;
    if (storeSettings.purchasePointFlatMode) {
      return Math.round(amount * ((storeSettings.purchasePointFlatRate || 0) / 100));
    }
    const tiers = storeSettings.purchasePointTiers || [];
    const tier = tiers.find((t) => t.upTo === null || amount <= t.upTo) || tiers[tiers.length - 1];
    return tier ? Math.round(amount * ((tier.rate || 0) / 100)) : 0;
  };

  const handleDeduct = (amount, customerId) => {
    if (!customerId) return Promise.resolve();
    return applyToAccount(customerId, (prev) => {
      let remaining = amount;
      const usedPoints = Math.min(prev.pointBalance || 0, remaining);
      remaining -= usedPoints;
      const usedDeposit = Math.min(prev.depositBalance || 0, remaining);
      const newDeposit = Math.max(0, (prev.depositBalance || 0) - remaining);
      const earnedPoints = computePurchasePoints(amount);
      const items = [];
      if (usedPoints > 0) items.push({ label: "お会計(ポイント消費分)", amount: -usedPoints });
      if (usedDeposit > 0) items.push({ label: "お会計(預かり金消費分)", amount: -usedDeposit });
      const history = [
        {
          date: "今日",
          summary: `お会計 -¥${amount.toLocaleString()}`,
          total: -amount,
          items,
        },
        ...(prev.history || []),
      ];
      if (earnedPoints > 0) {
        history.unshift({
          date: "今日",
          summary: "購入ポイント付与",
          total: earnedPoints,
          items: [{ label: "購入ポイント", amount: earnedPoints }],
        });
      }
      return {
        ...prev,
        pointBalance: (prev.pointBalance || 0) - usedPoints + earnedPoints,
        depositBalance: newDeposit,
        history,
      };
    });
  };

  const totalBalance = customers.reduce((s, c) => s + c.balance, 0);

  // ---- Customer-side: 顧客側ロジック ----
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
  const [setupInput, setSetupInput] = useState("");
  const [account, setAccount] = useState(DEFAULT_ACCOUNT);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [myPhone, setMyPhone] = useState(undefined);
  const [requireVerification, setRequireVerification] = useState(true);
  const [phoneVerified, setPhoneVerified] = useState(false);

  useEffect(() => {
    if (mode !== "customer" || !myCustomerId) return;
    let cancelled = false;
    getAccountVerificationInfo(myCustomerId).then(({ phone, requireVerification }) => {
      if (!cancelled) {
        setMyPhone(phone);
        setRequireVerification(requireVerification);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mode, myCustomerId]);

  useEffect(() => {
    if (myPhone === undefined) return;
    if (!myPhone || !requireVerification || authUser?.phoneNumber === myPhone) {
      setPhoneVerified(true);
    }
  }, [myPhone, requireVerification, authUser]);

  useEffect(() => {
    if (mode !== "customer" || !myCustomerId || !phoneVerified) return;
    setAccountLoaded(false);
    const unsubscribe = subscribeToAccount(myCustomerId, (data) => {
      setAccount(data);
      setAccountLoaded(true);
    });
    return () => unsubscribe();
  }, [mode, myCustomerId, phoneVerified]);

  const handleUseBonusSpin = (rate) => {
    if (!myCustomerId) return;
    applyToAccount(myCustomerId, (prev) => {
      const bonus = Math.round((prev.depositBalance || 0) * (rate / 100));
      return {
        ...prev,
        pointBalance: (prev.pointBalance || 0) + bonus,
        bonusEligible: false,
        history: [
          {
            date: "今日",
            summary: `ガチャボーナス+${rate}%`,
            total: bonus,
            items: [{ label: `ガチャボーナス(${rate}%)`, amount: bonus }],
          },
          ...(prev.history || []),
        ],
      };
    });
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

  const needsPhoneGate = mode === "customer" && myPhone !== undefined && myPhone && !phoneVerified;

  return (
    <div className="min-h-screen" style={{ background: C.cream, fontFamily: "'Hiragino Sans', system-ui, sans-serif" }}>
      <ModeTopBar mode={mode} storeSettings={storeSettings} />
      {mode === "store" ? (
        authUser === undefined ? (
          <div className="min-h-screen flex items-center justify-center" style={{ background: C.cream }}>
            <div className="text-sm" style={{ color: C.mute }}>読み込み中…</div>
          </div>
        ) : !authUser ? (
          <StoreLogin />
        ) : (
          <>
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
              onFetchCustomerDetail={getAccountOnce}
              onSetCustomerStatus={handleSetCustomerStatus}
              onDeleteCustomer={handleDeleteCustomer}
              onReissueCustomer={handleReissueCustomer}
              lineUrl={storeSettings.lineUrl || ""}
              storeSettings={storeSettings}
              onSaveStoreSettings={handleSaveStoreSettings}
              onSendPush={handleSendPush}
              storeSecrets={storeSecrets}
              onSaveStoreSecrets={handleSaveStoreSecrets}
            />
            <div className="max-w-md mx-auto px-4 pb-6">
              <button
                onClick={storeSignOut}
                className="text-[11px] font-semibold"
                style={{ color: C.mute }}
              >
                ログアウト({authUser.email})
              </button>
            </div>
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
      ) : (
        <CustomerView
          pointBalance={account.pointBalance || 0}
          depositBalance={account.depositBalance || 0}
          bonusEligible={account.bonusEligible || false}
          onUseBonusSpin={handleUseBonusSpin}
          history={account.history || []}
          rankingEnabled={rankingEnabled}
          customerId={myCustomerId}
          storeSettings={storeSettings}
          notifyOptIn={account.notifyOptIn || null}
          onUpdateNotifyPrefs={(prefs) => handleUpdateNotifyPrefs(myCustomerId, prefs)}
          lineUserId={account.lineUserId || null}
        />
      )}
    </div>
  );
}
