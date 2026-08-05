// Every change to money happens here.
//
// Balances used to be calculated in the browser and written straight to the
// database. That meant a customer who passed SMS verification could set their
// own deposit balance to anything they liked — the rules could only check
// *who* was writing, not *what*. Bonus rates, daily caps and the 20% ceiling
// were all enforced by code the customer's device was running.
//
// Now the browser only says "charge ¥3,000 for this customer" and the
// server decides what that means, using the store's saved settings. The rules
// deny balance writes from the client entirely, so there's no other way in.
//
// The caller proves who they are with their Firebase ID token, which is
// verified here — a shared secret wouldn't do, since anyone holding it could
// top up any account in any store.
//
// Every account mutation runs inside a Realtime Database transaction()
// rather than a plain read-then-write. Two devices hitting the same customer
// at the same moment used to be able to clobber each other — both would read
// the same starting balance, compute their own result, and whichever wrote
// last would silently erase the other's change. transaction() re-runs the
// update against whatever the value actually is at commit time, so both
// operations land correctly regardless of ordering.
const admin = require("firebase-admin");

const DATABASE_URL =
  "https://picopay-5a53e-default-rtdb.asia-southeast1.firebasedatabase.app";

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL,
  });
}

const increment = admin.database.ServerValue.increment;

const MAX_RATE = 20;
const clampRate = (v) => Math.min(MAX_RATE, Math.max(0, Number(v) || 0));

function dayKey(d = new Date(Date.now() + 9 * 60 * 60 * 1000)) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

function termKeyOf(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  if (m >= 4 && m <= 9) return `${y}-H1`;
  if (m >= 10) return `${y}-H2`;
  return `${y - 1}-H2`;
}

function tierRate(tiers, amount) {
  const list = tiers || [];
  const tier = list.find((t) => t.upTo === null || amount <= t.upTo) || list[list.length - 1];
  return tier ? clampRate(tier.rate) : 0;
}

function computeDepositBonus(settings, amount) {
  if (!settings.depositBonusEnabled) return 0;
  if (settings.depositBonusFlatMode) {
    return Math.round(amount * (clampRate(settings.depositBonusFlatRate) / 100));
  }
  return Math.round(amount * (tierRate(settings.depositBonusTiers, amount) / 100));
}

function computePurchasePoints(settings, base) {
  if (!settings.purchasePointEnabled) return 0;
  if (settings.purchasePointFlatMode) {
    return Math.round(base * (clampRate(settings.purchasePointFlatRate) / 100));
  }
  return Math.round(base * (tierRate(settings.purchasePointTiers, base) / 100));
}

// Store staff may act on any customer in their own store. A customer may only
// act on their own account, and only to start the gacha spin — never a
// charge, a sale, or a cancellation.
async function authorize(idToken, storeId, customerId, action) {
  const decoded = await admin.auth().verifyIdToken(idToken);
  const db = admin.database();

  const staffStore = (await db.ref(`storeAdmins/${decoded.uid}`).get()).val();
  if (staffStore && staffStore === storeId) return { as: "staff", uid: decoded.uid };

  if (action === "gacha" && decoded.phone_number) {
    const phone = (
      await db.ref(`stores/${storeId}/accounts/${customerId}/profile/phone`).get()
    ).val();
    if (phone && phone === decoded.phone_number) return { as: "customer", uid: decoded.uid };
  }

  const error = new Error("この操作を行う権限がありません");
  error.statusCode = 403;
  throw error;
}

function txEntry(fields) {
  return { date: "今日", ts: Date.now(), ...fields };
}

// ---- charge / payment / gacha ----
// All three mutate exactly one account, so they share one shape: read
// settings once (outside the race), then run the whole business-logic +
// balance change inside a single transaction() on that account. Side effects
// that aren't part of the account object itself (the transaction-history
// entries to write, the stat totals to bump, a friendly error message) are
// captured in `effects`, which the transaction body overwrites on every
// invocation — since transaction() may re-run the callback under
// contention, only the values from the attempt that actually committed are
// ever read afterward.
async function runAccountAction({ db, base, customerId, action, amount, settings }) {
  const batchId = db.ref().push().key;
  const today = dayKey();
  const term = termKeyOf();

  let effects;
  const accountRef = db.ref(`${base}/accounts/${customerId}`);

  const txResult = await accountRef.transaction((current) => {
    effects = { entries: [], statPoints: {}, statCash: 0, rate: null, error: null, crossAccount: null };
    if (!current) {
      effects.error = "お客様が見つかりません";
      return; // abort
    }
    if (current.status && current.status !== "active") {
      effects.error =
        current.status === "blacklisted"
          ? "このお客様はブラックリスト登録されているため、決済できません"
          : "このお客様は現在一時停止中のため、決済できません";
      return; // abort
    }

    const daily =
      current.dailyBonus && current.dailyBonus.date === today
        ? { ...current.dailyBonus }
        : { date: today, depositCount: 0, gachaCount: 0 };
    const next = { ...current };

    if (action === "charge") {
      const value = Math.floor(Number(amount) || 0);
      if (value <= 0) {
        effects.error = "金額が不正です";
        return;
      }
      const cap = Number(settings.dailyChargeCap ?? 0);
      if (cap > 0) {
        const chargedToday = Number(daily.chargedAmount || 0);
        if (chargedToday + value > cap) {
          effects.error = `1日のチャージ上限(¥${cap.toLocaleString()})を超えます`;
          return;
        }
        daily.chargedAmount = chargedToday + value;
      }

      const depositLimit = Math.max(1, Number(settings.depositBonusDailyLimit ?? 1));
      const weatherActive =
        settings.weatherEnabled !== false && settings.weatherActiveDate === today;

      let bonus = 0;
      let bonusLabel = "入金ボーナス";
      if ((daily.depositCount || 0) < depositLimit) {
        if (weatherActive) {
          const capped = Math.min(value, Number(settings.weatherCap ?? value));
          bonus = Math.round(capped * (clampRate(settings.weatherRate) / 100));
          bonusLabel = "雨の日ボーナス";
        } else {
          bonus = computeDepositBonus(settings, value);
        }
        if (bonus > 0) daily.depositCount = (daily.depositCount || 0) + 1;
      }

      let refereeBonus = 0;
      const giveReferral =
        settings.referralEnabled && current.referredBy && !current.referralBonusGiven;
      if (giveReferral) {
        refereeBonus = Math.round(value * (clampRate(settings.referralRefereeRate) / 100));
      }

      effects.entries.push(
        txEntry({
          summary: `チャージ ¥${value.toLocaleString()}`,
          kind: "charge",
          cash: value,
          total: value,
          batchId,
          items: [{ label: "チャージ", amount: value }],
        })
      );
      if (bonus > 0) {
        effects.entries.push(
          txEntry({
            summary: bonusLabel,
            kind: "point",
            category: weatherActive ? "weather" : "depositBonus",
            point: bonus,
            total: bonus,
            batchId,
            items: [{ label: bonusLabel, amount: bonus }],
          })
        );
        effects.statPoints[weatherActive ? "weather" : "depositBonus"] = bonus;
      }
      if (refereeBonus > 0) {
        effects.entries.push(
          txEntry({
            summary: `お友達紹介ボーナス+${clampRate(settings.referralRefereeRate)}%`,
            kind: "point",
            category: "referral",
            point: refereeBonus,
            total: refereeBonus,
            batchId,
            items: [{ label: "お友達紹介ボーナス(紹介された方)", amount: refereeBonus }],
          })
        );
        effects.statPoints.referral = (effects.statPoints.referral || 0) + refereeBonus;
      }

      effects.statCash = value;
      next.depositBalance = (current.depositBalance || 0) + value;
      next.pointBalance = (current.pointBalance || 0) + bonus + refereeBonus;
      next.dailyBonus = daily;
      if (giveReferral) next.referralBonusGiven = true;
      if (settings.gachaEnabled !== false && value >= 10000) next.bonusEligible = true;

      if (giveReferral && current.referredBy) {
        const referrerBonus = Math.round(value * (clampRate(settings.referralReferrerRate) / 100));
        if (referrerBonus > 0) {
          effects.crossAccount = {
            accountId: current.referredBy,
            pointDelta: referrerBonus,
            entry: txEntry({
              summary: `お友達紹介ボーナス+${clampRate(settings.referralReferrerRate)}%`,
              kind: "point",
              category: "referral",
              point: referrerBonus,
              total: referrerBonus,
              batchId,
              items: [{ label: "お友達紹介ボーナス(紹介した方)", amount: referrerBonus }],
            }),
          };
          effects.statPoints.referral = (effects.statPoints.referral || 0) + referrerBonus;
        }
      }
    } else if (action === "payment") {
      const value = Math.floor(Number(amount) || 0);
      if (value <= 0) {
        effects.error = "金額が不正です";
        return;
      }
      const usedPoints = Math.min(current.pointBalance || 0, value);
      const remaining = value - usedPoints;
      const usedDeposit = Math.min(current.depositBalance || 0, remaining);
      if (usedPoints + usedDeposit < value) {
        effects.error = "残高が足りません";
        return;
      }

      const pointBase = settings.purchasePointBase === "total" ? value : usedDeposit;
      const earned = computePurchasePoints(settings, pointBase);

      const items = [];
      if (usedPoints > 0) items.push({ label: "お会計(ポイント消費分)", amount: -usedPoints });
      if (usedDeposit > 0) items.push({ label: "お会計(預かり金消費分)", amount: -usedDeposit });

      effects.entries.push(
        txEntry({
          summary: `お会計 -¥${value.toLocaleString()}`,
          kind: "payment",
          gross: value,
          depositUsed: usedDeposit,
          pointUsed: usedPoints,
          earned,
          total: -value,
          batchId,
          items,
        })
      );
      if (earned > 0) {
        effects.entries.push(
          txEntry({
            summary: "購入ポイント付与",
            kind: "purchasePoint",
            category: "purchase",
            point: earned,
            total: earned,
            batchId,
            items: [{ label: "購入ポイント", amount: earned }],
          })
        );
        effects.statPoints.purchase = earned;
      }

      next.pointBalance = (current.pointBalance || 0) - usedPoints + earned;
      next.depositBalance = (current.depositBalance || 0) - usedDeposit;
    } else if (action === "gacha") {
      if (!current.bonusEligible) {
        effects.error = "ガチャを回せる状態ではありません";
        return;
      }
      const gachaLimit = Math.max(1, Number(settings.gachaDailyLimit ?? 1));
      if ((daily.gachaCount || 0) >= gachaLimit) {
        // Not an abort — the attempt is consumed either way, so the
        // eligibility flag still needs clearing.
        next.bonusEligible = false;
        next.dailyBonus = daily;
        effects.error = "本日の回数を使い切っています";
        return next;
      }

      const rows =
        (settings.weatherActiveDate === today ? settings.gachaRainRows : settings.gachaNormalRows) ||
        settings.gachaNormalRows ||
        [];
      const totalWeight = rows.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);
      let rate = 0;
      if (totalWeight > 0) {
        let roll = Math.random() * totalWeight;
        for (const row of rows) {
          roll -= Number(row.weight) || 0;
          if (roll <= 0) {
            rate = clampRate(row.rate);
            break;
          }
        }
      }
      const bonus = Math.round((current.depositBalance || 0) * (rate / 100));

      daily.gachaCount = (daily.gachaCount || 0) + 1;
      next.pointBalance = (current.pointBalance || 0) + bonus;
      next.bonusEligible = false;
      next.dailyBonus = daily;
      effects.rate = rate;

      if (bonus > 0) {
        effects.entries.push(
          txEntry({
            summary: `ガチャボーナス+${rate}%`,
            kind: "point",
            category: "gacha",
            point: bonus,
            total: bonus,
            batchId,
            items: [{ label: `ガチャボーナス(${rate}%)`, amount: bonus }],
          })
        );
        effects.statPoints.gacha = bonus;
      }
    }

    return next;
  });

  if (!txResult.committed) {
    const err = new Error(effects?.error || "処理できませんでした");
    err.statusCode = effects?.error ? 403 : 409;
    throw err;
  }
  // The gacha "no spins left" case commits (to clear eligibility) but is
  // still a failure from the customer's point of view.
  if (effects.error) {
    const err = new Error(effects.error);
    err.statusCode = 403;
    throw err;
  }

  // Cross-account referrer bonus — its own transaction, since it's a
  // different account that could just as easily be mid-charge itself.
  if (effects.crossAccount) {
    const refRef = db.ref(`${base}/accounts/${effects.crossAccount.accountId}`);
    const refResult = await refRef.transaction((current) => {
      if (!current || (current.status && current.status !== "active")) return; // abort silently
      return { ...current, pointBalance: (current.pointBalance || 0) + effects.crossAccount.pointDelta };
    });
    if (refResult.committed) {
      await db
        .ref(`${base}/transactions/${effects.crossAccount.accountId}`)
        .push(effects.crossAccount.entry);
    } else {
      // Referrer couldn't be credited (blacklisted, deleted, etc). The
      // charge itself still succeeds; the referral portion is simply
      // skipped rather than left half-applied.
      delete effects.statPoints.referral;
    }
  }

  // Transaction-history entries and running totals are appended separately.
  // ServerValue.increment on the stats paths is itself atomic per path, so
  // concurrent charges add up correctly even though this isn't inside the
  // account transaction.
  const updates = {};
  for (const entry of effects.entries) {
    const key = db.ref(`${base}/transactions/${customerId}`).push().key;
    updates[`${base}/transactions/${customerId}/${key}`] = entry;
  }
  let pointTotal = 0;
  for (const [key, value] of Object.entries(effects.statPoints)) {
    if (!value) continue;
    pointTotal += value;
    updates[`${base}/stats/points/${key}`] = increment(value);
    updates[`${base}/stats/terms/${term}/points/${key}`] = increment(value);
  }
  if (pointTotal) {
    updates[`${base}/stats/pointTotal`] = increment(pointTotal);
    updates[`${base}/stats/terms/${term}/point`] = increment(pointTotal);
  }
  if (effects.statCash) {
    updates[`${base}/stats/cashTotal`] = increment(effects.statCash);
    updates[`${base}/stats/terms/${term}/cash`] = increment(effects.statCash);
  }
  if (Object.keys(updates).length > 0) await db.ref().update(updates);

  return { ok: true, rate: effects.rate };
}

// ---- cancel ----
// Reverses every entry from one action (matched by batchId — a charge and
// its bonus are cancelled together, not one at a time) on the initiating
// customer's account, and the referrer's account too if that charge
// triggered a cross-account referral bonus. Same-day only: past that, too
// much else may already depend on the balance the entry created.
async function handleCancel({ db, base, customerId, transactionId }) {
  if (!transactionId) {
    const err = new Error("取消対象のIDが必要です");
    err.statusCode = 400;
    throw err;
  }

  const original = (await db.ref(`${base}/transactions/${customerId}/${transactionId}`).get()).val();
  if (!original) {
    const err = new Error("対象の取引が見つかりません");
    err.statusCode = 404;
    throw err;
  }
  if (original.canceled) {
    const err = new Error("この取引は既に取消済みです");
    err.statusCode = 400;
    throw err;
  }
  if (original.kind === "cancellation") {
    const err = new Error("取消の記録は取消できません");
    err.statusCode = 400;
    throw err;
  }
  if (dayKey(new Date(original.ts)) !== dayKey()) {
    const err = new Error("当日の取引のみ取消できます");
    err.statusCode = 403;
    throw err;
  }

  const batchId = original.batchId || transactionId;
  const term = termKeyOf(new Date(original.ts));

  const ownSnap = (await db.ref(`${base}/transactions/${customerId}`).get()).val() || {};
  const ownKeys = Object.entries(ownSnap)
    .filter(([key, e]) => (e.batchId || key) === batchId && !e.canceled && e.kind !== "cancellation")
    .map(([key]) => key);

  let depositDelta = 0;
  let pointDelta = 0;
  const statDelta = {};
  let cashDelta = 0;
  let clearReferralFlag = false;

  for (const key of ownKeys) {
    const e = ownSnap[key];
    if (e.kind === "charge") {
      depositDelta -= e.cash || 0;
      cashDelta -= e.cash || 0;
    } else if (e.kind === "point") {
      pointDelta -= e.point || 0;
      if (e.category) statDelta[e.category] = (statDelta[e.category] || 0) - (e.point || 0);
      if (e.category === "referral") clearReferralFlag = true;
    } else if (e.kind === "payment") {
      depositDelta += e.depositUsed || 0;
      pointDelta += e.pointUsed || 0;
      pointDelta -= e.earned || 0;
    } else if (e.kind === "purchasePoint") {
      // Accounted via the sibling payment entry's `earned` field above —
      // only the stat category needs decrementing here, not the balance.
      if (e.category) statDelta[e.category] = (statDelta[e.category] || 0) - (e.point || 0);
    }
  }

  // The referrer's half, if this batch granted a cross-account bonus.
  const account = (await db.ref(`${base}/accounts/${customerId}`).get()).val();
  let referrerId = null;
  let referrerKey = null;
  let referrerPointDelta = 0;
  if (account && account.referredBy) {
    const referrerSnap = (await db.ref(`${base}/transactions/${account.referredBy}`).get()).val() || {};
    for (const [key, e] of Object.entries(referrerSnap)) {
      if ((e.batchId || key) === batchId && !e.canceled && e.category === "referral") {
        referrerId = account.referredBy;
        referrerKey = key;
        referrerPointDelta -= e.point || 0;
        statDelta.referral = (statDelta.referral || 0) - (e.point || 0);
        break;
      }
    }
  }

  if (ownKeys.length === 0 && !referrerId) {
    const err = new Error("取消できる内容がありません");
    err.statusCode = 400;
    throw err;
  }

  // Reverse the initiating customer's balance. transaction() both applies
  // the change and re-checks it wouldn't go negative at commit time — if
  // the points or deposit were already spent since this entry was made,
  // the cancellation is refused rather than pushing the balance below zero.
  const accountRef = db.ref(`${base}/accounts/${customerId}`);
  const result = await accountRef.transaction((current) => {
    if (!current) return; // abort
    const newDeposit = (current.depositBalance || 0) + depositDelta;
    const newPoint = (current.pointBalance || 0) + pointDelta;
    if (newDeposit < 0 || newPoint < 0) return; // abort — already spent
    return {
      ...current,
      depositBalance: newDeposit,
      pointBalance: newPoint,
      referralBonusGiven: clearReferralFlag ? false : current.referralBonusGiven,
    };
  });
  if (!result.committed) {
    const err = new Error(
      "取消すると残高がマイナスになるため取消できません(既に使用されている可能性があります)"
    );
    err.statusCode = 409;
    throw err;
  }

  // The referrer's side is a separate account and a separate transaction —
  // reversed only if it still can be without going negative. If it can't,
  // the customer's side stays reversed regardless; that half is reported
  // back so staff know to check it by hand.
  let referrerReversed = false;
  let referrerBlocked = false;
  if (referrerId) {
    const refRef = db.ref(`${base}/accounts/${referrerId}`);
    const refResult = await refRef.transaction((current) => {
      if (!current) return;
      const newPoint = (current.pointBalance || 0) + referrerPointDelta;
      if (newPoint < 0) return; // abort
      return { ...current, pointBalance: newPoint };
    });
    referrerReversed = refResult.committed;
    referrerBlocked = !refResult.committed;
    if (!referrerReversed) {
      delete statDelta.referral;
    }
  }

  // Mark every reversed entry canceled, write the cancellation records, and
  // apply the stat deltas — one multi-path update.
  const updates = {};
  for (const key of ownKeys) {
    updates[`${base}/transactions/${customerId}/${key}/canceled`] = true;
  }
  const cancelKey = db.ref(`${base}/transactions/${customerId}`).push().key;
  updates[`${base}/transactions/${customerId}/${cancelKey}`] = txEntry({
    summary: `取消: ${original.summary || ""}`,
    kind: "cancellation",
    reversalOf: transactionId,
    total: -(original.total || 0),
  });

  if (referrerReversed && referrerKey) {
    updates[`${base}/transactions/${referrerId}/${referrerKey}/canceled`] = true;
    const refCancelKey = db.ref(`${base}/transactions/${referrerId}`).push().key;
    updates[`${base}/transactions/${referrerId}/${refCancelKey}`] = txEntry({
      summary: "取消: お友達紹介ボーナス(紹介した方)",
      kind: "cancellation",
      reversalOf: referrerKey,
      total: -referrerPointDelta,
    });
  }

  for (const [key, value] of Object.entries(statDelta)) {
    if (!value) continue;
    updates[`${base}/stats/points/${key}`] = increment(value);
    updates[`${base}/stats/terms/${term}/points/${key}`] = increment(value);
  }
  const pointStatTotal = Object.values(statDelta).reduce((s, v) => s + (v || 0), 0);
  if (pointStatTotal) {
    updates[`${base}/stats/pointTotal`] = increment(pointStatTotal);
    updates[`${base}/stats/terms/${term}/point`] = increment(pointStatTotal);
  }
  if (cashDelta) {
    updates[`${base}/stats/cashTotal`] = increment(cashDelta);
    updates[`${base}/stats/terms/${term}/cash`] = increment(cashDelta);
  }

  await db.ref().update(updates);

  return {
    ok: true,
    referrerBlocked,
    note: referrerBlocked
      ? "お客様分は取消しましたが、紹介した方の分は残高不足のため取消できませんでした。個別にご確認ください。"
      : null,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "POSTで呼び出してください" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "リクエストの形式が不正です" }) };
  }

  const { idToken, storeId, customerId, action, amount, transactionId } = body;
  if (!idToken || !storeId || !customerId || !action) {
    return { statusCode: 400, body: JSON.stringify({ error: "入力が足りません" }) };
  }

  const db = admin.database();
  const base = `stores/${storeId}`;

  try {
    await authorize(idToken, storeId, customerId, action);

    let result;
    if (action === "cancel") {
      result = await handleCancel({ db, base, customerId, transactionId });
    } else if (["charge", "payment", "gacha"].includes(action)) {
      const settings = (await db.ref(`${base}/storeSettings`).get()).val() || {};
      result = await runAccountAction({ db, base, customerId, action, amount, settings });
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: "不明な操作です" }) };
    }

    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (e) {
    return {
      statusCode: e.statusCode || 500,
      body: JSON.stringify({ error: e.message || "処理に失敗しました" }),
    };
  }
};
