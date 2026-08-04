// Turns a Japanese postal code into a 気象庁 forecast area.
//
// Two lookups are chained: postal code → 都道府県 (zipcloud, free, no key),
// then 都道府県 → the areas the 気象庁 publishes forecasts for. This runs once,
// when the store saves its settings — never on the daily job — so if the
// postal-code service is ever unavailable it can't stop the campaign from
// running, only from being re-configured.

// 気象庁 office codes, one per prefecture. A handful of prefectures are split
// into several offices; the main one is used, and the store can pick a
// different area from the list that comes back.
const OFFICE_BY_PREF = {
  北海道: "016000",
  青森県: "020000",
  岩手県: "030000",
  宮城県: "040000",
  秋田県: "050000",
  山形県: "060000",
  福島県: "070000",
  茨城県: "080000",
  栃木県: "090000",
  群馬県: "100000",
  埼玉県: "110000",
  千葉県: "120000",
  東京都: "130000",
  神奈川県: "140000",
  新潟県: "150000",
  富山県: "160000",
  石川県: "170000",
  福井県: "180000",
  山梨県: "190000",
  長野県: "200000",
  岐阜県: "210000",
  静岡県: "220000",
  愛知県: "230000",
  三重県: "240000",
  滋賀県: "250000",
  京都府: "260000",
  大阪府: "270000",
  兵庫県: "280000",
  奈良県: "290000",
  和歌山県: "300000",
  鳥取県: "310000",
  島根県: "320000",
  岡山県: "330000",
  広島県: "340000",
  山口県: "350000",
  徳島県: "360000",
  香川県: "370000",
  愛媛県: "380000",
  高知県: "390000",
  福岡県: "400000",
  佐賀県: "410000",
  長崎県: "420000",
  熊本県: "430000",
  大分県: "440000",
  宮崎県: "450000",
  鹿児島県: "460100",
  沖縄県: "471000",
};

exports.handler = async (event) => {
  const zip = (event.queryStringParameters || {}).zip || "";
  if (!/^[0-9]{7}$/.test(zip)) {
    return { statusCode: 400, body: JSON.stringify({ error: "郵便番号は7桁の数字で入力してください" }) };
  }

  try {
    const zipRes = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
    const zipJson = await zipRes.json();
    const result = (zipJson.results || [])[0];
    if (!result) {
      return { statusCode: 404, body: JSON.stringify({ error: "該当する住所が見つかりませんでした" }) };
    }

    const pref = result.address1;
    const office = OFFICE_BY_PREF[pref];
    if (!office) {
      return { statusCode: 404, body: JSON.stringify({ error: `${pref}の予報地域を特定できませんでした` }) };
    }

    // The forecast JSON itself lists the areas this office publishes for —
    // no separate area table to keep in sync.
    const fcRes = await fetch(`https://www.jma.go.jp/bosai/forecast/data/forecast/${office}.json`);
    const fc = await fcRes.json();
    const areas = ((((fc[0] || {}).timeSeries || [])[0] || {}).areas || []).map((a) => ({
      code: a.area.code,
      name: a.area.name,
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        pref,
        city: result.address2 + result.address3,
        office,
        areas,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
