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
  setCustomerStatus,
  deleteCustomerPermanently,
  reissueCustomerAccess,
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

export default function App() {
  const [mode] = useState(modeFromPath);

  // ---- Auth state (shared: applies to whichever mode this page is) ----
  const [authUser, setAuthUser] = useState(undefined); // undefined = not checked yet, null = signed out
  useEffect(() => {
    const unsubscribe = subscribeToAuth(setAuthUser);
    return () => unsubscribe();
  }, []);

  // Store-side view settings — per-device for now.
  const [rankingEnabled, setRankingEnabled] = useState(true);
  const [weatherEnabled, setWeatherEnabled] = useState(true);

  // ---- Store-side: the full customer list ----
  const [customers, setCustomers] = useState([]);
  const refreshCustomers = useCallback(async () => {
    const list = await listCustomers();
    setCustomers(list);
  }, []);
  useEffect(() => {
    if (mode === "store" && authUser) refreshCustomers();
  }, [mode, authUser, refreshCustomers]);

  const handleRegisterCustomer = async ({ name, phone, email, requireVerification }) => {
    const customerId = await createAccount({ name, phone, email, requireVerification });
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

  // A store device charges/deducts whichever customer it just scanned — it
  // doesn't hold a live subscription to any one account, just does a
  // one-off read-modify-write each time.
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
  };

  const handleCharge = (amount, customerId) => {
    if (!customerId) return Promise.resolve();
    return applyToAccount(customerId, (prev) => ({
      ...prev,
      depositBalance: (prev.depositBalance || 0) + amount,
      bonusEligible: amount >= 10000 ? true : prev.bonusEligible,
      history: [
        {
          date: "今日",
          summary: `チャージ ¥${amount.toLocaleString()}`,
          total: amount,
          items: [{ label: "チャージ", amount }],
        },
        ...(prev.history || []),
      ],
    }));
  };

  const handleDeduct = (amount, customerId) => {
    if (!customerId) return Promise.resolve();
    return applyToAccount(customerId, (prev) => {
      let remaining = amount;
      const usedPoints = Math.min(prev.pointBalance || 0, remaining);
      remaining -= usedPoints;
      const usedDeposit = Math.min(prev.depositBalance || 0, remaining);
      const newDeposit = Math.max(0, (prev.depositBalance || 0) - remaining);
      const items = [];
      if (usedPoints > 0) items.push({ label: "お会計(ポイント消費分)", amount: -usedPoints });
      if (usedDeposit > 0) items.push({ label: "お会計(預かり金消費分)", amount: -usedDeposit });
      return {
        ...prev,
        pointBalance: (prev.pointBalance || 0) - usedPoints,
        depositBalance: newDeposit,
        history: [
          {
            date: "今日",
            summary: `お会計 -¥${amount.toLocaleString()}`,
            total: -amount,
            items,
          },
          ...(prev.history || []),
        ],
      };
    });
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
  const [setupInput, setSetupInput] = useState("");
  const [account, setAccount] = useState(DEFAULT_ACCOUNT);
  const [accountLoaded, setAccountLoaded] = useState(false);
  // The phone number on file for this account, and whether verification is
  // required at all — fetched via a public, read-only lookup so we can
  // decide whether the gate is needed *before* the customer is
  // authenticated (see getAccountVerificationInfo in firebase.js).
  const [myPhone, setMyPhone] = useState(undefined); // undefined = not checked yet, null = no phone on file
  const [requireVerification, setRequireVerification] = useState(true);
  // Has this device's phone been verified against this account's phone yet?
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
      <ModeTopBar mode={mode} />
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
              setRankingEnabled={setRankingEnabled}
              weatherEnabled={weatherEnabled}
              setWeatherEnabled={setWeatherEnabled}
              customers={customers}
              onRegisterCustomer={handleRegisterCustomer}
              onFetchCustomerDetail={getAccountOnce}
              onSetCustomerStatus={handleSetCustomerStatus}
              onDeleteCustomer={handleDeleteCustomer}
              onReissueCustomer={handleReissueCustomer}
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
        />
      )}
    </div>
  );
}
