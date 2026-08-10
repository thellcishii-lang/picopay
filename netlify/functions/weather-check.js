// Hourly job for the 天気連動ゲリラボーナス.
// マルチテナント対応版 — 全店舗を巡回し、各店舗の設定に従って処理する。
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

function jstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

function slotIndexForHour(hour) {
  if (hour < 12) return 0;
  if (hour < 18) return 1;
  return 2;
}

// 気象庁API結果をエリアコード単位でキャッシュ（同じエリアの店舗が複数あっても1回だけ呼ぶ）
const weatherCache = new Map();

async function fetchWeather(areaCode, office) {
  const cacheKey = `${areaCode}:${ymd(jstNow())}`;
  if (weatherCache.has(cacheKey)) {
    return weatherCache.get(cacheKey);
  }

  const res = await fetch(`https://www.jma.go.jp/bosai/forecast/data/forecast/${office}.json`);
  const fc = await res.json();

  const series = (((fc[0] || {}).timeSeries || [])[1]) || {};
  const area =
    (series.areas || []).find((a) => a.area.code === areaCode) ||
    (series.areas || [])[0];
  const pops = (area && area.pops) || [];
  const defines = series.timeDefines || [];

  const today = ymd(jstNow());
  const todayPops = defines
    .map((t, i) => ({ time: new Date(t), pop: Number(pops[i]) }))
    .filter((x) => ymd(new Date(x.time.getTime() + 9 * 60 * 60 * 1000)) === today);

  const result = { area, todayPops, areaName: area ? area.area.name : null };
  weatherCache.set(cacheKey, result);
  return result;
}

exports.handler = async () => {
  const now = jstNow();
  const hour = now.getUTCHours();
  const today = ymd(now);
  const db = admin.database();

  // 全店舗を取得
  const storesSnap = (await db.ref("stores").get()).val() || {};
  const results = [];

  for (const [storeId, storeData] of Object.entries(storesSnap)) {
    const settings = storeData.storeSettings || {};
    
    // 天気連動が無効またはエリアコード未設定ならスキップ
    if (settings.weatherEnabled === false || !settings.weatherAreaCode) {
      continue;
    }

    const office = settings.weatherOffice || `${settings.weatherAreaCode.slice(0, 2)}0000`;
    const { area, todayPops, areaName } = await fetchWeather(settings.weatherAreaCode, office);

    const current = todayPops.find((x) => {
      const h = new Date(x.time.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
      return slotIndexForHour(hour) === slotIndexForHour(h);
    });
    const maxPop = todayPops.reduce((m, x) => Math.max(m, x.pop || 0), 0);

    const base = `stores/${storeId}`;

    // 店舗ごとに天気データを保存
    await db.ref(`${base}/weather`).set({
      date: today,
      updatedAt: Date.now(),
      areaName,
      currentPop: current ? current.pop : null,
      maxPop,
    });

    // 自動配信判定
    if (settings.weatherAutoMode !== "auto") {
      results.push({ storeId, mode: "manual" });
      continue;
    }
    if (Number(settings.weatherSendHour ?? 10) !== hour) {
      results.push({ storeId, waiting: true });
      continue;
    }
    if (settings.weatherActiveDate === today) {
      results.push({ storeId, alreadyActive: true });
      continue;
    }
    
    const threshold = Number(settings.weatherRainThreshold ?? 80);
    if (!current || !(current.pop >= threshold)) {
      results.push({ storeId, pop: current ? current.pop : null, belowThreshold: true });
      continue;
    }

    // ボーナス有効化
    await db.ref(`${base}/storeSettings`).update({ weatherActiveDate: today });

    // 自店舗の顧客のみに通知
    const accounts = (await db.ref(`${base}/accounts`).get()).val() || {};
    const tokens = [];
    for (const acc of Object.values(accounts)) {
      // pushTokens が配列かオブジェクトかに対応
      const pt = acc.pushTokens;
      if (Array.isArray(pt)) {
        for (const t of pt) if (t) tokens.push(t);
      } else if (typeof pt === "object" && pt) {
        for (const t of Object.keys(pt)) if (t) tokens.push(t);
      }
    }

    let pushed = 0;
    if (tokens.length > 0) {
      const cap = Number(settings.weatherCap ?? 10000).toLocaleString();
      const rate = Math.min(20, Number(settings.weatherRate ?? 10));
      
      const result = await admin.messaging().sendEachForMulticast({
        notification: {
          title: settings.storeName || "PicoPay",
          body: `今日は雨の確率${current.pop}%☔ ¥${cap}までのチャージで${rate}%還元!`,
        },
        tokens,
      });
      pushed = result.successCount;
    }

    results.push({ storeId, activated: true, pop: current.pop, pushed });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ today, hour, processed: results.length, results }),
  };
};
