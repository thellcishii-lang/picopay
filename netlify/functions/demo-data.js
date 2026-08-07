// Builds a store that looks like it has been running for two years, so the
// screens can be tested against realistic volume instead of three hand-made
// customers. Also deletes stores, for clearing out test attempts.
//
// Guarded by CREATE_STORE_SECRET — this writes and erases whole stores.
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

const SEI = ["佐藤", "鈴木", "高橋", "田中", "伊藤", "渡辺", "山本", "中村", "小林", "加藤",
  "吉田", "山田", "佐々木", "山口", "松本", "井上", "木村", "林", "斎藤", "清水"];
const MEI = ["太郎", "花子", "健一", "美咲", "翔太", "由美", "大輔", "彩", "拓也", "恵子",
  "涼", "麻衣", "隆", "さやか", "直樹", "遥", "誠", "陽子", "亮"];

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];

function termKeyOf(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  if (m >= 4 && m <= 9) return `${y}-H1`;
  if (m >= 10) return `${y}-H2`;
  return `${y - 1}-H2`;
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Roughly the settings a real store would land on, so the generated points
// match what the app would actually have awarded.
const DEMO_SETTINGS = {
  storeName: "デモ店舗",
  companyName: "デモ株式会社",
  purchasePointEnabled: true,
  purchasePointFlatMode: false,
  purchasePointTiers: [
    { upTo: 3000, rate: 3 },
    { upTo: 10000, rate: 5 },
    { upTo: null, rate: 8 },
  ],
  purchasePointBase: "deposit",
  depositBonusEnabled: true,
  depositBonusFlatMode: false,
  depositBonusTiers: [
    { upTo: 5000, rate: 3 },
    { upTo: 20000, rate: 5 },
    { upTo: null, rate: 8 },
  ],
  depositBonusDailyLimit: 1,
  gachaEnabled: true,
  gachaDailyLimit: 1,
  gachaNormalRows: [
    { id: 1, rate: 2, weight: 50 },
    { id: 2, rate: 5, weight: 30 },
    { id: 3, rate: 8, weight: 15 },
    { id: 4, rate: 10, weight: 5 },
  ],
  referralEnabled: true,
  referralReferrerRate: 10,
  referralRefereeRate: 10,
  rankingEnabled: true,
  weatherEnabled: true,
  weatherRainThreshold: 80,
  weatherRate: 10,
  weatherCap: 10000,
  weatherAutoMode: "confirm",
  weatherSendHour: 10,
  dailyChargeCap: 100000,
};

// 取引を1件書く。本体(transactions)と、集計画面が読む店舗単位の索引
// (txIndex)の両方に書き込む — transact.js が本番でやっているのと同じ形。
// 索引に載せる項目も transact.js と揃えてある。
// batchId は「どれとどれが同じ会計か」の目印。チャージと入金ボーナス、
// お会計と購入ポイントはそれぞれ同じ batchId を共有する。
function writeTx(batch, storeId, customerId, key, batchId, entry) {
  batch[`stores/${storeId}/transactions/${customerId}/${key}`] = { ...entry, batchId };
  batch[`stores/${storeId}/txIndex/${key}`] = {
    customerId,
    ts: entry.ts ?? null,
    kind: entry.kind ?? null,
    summary: entry.summary ?? null,
    total: entry.total ?? null,
    gross: entry.gross ?? null,
    depositUsed: entry.depositUsed ?? null,
    pointUsed: entry.pointUsed ?? null,
    earned: entry.earned ?? null,
    point: entry.point ?? null,
    cash: entry.cash ?? null,
    category: entry.category ?? null,
    batchId,
  };
}

function tierRate(tiers, amount) {
  const t = tiers.find((x) => x.upTo === null || amount <= x.upTo) || tiers[tiers.length - 1];
  return t ? t.rate : 0;
}

async function purge(db, storeIds) {
  const updates = {};
  for (const storeId of storeIds) {
    const accounts = (await db.ref(`stores/${storeId}/accounts`).get()).val() || {};
    for (const id of Object.keys(accounts)) updates[`customerIndex/${id}`] = null;
    const admins = (await db.ref("storeAdmins").get()).val() || {};
    for (const [uid, sid] of Object.entries(admins)) {
      if (sid === storeId) updates[`storeAdmins/${uid}`] = null;
    }
    updates[`stores/${storeId}`] = null;
    updates[`storeList/${storeId}`] = null;
  }
  await db.ref().update(updates);
  return Object.keys(updates).length;
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
  if (body.secret !== process.env.CREATE_STORE_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: "認証できませんでした" }) };
  }

  const db = admin.database();

  if (body.action === "purge") {
    const removed = await purge(db, body.storeIds || []);
    return { statusCode: 200, body: JSON.stringify({ purged: body.storeIds, paths: removed }) };
  }

  const { email, password, adminEmail, customers = 60, months = 24 } = body;
  if (!email || !password) {
    return { statusCode: 400, body: JSON.stringify({ error: "メールアドレスとパスワードは必須です" }) };
  }

  // Store + login
  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(user.uid, { password });
  } catch (e) {
    user = await admin.auth().createUser({ email, password });
  }

  const numberResult = await db.ref("meta/lastStoreNumber").transaction((c) => (c || 10000) + 1);
  const storeId = `p${numberResult.snapshot.val()}`;
  const now = Date.now();
  const startedAt = now - months * 30 * 24 * 60 * 60 * 1000;

  await db.ref().update({
    [`stores/${storeId}/storeSettings`]: { ...DEMO_SETTINGS, createdAt: startedAt },
    [`stores/${storeId}/private`]: { contactEmail: email, adminEmail: adminEmail || null },
    [`stores/${storeId}/stats/startedAt`]: startedAt,
    [`storeAdmins/${user.uid}`]: storeId,
    [`storeList/${storeId}`]: {
      companyName: DEMO_SETTINGS.companyName,
      storeName: DEMO_SETTINGS.storeName,
      contactEmail: email,
      createdAt: startedAt,
      status: "active",
    },
  });

  // ---- Generate ----
  const stats = { cashTotal: 0, pointTotal: 0, points: {}, terms: {} };
  const addStat = (date, cash, category, point) => {
    const key = termKeyOf(date);
    stats.terms[key] = stats.terms[key] || { cash: 0, point: 0, points: {} };
    if (cash) {
      stats.cashTotal += cash;
      stats.terms[key].cash += cash;
    }
    if (point) {
      stats.pointTotal += point;
      stats.terms[key].point += point;
      stats.points[category] = (stats.points[category] || 0) + point;
      stats.terms[key].points[category] = (stats.terms[key].points[category] || 0) + point;
    }
  };

  let batch = {};
  let written = 0;
  const flush = async (force) => {
    if (!force && Object.keys(batch).length < 400) return;
    await db.ref().update(batch);
    written += Object.keys(batch).length;
    batch = {};
  };

  for (let i = 0; i < customers; i += 1) {
    const customerId = `cust-demo-${storeId}-${String(i + 1).padStart(3, "0")}`;
    const name = `${pick(SEI)}${pick(MEI)}`;
    const phone = `+8190${String(10000000 + rnd(89999999))}`;
    // Joined at some point during the two years, not all on day one.
    const joinedAt = startedAt + rnd(months * 30 * 24 * 60 * 60 * 1000 * 0.8);
    let point = 0;
    let deposit = 0;

    // Visit frequency varies — some regulars, some who came twice and stopped.
    const visitsPerMonth = [0.3, 0.8, 1.5, 3][rnd(4)];
    const monthsActive = Math.max(1, Math.floor((now - joinedAt) / (30 * 24 * 60 * 60 * 1000)));
    const visits = Math.max(1, Math.round(monthsActive * visitsPerMonth));

    for (let v = 0; v < visits; v += 1) {
      const at = joinedAt + Math.floor(((now - joinedAt) * (v + 1)) / (visits + 1));
      const date = new Date(at);

      // Charge
      if (v % 3 === 0 || deposit < 3000) {
        const amount = [3000, 5000, 10000, 20000, 30000][rnd(5)];
        const bonus = Math.round(amount * (tierRate(DEMO_SETTINGS.depositBonusTiers, amount) / 100));
        deposit += amount;
        point += bonus;
        // チャージとその入金ボーナスは同じ会計なので batchId を共有する。
        // 取消はこの batchId で引くため、別々にすると片方しか戻らない。
        const chargeBatch = db.ref().push().key;
        writeTx(batch, storeId, customerId, chargeBatch, chargeBatch, {
          date: ymd(date), ts: at, summary: `チャージ ¥${amount.toLocaleString()}`,
          kind: "charge", cash: amount, total: amount,
          items: [{ label: "チャージ", amount }],
        });
        addStat(date, amount, null, 0);
        if (bonus > 0) {
          writeTx(batch, storeId, customerId, db.ref().push().key, chargeBatch, {
            date: ymd(date), ts: at + 1, summary: "入金ボーナス", kind: "point",
            category: "depositBonus", point: bonus, total: bonus,
            items: [{ label: "入金ボーナス", amount: bonus }],
          });
          addStat(date, 0, "depositBonus", bonus);
        }
      }

      // Payment
      const gross = 1000 + rnd(60) * 100;
      const usedPoints = Math.min(point, gross);
      const usedDeposit = Math.min(deposit, gross - usedPoints);
      if (usedPoints + usedDeposit >= gross) {
        const earned = Math.round(usedDeposit * (tierRate(DEMO_SETTINGS.purchasePointTiers, usedDeposit) / 100));
        point = point - usedPoints + earned;
        deposit -= usedDeposit;
        const payBatch = db.ref().push().key;
        writeTx(batch, storeId, customerId, payBatch, payBatch, {
          date: ymd(date), ts: at + 2, summary: `お会計 -¥${gross.toLocaleString()}`,
          kind: "payment", gross, depositUsed: usedDeposit, pointUsed: usedPoints,
          earned, total: -gross,
          items: [
            ...(usedPoints > 0 ? [{ label: "お会計(ポイント消費分)", amount: -usedPoints }] : []),
            ...(usedDeposit > 0 ? [{ label: "お会計(預かり金消費分)", amount: -usedDeposit }] : []),
          ],
        });
        if (earned > 0) {
          writeTx(batch, storeId, customerId, db.ref().push().key, payBatch, {
            date: ymd(date), ts: at + 3, summary: "購入ポイント付与", kind: "purchasePoint",
            category: "purchase", point: earned, total: earned,
            items: [{ label: "購入ポイント", amount: earned }],
          });
          addStat(date, 0, "purchase", earned);
        }
      }
      await flush(false);
    }

    batch[`stores/${storeId}/accounts/${customerId}`] = {
      pointBalance: point,
      depositBalance: deposit,
      bonusEligible: false,
      profile: { name, phone, email: null },
      requireVerification: false,
      status: "active",
      referredBy: null,
      referralBonusGiven: false,
    };
    batch[`customerIndex/${customerId}`] = storeId;
    await flush(false);
  }

  // Reference-date snapshots for terms that have already closed.
  const snapshots = {};
  for (const key of Object.keys(stats.terms)) {
    const [y, half] = key.split("-");
    const end = half === "H1" ? new Date(Number(y), 8, 30) : new Date(Number(y) + 1, 2, 31);
    if (end.getTime() < now) {
      snapshots[key] = {
        at: end.getTime(),
        date: ymd(end),
        deposit: Math.round(stats.terms[key].cash * 0.25),
        point: Math.round(stats.terms[key].point * 0.4),
        cash: stats.terms[key].cash,
        issuedPoints: stats.terms[key].point,
        late: false,
      };
    }
  }

  batch[`stores/${storeId}/stats/cashTotal`] = stats.cashTotal;
  batch[`stores/${storeId}/stats/pointTotal`] = stats.pointTotal;
  batch[`stores/${storeId}/stats/points`] = stats.points;
  batch[`stores/${storeId}/stats/terms`] = stats.terms;
  batch[`stores/${storeId}/stats/snapshots`] = snapshots;
  await flush(true);

  return {
    statusCode: 200,
    body: JSON.stringify({
      storeId,
      uid: user.uid,
      customers,
      writes: written,
      cashTotal: stats.cashTotal,
      pointTotal: stats.pointTotal,
      terms: Object.keys(stats.terms).sort(),
    }),
  };
};
