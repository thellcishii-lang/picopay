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
// act on their own account, and only for actions they're allowed to start
// (the gacha spin) — never a charge or a sale.
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

  const { idToken, storeId, customerId, action, amount } = body;
  if (!idToken || !storeId || !customerId || !action) {
    return { statusCode: 400, body: JSON.stringify({ error: "入力が足りません" }) };
  }

  const db = admin.database();

  try {
    await authorize(idToken, storeId, customerId, action);

    const base = `stores/${storeId}`;
    const [accountSnap, settingsSnap] = await Promise.all([
      db.ref(`${base}/accounts/${customerId}`).get(),
      db.ref(`${base}/storeSettings`).get(),
    ]);
    const account = accountSnap.val();
    const settings = settingsSnap.val() || {};

    if (!account) {
      return { statusCode: 404, body: JSON.stringify({ error: "お客様が見つかりません" }) };
    }
    if (account.status && account.status !== "active") {
      return {
        statusCode: 403,
        body: JSON.stringify({
          error:
            account.status === "blacklisted"
              ? "このお客様はブラックリスト登録されているため、決済できません"
              : "このお客様は現在一時停止中のため、決済できません",
        }),
      };
    }

    const today = dayKey();
    const daily =
      account.dailyBonus && account.dailyBonus.date === today
        ? { ...account.dailyBonus }
        : { date: today, depositCount: 0, gachaCount: 0 };

    const term = termKeyOf();
    const entries = [];
    const statPoints = {};
    let statCash = 0;
    const accountUpdates = {};

    if (action === "charge") {
      const value = Math.floor(Number(amount) || 0);
      if (value <= 0) {
        return { statusCode: 400, body: JSON.stringify({ error: "金額が不正です" }) };
      }
      // The daily cap is enforced here too — it was a setting with nothing
      // behind it before.
      const cap = Number(settings.dailyChargeCap ?? 0);
      if (cap > 0) {
        const chargedToday = Number(daily.chargedAmount || 0);
        if (chargedToday + value > cap) {
          return {
            statusCode: 403,
            body: JSON.stringify({ error: `1日のチャージ上限(¥${cap.toLocaleString()})を超えます` }),
          };
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

      // Referral bonus for the person who was introduced, first charge only.
      let refereeBonus = 0;
      const giveReferral =
        settings.referralEnabled && account.referredBy && !account.referralBonusGiven;
      if (giveReferral) {
        refereeBonus = Math.round(value * (clampRate(settings.referralRefereeRate) / 100));
      }

      entries.push(
        txEntry({
          summary: `チャージ ¥${value.toLocaleString()}`,
          kind: "charge",
          cash: value,
          total: value,
          items: [{ label: "チャージ", amount: value }],
        })
      );
      if (bonus > 0) {
        entries.push(
          txEntry({
            summary: bonusLabel,
            kind: "point",
            category: weatherActive ? "weather" : "depositBonus",
            point: bonus,
            total: bonus,
            items: [{ label: bonusLabel, amount: bonus }],
          })
        );
        statPoints[weatherActive ? "weather" : "depositBonus"] = bonus;
      }
      if (refereeBonus > 0) {
        entries.push(
          txEntry({
            summary: `お友達紹介ボーナス+${clampRate(settings.referralRefereeRate)}%`,
            kind: "point",
            category: "referral",
            point: refereeBonus,
            total: refereeBonus,
            items: [{ label: "お友達紹介ボーナス(紹介された方)", amount: refereeBonus }],
          })
        );
        statPoints.referral = (statPoints.referral || 0) + refereeBonus;
      }

      statCash = value;
      accountUpdates.depositBalance = (account.depositBalance || 0) + value;
      accountUpdates.pointBalance = (account.pointBalance || 0) + bonus + refereeBonus;
      accountUpdates.dailyBonus = daily;
      if (giveReferral) accountUpdates.referralBonusGiven = true;
      if (settings.gachaEnabled !== false && value >= 10000) accountUpdates.bonusEligible = true;

      // The referrer's own bonus lands on a different account.
      if (giveReferral && account.referredBy) {
        const referrerBonus = Math.round(value * (clampRate(settings.referralReferrerRate) / 100));
        if (referrerBonus > 0) {
          const refRef = db.ref(`${base}/accounts/${account.referredBy}`);
          const referrer = (await refRef.get()).val();
          if (referrer && (!referrer.status || referrer.status === "active")) {
            await refRef.update({ pointBalance: (referrer.pointBalance || 0) + referrerBonus });
            await db.ref(`${base}/transactions/${account.referredBy}`).push(
              txEntry({
                summary: `お友達紹介ボーナス+${clampRate(settings.referralReferrerRate)}%`,
                kind: "point",
                category: "referral",
                point: referrerBonus,
                total: referrerBonus,
                items: [{ label: "お友達紹介ボーナス(紹介した方)", amount: referrerBonus }],
              })
            );
            statPoints.referral = (statPoints.referral || 0) + referrerBonus;
          }
        }
      }
    } else if (action === "payment") {
      const value = Math.floor(Number(amount) || 0);
      if (value <= 0) {
        return { statusCode: 400, body: JSON.stringify({ error: "金額が不正です" }) };
      }
      const usedPoints = Math.min(account.pointBalance || 0, value);
      const remaining = value - usedPoints;
      const usedDeposit = Math.min(account.depositBalance || 0, remaining);
      if (usedPoints + usedDeposit < value) {
        return { statusCode: 400, body: JSON.stringify({ error: "残高が足りません" }) };
      }

      const pointBase = settings.purchasePointBase === "total" ? value : usedDeposit;
      const earned = computePurchasePoints(settings, pointBase);

      const items = [];
      if (usedPoints > 0) items.push({ label: "お会計(ポイント消費分)", amount: -usedPoints });
      if (usedDeposit > 0) items.push({ label: "お会計(預かり金消費分)", amount: -usedDeposit });

      entries.push(
        txEntry({
          summary: `お会計 -¥${value.toLocaleString()}`,
          kind: "payment",
          gross: value,
          depositUsed: usedDeposit,
          pointUsed: usedPoints,
          earned,
          total: -value,
          items,
        })
      );
      if (earned > 0) {
        entries.push(
          txEntry({
            summary: "購入ポイント付与",
            kind: "purchasePoint",
            category: "purchase",
            point: earned,
            total: earned,
            items: [{ label: "購入ポイント", amount: earned }],
          })
        );
        statPoints.purchase = earned;
      }

      accountUpdates.pointBalance = (account.pointBalance || 0) - usedPoints + earned;
      accountUpdates.depositBalance = (account.depositBalance || 0) - usedDeposit;
    } else if (action === "gacha") {
      if (!account.bonusEligible) {
        return { statusCode: 403, body: JSON.stringify({ error: "ガチャを回せる状態ではありません" }) };
      }
      const gachaLimit = Math.max(1, Number(settings.gachaDailyLimit ?? 1));
      if ((daily.gachaCount || 0) >= gachaLimit) {
        await db.ref(`${base}/accounts/${customerId}`).update({ bonusEligible: false });
        return { statusCode: 403, body: JSON.stringify({ error: "本日の回数を使い切っています" }) };
      }

      // The winning rate is drawn here, not in the browser — otherwise the
      // customer's device decides its own prize.
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
      const bonus = Math.round((account.depositBalance || 0) * (rate / 100));

      daily.gachaCount = (daily.gachaCount || 0) + 1;
      accountUpdates.pointBalance = (account.pointBalance || 0) + bonus;
      accountUpdates.bonusEligible = false;
      accountUpdates.dailyBonus = daily;

      if (bonus > 0) {
        entries.push(
          txEntry({
            summary: `ガチャボーナス+${rate}%`,
            kind: "point",
            category: "gacha",
            point: bonus,
            total: bonus,
            items: [{ label: `ガチャボーナス(${rate}%)`, amount: bonus }],
          })
        );
        statPoints.gacha = bonus;
      }
      accountUpdates.lastGachaRate = rate;
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: "不明な操作です" }) };
    }

    // One write for the account, the new transactions and the running totals,
    // so a failure can't leave the balance changed without a matching record.
    const updates = {};
    for (const [key, value] of Object.entries(accountUpdates)) {
      updates[`${base}/accounts/${customerId}/${key}`] = value;
    }
    for (const entry of entries) {
      const key = db.ref(`${base}/transactions/${customerId}`).push().key;
      updates[`${base}/transactions/${customerId}/${key}`] = entry;
    }
    let pointTotal = 0;
    for (const [key, value] of Object.entries(statPoints)) {
      if (!value) continue;
      pointTotal += value;
      updates[`${base}/stats/points/${key}`] = admin.database.ServerValue.increment(value);
      updates[`${base}/stats/terms/${term}/points/${key}`] = admin.database.ServerValue.increment(value);
    }
    if (pointTotal) {
      updates[`${base}/stats/pointTotal`] = admin.database.ServerValue.increment(pointTotal);
      updates[`${base}/stats/terms/${term}/point`] = admin.database.ServerValue.increment(pointTotal);
    }
    if (statCash) {
      updates[`${base}/stats/cashTotal`] = admin.database.ServerValue.increment(statCash);
      updates[`${base}/stats/terms/${term}/cash`] = admin.database.ServerValue.increment(statCash);
    }

    await db.ref().update(updates);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, rate: accountUpdates.lastGachaRate ?? null }),
    };
  } catch (e) {
    return {
      statusCode: e.statusCode || 500,
      body: JSON.stringify({ error: e.message || "処理に失敗しました" }),
    };
  }
};
