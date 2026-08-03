// Firebase setup for PicoPay
// This connects to the "PicoPay" Firebase project's Realtime Database and Authentication.
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, get } from "firebase/database";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from "firebase/auth";

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
export const auth = getAuth(app);

// ---- Auth: store side (email/password) ----
export function subscribeToAuth(callback) {
  return onAuthStateChanged(auth, callback);
}
export async function storeSignIn(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}
export async function storeSignUp(email, password) {
  await createUserWithEmailAndPassword(auth, email, password);
}
export async function storeSignOut() {
  await signOut(auth);
}

// ---- Auth: customer side (phone number / SMS code) ----
// `containerId` is the id of an invisible div already in the DOM.
export function setupRecaptcha(containerId) {
  return new RecaptchaVerifier(auth, containerId, { size: "invisible" });
}
// Sends the SMS and returns a "confirmation" object — call confirmation.confirm(code) next.
export async function sendPhoneCode(phoneNumber, recaptchaVerifier) {
  return await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier);
}

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

// Read just a customer's phone number (public by design — see security
// rules) so the app can decide whether to show the phone verification gate
// *before* the customer is authenticated (otherwise it's a chicken-and-egg
// problem: you'd need to be verified to read the data that tells you
// verification is needed). Also reads whether verification is required at
// all for this account (store staff can turn it off per customer).
export async function getAccountVerificationInfo(customerId) {
  const [phoneSnap, requireSnap] = await Promise.all([
    get(ref(db, `accounts/${customerId}/profile/phone`)),
    get(ref(db, `accounts/${customerId}/requireVerification`)),
  ]);
  return {
    phone: phoneSnap.val() || null,
    requireVerification: requireSnap.val() !== false, // default true if unset
  };
}

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

// Create a brand-new customer account (used by store-side registration).
// Generates a short, unique-enough ID and writes fresh default data plus
// whatever profile fields were collected at registration. `phone` must be a
// real number (E.164 format, e.g. +819012345678) since it's what the
// customer will use to verify their identity later.
export async function createAccount({ name, phone, email, requireVerification = true }) {
  if (!phone) throw new Error("電話番号は必須です(お客様の本人確認に使います)");
  const customerId =
    "cust-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  const account = {
    ...DEFAULT_ACCOUNT,
    pointBalance: 0,
    depositBalance: 0,
    bonusEligible: false,
    history: [],
    profile: { name, phone, email: email || null },
    requireVerification,
  };
  await set(ref(db, `accounts/${customerId}`), account);
  return customerId;
}

// List all registered customers (for the store's customer list screen).
export async function listCustomers() {
  const snapshot = await get(ref(db, "accounts"));
  const data = snapshot.val() || {};
  return Object.entries(data).map(([id, acc]) => ({
    id,
    name: acc.profile?.name || "(名前未登録)",
    phone: acc.profile?.phone || null,
    email: acc.profile?.email || null,
    balance: (acc.pointBalance || 0) + (acc.depositBalance || 0),
  }));
}

export { DEFAULT_ACCOUNT };
