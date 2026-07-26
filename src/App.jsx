import React, { useState, useEffect, useCallback } from "react";
import ModeTopBar from "./TopBar.jsx";
import { C, mockCustomers, StoreView, CustomerView } from "./components.jsx";
import { subscribeToAccount, saveAccount, DEFAULT_ACCOUNT } from "./firebase.js";

// For now everyone shares one demo customer account. Once PicoPay supports
// multiple real customers, this would come from login / the scanned QR code
// instead of being hardcoded.
const DEMO_CUSTOMER_ID = "demo-0001";

export default function App() {
  // Which role this browser/device is acting as. This is purely local — it's
  // not something that needs to sync between devices, so localStorage is fine.
  const [mode, setMode] = useState(() => localStorage.getItem("picopay-mode") || "store");
  useEffect(() => {
    localStorage.setItem("picopay-mode", mode);
  }, [mode]);

  // Store-side view settings — also per-device for now.
  const [rankingEnabled, setRankingEnabled] = useState(true);
  const [weatherEnabled, setWeatherEnabled] = useState(true);

  // The real, shared account data — lives in Firebase, synced in real time
  // to every device (store and customer) automatically.
  const [account, setAccount] = useState(DEFAULT_ACCOUNT);
  const [accountLoaded, setAccountLoaded] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToAccount(DEMO_CUSTOMER_ID, (data) => {
      setAccount(data);
      setAccountLoaded(true);
    });
    return () => unsubscribe();
  }, []);

  const updateAccount = useCallback((updater) => {
    setAccount((prev) => {
      const next = updater(prev);
      saveAccount(DEMO_CUSTOMER_ID, next);
      return next;
    });
  }, []);

  const handleCharge = (amount) => {
    updateAccount((prev) => ({
      ...prev,
      depositBalance: prev.depositBalance + amount,
      bonusEligible: amount >= 10000 ? true : prev.bonusEligible,
      history: [
        {
          date: "今日",
          summary: `チャージ ¥${amount.toLocaleString()}`,
          total: amount,
          items: [{ label: "チャージ", amount }],
        },
        ...prev.history,
      ],
    }));
  };

  const handleDeduct = (amount) => {
    updateAccount((prev) => {
      let remaining = amount;
      const usedPoints = Math.min(prev.pointBalance, remaining);
      remaining -= usedPoints;
      const newDeposit = Math.max(0, prev.depositBalance - remaining);
      return {
        ...prev,
        pointBalance: prev.pointBalance - usedPoints,
        depositBalance: newDeposit,
        history: [
          {
            date: "今日",
            summary: `お会計 -¥${amount.toLocaleString()}`,
            total: -amount,
            items: [{ label: "お会計(ポイントから優先使用)", amount: -amount }],
          },
          ...prev.history,
        ],
      };
    });
  };

  const handleUseBonusSpin = (rate) => {
    updateAccount((prev) => {
      const bonus = Math.round(prev.depositBalance * (rate / 100));
      return {
        ...prev,
        pointBalance: prev.pointBalance + bonus,
        bonusEligible: false,
        history: [
          {
            date: "今日",
            summary: `ガチャボーナス+${rate}%`,
            total: bonus,
            items: [{ label: `ガチャボーナス(${rate}%)`, amount: bonus }],
          },
          ...prev.history,
        ],
      };
    });
  };

  const totalBalance =
    mockCustomers.reduce((s, c) => s + c.balance, 0) + account.depositBalance + account.pointBalance;

  if (!accountLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.cream }}>
        <div className="text-sm" style={{ color: C.mute }}>読み込み中…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: C.cream, fontFamily: "'Hiragino Sans', system-ui, sans-serif" }}>
      <ModeTopBar mode={mode} setMode={setMode} />
      {mode === "store" ? (
        <StoreView
          totalBalance={totalBalance}
          onCharge={handleCharge}
          onDeduct={handleDeduct}
          rankingEnabled={rankingEnabled}
          setRankingEnabled={setRankingEnabled}
          weatherEnabled={weatherEnabled}
          setWeatherEnabled={setWeatherEnabled}
        />
      ) : (
        <CustomerView
          pointBalance={account.pointBalance}
          depositBalance={account.depositBalance}
          bonusEligible={account.bonusEligible}
          onUseBonusSpin={handleUseBonusSpin}
          history={account.history}
          rankingEnabled={rankingEnabled}
        />
      )}
    </div>
  );
}
