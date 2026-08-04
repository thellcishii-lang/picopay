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

  const settings = (await db.ref("storeSettings").get()).val() || {};
  if (settings.weatherEnabled === false || !settings.weatherAreaCode) {
    return { statusCode: 200, body: JSON.stringify({ skipped: "未設定" }) };
  }

  // Saved at lookup time. Deriving it from the area code would break for
  // 北海道, 鹿児島 and 沖縄, where one prefecture has several offices and the
  // codes don't simply zero out.
  const office = settings.weatherOffice || `${settings.weatherAreaCode.slice(0, 2)}0000`;
  const res = await fetch(`https://www.jma.go.jp/bosai/forecast/data/forecast/${office}.json`);
  const fc = await res.json();

  const series = (((fc[0] || {}).timeSeries || [])[1]) || {};
  const area =
    (series.areas || []).find((a) => a.area.code === settings.weatherAreaCode) ||
    (series.areas || [])[0];
  const pops = (area && area.pops) || [];
  const defines = series.timeDefines || [];

  // Line the three blocks up with the hours they cover, skipping blocks that
  // belong to an earlier day (the feed sometimes starts mid-day).
  const todayPops = defines
    .map((t, i) => ({ time: new Date(t), pop: Number(pops[i]) }))
    .filter((x) => ymd(new Date(x.time.getTime() + 9 * 60 * 60 * 1000)) === today);

  const current = todayPops.find((x) => {
    const h = new Date(x.time.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
    return slotIndexForHour(hour) === slotIndexForHour(h);
  });
  const maxPop = todayPops.reduce((m, x) => Math.max(m, x.pop || 0), 0);

  await db.ref("weather").set({
    date: today,
    updatedAt: Date.now(),
    areaName: area ? area.area.name : null,
    currentPop: current ? current.pop : null,
    maxPop,
  });

  // ---- Auto broadcast ----
  if (settings.weatherAutoMode !== "auto") {
    return { statusCode: 200, body: JSON.stringify({ pop: current ? current.pop : null, mode: "manual" }) };
  }
  if (Number(settings.weatherSendHour ?? 10) !== hour) {
    return { statusCode: 200, body: JSON.stringify({ waiting: true }) };
  }
  if (settings.weatherActiveDate === today) {
    return { statusCode: 200, body: JSON.stringify({ alreadyActive: true }) };
  }
  const threshold = Number(settings.weatherRainThreshold ?? 80);
  if (!current || !(current.pop >= threshold)) {
    return { statusCode: 200, body: JSON.stringify({ pop: current ? current.pop : null, belowThreshold: true }) };
  }

  await db.ref("storeSettings").update({ weatherActiveDate: today });

  const accounts = (await db.ref("accounts").get()).val() || {};
  const tokens = [];
  for (const acc of Object.values(accounts)) {
    for (const t of acc.pushTokens || []) tokens.push(t);
  }
  if (tokens.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ activated: true, pushed: 0 }) };
  }

  const cap = Number(settings.weatherCap ?? 10000).toLocaleString();
  const rate = Math.min(20, Number(settings.weatherRate ?? 10));
  const result = await admin.messaging().sendEachForMulticast({
    notification: {
      title: settings.storeName || "PicoPay",
      body: `今日は雨の確率${current.pop}%☔ ¥${cap}までのチャージで${rate}%還元!`,
    },
    tokens,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ activated: true, pop: current.pop, pushed: result.successCount }),
  };
};
