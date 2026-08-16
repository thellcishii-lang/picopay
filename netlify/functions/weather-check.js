// Hourly job for the 天気連動ゲリラボーナス.
//
// Two jobs in one pass:
//   1. Fetch today's rain probability and store it, so the dashboard can show
//      "本日は雨の確率が80%です" without every device calling 気象庁 itself.
//   2. If the store is on 自動配信 and this is its configured hour, and the
//      probability for that hour clears the threshold, activate the bonus and
//      push the announcement.
//
// It runs every hour rather than only at the configured time because the
// configured time is a store setting — the schedule can't follow it.
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

// 気象庁 publishes today's rain probability in three blocks: 6-12, 12-18,
// 18-24. Which one applies depends on the hour being asked about.
function slotIndexForHour(hour) {
  if (hour < 12) return 0;
  if (hour < 18) return 1;
  return 2;
}

exports.handler = async () => {
  const now = jstNow();
  const hour = now.getUTCHours();
  const today = ymd(now);
  const db = admin.database();

  const storeIds = Object.keys((await db.ref("storeList").get()).val() || {});
  const results = [];

  // Forecasts are shared per area, so the same office is often fetched by
  // several stores. Cached for the duration of this run.
  const forecastCache = new Map();
  const fetchForecast = async (office) => {
    if (!forecastCache.has(office)) {
      const res = await fetch(`https://www.jma.go.jp/bosai/forecast/data/forecast/${office}.json`);
      forecastCache.set(office, await res.json());
    }
    return forecastCache.get(office);
  };

  for (const storeId of storeIds) {
    const base = `stores/${storeId}`;
    const settings = (await db.ref(`${base}/storeSettings`).get()).val() || {};
    if (settings.weatherEnabled === false || !settings.weatherAreaCode) continue;

    const office = settings.weatherOffice || `${settings.weatherAreaCode.slice(0, 2)}0000`;
    const fc = await fetchForecast(office);

    const series = (((fc[0] || {}).timeSeries || [])[1]) || {};
    const area =
      (series.areas || []).find((a) => a.area.code === settings.weatherAreaCode) ||
      (series.areas || [])[0];
    const pops = (area && area.pops) || [];
    const defines = series.timeDefines || [];

    const todayPops = defines
      .map((t, i) => ({ time: new Date(t), pop: Number(pops[i]) }))
      .filter((x) => ymd(new Date(x.time.getTime() + 9 * 60 * 60 * 1000)) === today);

    const current = todayPops.find((x) => {
      const h = new Date(x.time.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
      return slotIndexForHour(hour) === slotIndexForHour(h);
    });
    const maxPop = todayPops.reduce((m, x) => Math.max(m, x.pop || 0), 0);

    await db.ref(`${base}/weather`).set({
      date: today,
      updatedAt: Date.now(),
      areaName: area ? area.area.name : null,
      currentPop: current ? current.pop : null,
      maxPop,
    });

    // ---- Auto broadcast ----
    if (settings.weatherAutoMode !== "auto") continue;
    if (Number(settings.weatherSendHour ?? 10) !== hour) continue;
    if (settings.weatherActiveDate === today) continue;
    const threshold = Number(settings.weatherRainThreshold ?? 80);
    if (!current || !(current.pop >= threshold)) continue;

    await db.ref(`${base}/storeSettings`).update({ weatherActiveDate: today });

    const accounts = (await db.ref(`${base}/accounts`).get()).val() || {};
    const tokens = [];
    for (const acc of Object.values(accounts)) {
      for (const t of acc.pushTokens || []) tokens.push(t);
    }
    if (tokens.length === 0) {
      results.push({ storeId, activated: true, pushed: 0 });
      continue;
    }

    const cap = Number(settings.weatherCap ?? 10000).toLocaleString();
    const rate = Math.min(20, Number(settings.weatherRate ?? 10));
    const sent = await admin.messaging().sendEachForMulticast({
      notification: {
        title: settings.storeName || "PicoPay",
        body: `今日は雨の確率${current.pop}%☔ ¥${cap}までのチャージで${rate}%還元!`,
      },
      tokens,
    });
    results.push({ storeId, activated: true, pushed: sent.successCount });
  }

  return { statusCode: 200, body: JSON.stringify({ stores: storeIds.length, results }) };
};
