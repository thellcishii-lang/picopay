// Firebase setup for PicoPay
// This connects to the "PicoPay" Firebase project's Realtime Database.
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, get } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyD8k35AAE9s1MeXj5pB7WVrGKg3Wlkv-xA",
  authDomain: "picopay-5a53e.firebaseapp.com",
  databaseURL: "https://picopay-5a53e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "picopay-5a53e",
  storageBucket: "picopay-5a53e.firebasestorage.app",
  messagingSenderId: "479126770039",
  appId: "1:479126770039:web:dcdf6274a257e42a6e9172",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

// ---- Account helpers ----
// One "account" = one customer's PicoPay balance/history.
// Path in the database: accounts/<customerId>

const DEFAULT_ACCOUNT = {
  pointBalance: 1200,
  depositBalance: 3000,
  bonusEligible: false,
  history: [
    {
      date: "7/22",
      summary: "お会計・チャージ",
      total: -1800,
      items: [{ label: "お会計(お化粧品)", amount: -1800 }],
    },
    {
      date: "7/20",
      summary: "チャージ+ボーナス15%",
      total: 11500,
      items: [
        { label: "チャージ", amount: 10000 },
        { label: "ボーナス(15%)", amount: 1500 },
      ],
    },
    {
      date: "7/15",
      summary: "お会計",
      total: -2400,
      items: [{ label: "お会計(トリートメント)", amount: -2400 }],
    },
  ],
};

// Subscribe to real-time changes for one customer's account.
// Calls `callback(account)` immediately and again every time the data changes
// anywhere (this device, another device, the store, etc). Returns an
// unsubscribe function.
export function subscribeToAccount(customerId, callback) {
  const accountRef = ref(db, `accounts/${customerId}`);
  const unsubscribe = onValue(accountRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      callback(data);
    } else {
      // No account yet at this path — create it with defaults.
      set(accountRef, DEFAULT_ACCOUNT);
      callback(DEFAULT_ACCOUNT);
    }
  });
  return unsubscribe;
}

// Read an account once (no live subscription) — useful for one-off store-side lookups.
export async function getAccountOnce(customerId) {
  const snapshot = await get(ref(db, `accounts/${customerId}`));
  return snapshot.val() || DEFAULT_ACCOUNT;
}

// Overwrite the full account object for a customer.
export async function saveAccount(customerId, account) {
  await set(ref(db, `accounts/${customerId}`), account);
}

export { DEFAULT_ACCOUNT };
