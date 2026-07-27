import React, { useState, useEffect, useCallback } from "react";
import ModeTopBar from "./TopBar.jsx";
import { C, StoreView, CustomerView } from "./components.jsx";
import {
  subscribeToAccount,
  getAccountOnce,
  saveAccount,
  createAccount,
  listCustomers,
  DEFAULT_ACCOUNT,
} from "./firebase.js";

// Which role this page is depends on the URL, not a button:
//   /store    → store admin screen (share this URL with staff devices)
//   /customer → customer screen (share this URL, or the setup link, with customers)
//   anything else defaults to /store, so the bare site URL still works.
function modeFromPath() {
  return window.location.pathname.startsWith("/customer") ? "customer" : "store";
}

export default function App() {
  const [mode] = useState(modeFromPath);

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
    if (mode === "store") refreshCustomers();
  }, [mode, refreshCustomers]);

  const handleRegisterCustomer = async ({ name, phone, email }) => {
    const customerId = await createAccount({ name, phone, email });
    await refreshCustomers();
    return customerId;
  };

  // A store device charges/deducts whichever customer it just scanned — it
  // doesn't hold a live subscription to any one account, just does a
  // one-off read-modify-write each time.
  const applyToAccount = async (customerId, updater) => {
    const current = await getAccountOnce(customerId);
    const next = updater(current);
    await saveAccount(customerId, next);
    refreshCustomers();
  };

  const handleCharge = (amount, customerId) => {
    if (!customerId) return;
    applyToAccount(customerId, (prev) => ({
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
    if (!customerId) return;
    applyToAccount(customerId, (prev) => {
      let remaining = amount;
      const usedPoints = Math.min(prev.pointBalance || 0, remaining);
      remaining -= usedPoints;
      const newDeposit = Math.max(0, (prev.depositBalance || 0) - remaining);
      return {
        ...prev,
        pointBalance: (prev.pointBalance || 0) - usedPoints,
        depositBalance: newDeposit,
        history: [
          {
            date: "今日",
            summary: `お会計 -¥${amount.toLocaleString()}`,
            total: -amount,
            items: [{ label: "お会計(ポイントから優先使用)", amount: -amount }],
          },
          ...(prev.history || []),
        ],
      };
    });
  };

  const totalBalance = customers.reduce((s, c) => s + c.balance, 0);

  // ---- Customer-side: this device's own account ----
  // A customer arrives here one of two ways:
  //  - via /customer?id=cust-xxxx (from scanning the setup QR) — auto-saved
  //  - via the plain /customer link — asked to type the ID once
  // Either way, after the first time it's remembered in localStorage.
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

  useEffect(() => {
    if (mode !== "customer" || !myCustomerId) return;
    setAccountLoaded(false);
    const unsubscribe = subscribeToAccount(myCustomerId, (data) => {
      setAccount(data);
      setAccountLoaded(true);
    });
    return () => unsubscribe();
  }, [mode, myCustomerId]);

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

  return (
    <div className="min-h-screen" style={{ background: C.cream, fontFamily: "'Hiragino Sans', system-ui, sans-serif" }}>
      <ModeTopBar mode={mode} />
      {mode === "store" ? (
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
        />
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
      ) : !accountLoaded ? (
        <div className="min-h-screen flex items-center justify-center" style={{ background: C.cream }}>
          <div className="text-sm" style={{ color: C.mute }}>読み込み中…</div>
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
