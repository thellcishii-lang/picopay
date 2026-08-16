import React, { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  QrCode,
  Wallet,
  History,
  Bell,
  Settings,
  Store,
  Users,
  TrendingUp,
  Gift,
  ChevronRight,
  ChevronLeft,
  Plus,
  Sparkles,
  ShieldCheck,
} from "lucide-react";

// ---- Design tokens ----
const C = {
  ink: "#0F2E2B",       // near-black teal for text
  teal: "#0E6E5C",      // primary brand teal
  tealDeep: "#0A4F42",
  coral: "#FF7A59",     // ピコ accent
  coralSoft: "#FFE4DA",
  cream: "#FBF7F0",
  paper: "#FFFFFF",
  line: "#E4DFD3",
  mute: "#6B7A76",
};



// ピコのイラストは public に置いて URL で参照する(2026-08-07)。以前は
// data URI としてこのファイルに直接埋め込んでいたため、3枚で118KB、
// components.jsx 全体の4割を占めていた。店舗画面・お客様画面のどちらも
// これを毎回読み込んでおり、演出用の2枚(pointGet/bonusGet)に至っては
// 使う場面が来なくても運ばれていた。URL にすればブラウザがキャッシュし、
// 演出用は必要になった時だけ取りに行く。
const PICO = {
  logo: "/pico-logo.webp",
  pointGet: "/pico-pointGet.webp",
  bonusGet: "/pico-bonusGet.webp",
};

const mockCustomers = [
  { id: "0001", name: "田中 様", balance: 4200, lastVisit: "7/20", rank: "シルバー" },
  { id: "0002", name: "佐藤 様", balance: 12800, lastVisit: "7/22", rank: "ゴールド" },
  { id: "0003", name: "鈴木 様", balance: 600, lastVisit: "7/15", rank: "シルバー" },
  { id: "0004", name: "高橋 様", balance: 21000, lastVisit: "7/22", rank: "プラチナ" },
];

const RANK_META = {
  シルバー: { crown: "🥈", color: "#9AA5A1" },
  ゴールド: { crown: "🥇", color: "#C9A227" },
  プラチナ: { crown: "👑", color: "#8E7CC3" },
};

const RANKS = [
  { name: "シルバー", rate: 5, threshold: 0 },
  { name: "ゴールド", rate: 8, threshold: 50000 },
  { name: "プラチナ", rate: 10, threshold: 200000 },
];

// Recommended embed sizes for store branding uploads — kept in one place so
// the settings screen's guidance text and the actual header rendering agree.
const BRANDING_SIZES = {
  logoWidth: 180, // px — the horizontal logo fills this width, height fixed below
  logoHeight: 36, // px — matches the icon's height so the header doesn't jump
  iconSize: 200, // px — recommended square upload size for the icon (displayed smaller)
};

// ---- Initial (placeholder) brand images ----
// Stores start out with these so the app never looks unbranded on day one.
// They're plain SVG generated here rather than uploaded files, so they cost
// nothing to ship and scale cleanly at any size.
// Every point/bonus rate in the app is capped here. 20% is the 総付景品
// ceiling under 景品表示法; whether store-issued points count as 景品 at all
// is arguable, so capping is the safe side of an ambiguous line. Applied both
// on input and at payout time, so a value saved before the cap existed can
// never pay out more than 20% either.
export const MAX_RATE = 20;
export const clampRate = (v) => Math.min(MAX_RATE, Math.max(0, Number(v) || 0));

const svgUri = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

export const PICO_PLACEHOLDER = {
  logo: svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="36" viewBox="0 0 180 36">
      <rect width="180" height="36" rx="8" fill="#0E6E5C"/>
      <circle cx="24" cy="18" r="7" fill="#FF7A59"/>
      <text x="42" y="24" font-family="sans-serif" font-size="17" font-weight="bold" fill="#FFFFFF">PicoPay</text>
    </svg>`
  ),
  icon: svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <rect width="200" height="200" rx="44" fill="#0E6E5C"/>
      <circle cx="140" cy="62" r="18" fill="#FF7A59"/>
      <text x="100" y="132" text-anchor="middle" font-family="sans-serif" font-size="96" font-weight="bold" fill="#FFFFFF">P</text>
    </svg>`
  ),
};

// Brand images have three states, and they have to stay distinguishable:
//   undefined / null → never touched, so show the placeholder
//   ""               → the store deliberately deleted it, so show nothing
//                      (and warn, since e.g. the home-screen icon goes missing)
//   URL              → the store's own image (Firebase Storage の URL。
//                      2026-08-06 以前は data URI をそのまま保持していた)
// Deletion is stored as "" rather than null because writing null to Firebase
// removes the key entirely, which would read back as "never touched".
export function resolveBrandImage(value, placeholder) {
  if (value === "") return null;
  return value || placeholder;
}


function GachaSettings({ storeSettings, onSave }) {
  const [gachaEnabled, setGachaEnabled] = useState(storeSettings.gachaEnabled ?? true);
  const [normalRows, setNormalRows] = useState(
    storeSettings.gachaNormalRows || [
      { id: 1, rate: 2, weight: 50 },
      { id: 2, rate: 5, weight: 30 },
      { id: 3, rate: 8, weight: 15 },
      { id: 4, rate: 10, weight: 5 },
    ]
  );
  const [rainRows, setRainRows] = useState(
    storeSettings.gachaRainRows || [
      { id: 1, rate: 3, weight: 40 },
      { id: 2, rate: 6, weight: 40 },
      { id: 3, rate: 10, weight: 20 },
    ]
  );
  const [mode, setModeSet] = useState("normal");
  const [zeroMsg, setZeroMsg] = useState(storeSettings.gachaZeroMsg || "positive");
  const [freq, setFreq] = useState(storeSettings.gachaFreq || "daily");
  const [saved, setSaved] = useState(false);

  const rows = mode === "rain" ? rainRows : normalRows;
  const setRows = mode === "rain" ? setRainRows : setNormalRows;
  const totalWeight = rows.reduce((s, r) => s + Number(r.weight || 0), 0);

  const update = (id, key, value) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  };
  const addRow = () => {
    setRows((rs) => [...rs, { id: Date.now(), rate: 0, weight: 0 }]);
  };
  const removeRow = (id) => setRows((rs) => rs.filter((r) => r.id !== id));

  const save = async () => {
    await onSave({
      gachaEnabled,
      gachaNormalRows: normalRows.map((r) => ({ ...r, rate: clampRate(r.rate) })),
      gachaRainRows: rainRows.map((r) => ({ ...r, rate: clampRate(r.rate) })),
      gachaZeroMsg: zeroMsg,
      gachaFreq: freq,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={16} style={{ color: C.coral }} />
          <span className="text-sm font-bold" style={{ color: C.ink }}>入金ガチャ</span>
        </div>
        <button
          onClick={() => setGachaEnabled(!gachaEnabled)}
          className="relative w-11 h-6 rounded-full transition-colors shrink-0"
          style={{ background: gachaEnabled ? C.teal : C.line }}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
            style={{ transform: gachaEnabled ? "translateX(22px)" : "translateX(2px)" }}
          />
        </button>
      </div>
      <div className="text-[11px] mt-1" style={{ color: C.mute }}>
        {gachaEnabled
          ? "オフにすると、お客様画面からもガチャが消えます"
          : "オフ:お客様画面にガチャは表示されません"}
      </div>

      {gachaEnabled && (
        <>
          <div className="text-[11px] mt-3" style={{ color: C.mute }}>
            当選率(ボーナス%)ごとの出現ウェイトを自由に設定できます。ハズレを作りたい場合は0%の行を追加してください。
          </div>

          {/* Mode switch */}
          <div className="mt-3 flex rounded-full p-0.5 w-fit" style={{ background: C.cream }}>
            {[
              { key: "normal", label: "通常テーブル" },
              { key: "rain", label: "雨の日テーブル" },
            ].map((m) => (
              <button
                key={m.key}
                onClick={() => setModeSet(m.key)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold transition"
                style={mode === m.key ? { background: C.teal, color: "#fff" } : { color: C.mute }}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Table header */}
          <div className="mt-3 grid grid-cols-12 gap-2 text-[10px] font-semibold px-1" style={{ color: C.mute }}>
            <div className="col-span-4">ボーナス率</div>
            <div className="col-span-5">出現ウェイト</div>
            <div className="col-span-2">確率</div>
            <div className="col-span-1"></div>
          </div>

          <div className="mt-1 space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-4 flex items-center rounded-lg" style={{ background: C.cream }}>
                  <input
                    type="number"
                    value={r.rate}
                    onChange={(e) => update(r.id, "rate", clampRate(e.target.value))}
                    className="w-full bg-transparent px-2 py-2 text-sm font-semibold outline-none"
                    style={{ color: C.ink }}
                  />
                  <span className="pr-2 text-sm font-semibold" style={{ color: C.mute }}>%</span>
                </div>
                <div className="col-span-5 rounded-lg" style={{ background: C.cream }}>
                  <input
                    type="number"
                    value={r.weight}
                    onChange={(e) => update(r.id, "weight", e.target.value)}
                    className="w-full bg-transparent px-2 py-2 text-sm font-semibold outline-none"
                    style={{ color: C.ink }}
                  />
                </div>
                <div className="col-span-2 text-xs font-bold" style={{ color: C.teal }}>
                  {totalWeight > 0 ? `${Math.round((Number(r.weight) / totalWeight) * 100)}%` : "-"}
                </div>
                <button
                  className="col-span-1 text-xs"
                  style={{ color: C.mute }}
                  onClick={() => removeRow(r.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={addRow}
            className="mt-3 flex items-center gap-1 text-xs font-semibold"
            style={{ color: C.teal }}
          >
            <Plus size={13} /> 行を追加
          </button>

          {/* Live preview bar */}
          <div className="mt-4">
            <div className="text-[10px] font-semibold mb-1" style={{ color: C.mute }}>出現割合プレビュー</div>
            <div className="h-3 rounded-full overflow-hidden flex" style={{ background: C.cream }}>
              {rows.map((r, i) => (
                <div
                  key={r.id}
                  style={{
                    width: totalWeight > 0 ? `${(Number(r.weight) / totalWeight) * 100}%` : 0,
                    background: i % 2 === 0 ? C.teal : C.coral,
                  }}
                />
              ))}
            </div>
          </div>

          {/* 0% outcome messaging */}
          <div className="mt-4 rounded-xl p-3" style={{ background: C.cream }}>
            <div className="text-[11px] font-semibold" style={{ color: C.ink }}>0%(ハズレ)が出た時の演出</div>
            <div className="mt-2 flex gap-2">
              {[
                { key: "positive", label: "やったー!景品だよ!" },
                { key: "negative", label: "残高😭次回に期待してね!" },
              ].map((o) => (
                <button
                  key={o.key}
                  onClick={() => setZeroMsg(o.key)}
                  className="flex-1 rounded-lg py-2 text-[11px] font-semibold"
                  style={
                    zeroMsg === o.key
                      ? { background: C.teal, color: "#fff" }
                      : { background: "#fff", color: C.mute, border: `1px solid ${C.line}` }
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Charge frequency condition */}
          <div className="mt-3 rounded-xl p-3" style={{ background: C.cream }}>
            <div className="text-[11px] font-semibold" style={{ color: C.ink }}>ボーナス適用条件</div>
            <div className="mt-2 flex gap-2">
              {[
                { key: "daily", label: "1日1回まで" },
                { key: "triple", label: "1日3回まで" },
              ].map((o) => (
                <button
                  key={o.key}
                  onClick={() => setFreq(o.key)}
                  className="flex-1 rounded-lg py-2 text-[11px] font-semibold"
                  style={
                    freq === o.key
                      ? { background: C.teal, color: "#fff" }
                      : { background: "#fff", color: C.mute, border: `1px solid ${C.line}` }
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <button
        onClick={save}
        className="mt-4 w-full rounded-full py-2.5 text-sm font-bold"
        style={{ background: C.teal, color: "#fff" }}
      >
        {saved ? "✓ 保存しました" : gachaEnabled ? (mode === "rain" ? "雨の日テーブルを保存" : "通常テーブルを保存") : "保存"}
      </button>
    </div>
  );
}

// ---------------- DEPOSIT BONUS SETTINGS (plain, non-gacha, tiered by amount) ----------------
function DepositBonusSettings({ storeSettings, onSave }) {
  const [enabled, setEnabled] = useState(storeSettings.depositBonusEnabled ?? false);
  const [flatMode, setFlatMode] = useState(storeSettings.depositBonusFlatMode ?? true);
  const [flatRate, setFlatRate] = useState(storeSettings.depositBonusFlatRate ?? 5);
  const [tiers, setTiers] = useState(
    storeSettings.depositBonusTiers || [
      { upTo: 5000, rate: 3 },
      { upTo: 10000, rate: 5 },
      { upTo: null, rate: 8 }, // null upTo = 上限なし(それ以上)
    ]
  );
  const [saved, setSaved] = useState(false);

  const updateTier = (i, key, value) => {
    setTiers((ts) => ts.map((t, idx) => (idx === i ? { ...t, [key]: value } : t)));
  };

  const save = async () => {
    await onSave({
      depositBonusEnabled: enabled,
      depositBonusFlatMode: flatMode,
      depositBonusFlatRate: clampRate(flatRate),
      depositBonusTiers: tiers.map((t) => ({ ...t, rate: clampRate(t.rate) })),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold" style={{ color: C.ink }}>入金ボーナス(通常付与)</div>
        <button
          onClick={() => setEnabled(!enabled)}
          className="relative w-11 h-6 rounded-full transition-colors shrink-0"
          style={{ background: enabled ? C.teal : C.line }}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
            style={{ transform: enabled ? "translateX(22px)" : "translateX(2px)" }}
          />
        </button>
      </div>
      <div className="text-[11px] mt-1" style={{ color: C.mute }}>
        ガチャの抽選とは別に、チャージのたびに確実にポイントが付与される仕組みです
      </div>

      {enabled && (
        <>
          <label className="mt-3 flex items-center justify-between text-[12px] rounded-xl p-3" style={{ background: C.cream, color: C.ink }}>
            <span>全ての入金に一律の還元率をつける</span>
            <input type="checkbox" checked={flatMode} onChange={(e) => setFlatMode(e.target.checked)} />
          </label>

          {flatMode ? (
            <div className="mt-2 flex items-center rounded-lg" style={{ background: C.cream }}>
              <input
                type="number"
                value={flatRate}
                onChange={(e) => setFlatRate(clampRate(e.target.value))}
                className="w-full bg-transparent px-3 py-2 text-sm font-semibold outline-none"
                style={{ color: C.ink }}
              />
              <span className="pr-3 text-xs font-semibold" style={{ color: C.mute }}>% (全ての入金額に適用)</span>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {tiers.map((t, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-7 flex items-center rounded-lg" style={{ background: C.cream }}>
                    {t.upTo === null ? (
                      <span className="px-3 py-2 text-sm" style={{ color: C.mute }}>それ以上</span>
                    ) : (
                      <>
                        <input
                          type="number"
                          value={t.upTo}
                          onChange={(e) => updateTier(i, "upTo", Number(e.target.value))}
                          className="w-full bg-transparent px-3 py-2 text-sm font-semibold outline-none"
                          style={{ color: C.ink }}
                        />
                        <span className="pr-3 text-xs font-semibold" style={{ color: C.mute }}>円まで</span>
                      </>
                    )}
                  </div>
                  <div className="col-span-5 flex items-center rounded-lg" style={{ background: C.cream }}>
                    <input
                      type="number"
                      value={t.rate}
                      onChange={(e) => updateTier(i, "rate", clampRate(e.target.value))}
                      className="w-full bg-transparent px-2 py-2 text-sm font-semibold outline-none"
                      style={{ color: C.ink }}
                    />
                    <span className="pr-2 text-xs font-semibold" style={{ color: C.mute }}>%</span>
                  </div>
                </div>
              ))}
              <div className="text-[10px]" style={{ color: C.mute }}>
                ※チャージ額に応じて、該当する一番上の段階の還元率が適用されます
              </div>
            </div>
          )}
        </>
      )}

      <button
        onClick={save}
        className="mt-4 w-full rounded-full py-2.5 text-sm font-bold"
        style={{ background: C.teal, color: "#fff" }}
      >
        {saved ? "✓ 保存しました" : "保存"}
      </button>
    </div>
  );
}

// ---------------- POINT SETTINGS (purchase-based) ----------------
function PointSettings({ storeSettings, onSave }) {
  const [enabled, setEnabled] = useState(storeSettings.purchasePointEnabled ?? true);
  const [flatMode, setFlatMode] = useState(storeSettings.purchasePointFlatMode ?? true);
  const [flatRate, setFlatRate] = useState(storeSettings.purchasePointFlatRate ?? 5);
  const [tiers, setTiers] = useState(
    storeSettings.purchasePointTiers || [
      { upTo: 3000, rate: 3 },
      { upTo: 10000, rate: 5 },
      { upTo: null, rate: 8 }, // null upTo = それ以上
    ]
  );
  // "deposit" = 預かり金から払った分だけが対象 / "total" = お会計総額が対象。
  // 総額を対象にすると、ポイントで払った分にもポイントが付くので還元が
  // 雪だるま式に膨らむ。既定を預かり金側にしてあるのはそのため。
  const [pointBase, setPointBase] = useState(storeSettings.purchasePointBase || "deposit");
  const [saved, setSaved] = useState(false);

  const updateTier = (i, key, value) => {
    setTiers((ts) => ts.map((t, idx) => (idx === i ? { ...t, [key]: value } : t)));
  };

  const save = async () => {
    await onSave({
      purchasePointEnabled: enabled,
      purchasePointFlatMode: flatMode,
      purchasePointFlatRate: clampRate(flatRate),
      purchasePointTiers: tiers.map((t) => ({ ...t, rate: clampRate(t.rate) })),
      purchasePointBase: pointBase,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gift size={16} style={{ color: C.teal }} />
          <span className="text-sm font-bold" style={{ color: C.ink }}>購入ポイント(商品購入時)</span>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          className="relative w-11 h-6 rounded-full transition-colors shrink-0"
          style={{ background: enabled ? C.teal : C.line }}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
            style={{ transform: enabled ? "translateX(22px)" : "translateX(2px)" }}
          />
        </button>
      </div>
      <div className="text-[11px] mt-1" style={{ color: C.mute }}>
        チャージ時のボーナスとは別に、実際のお買い物・お会計時に付与するポイント還元率です
      </div>

      {enabled && (
        <>
          <label className="mt-3 flex items-center justify-between text-[12px] rounded-xl p-3" style={{ background: C.cream, color: C.ink }}>
            <span>全ての購入に一律の還元率をつける</span>
            <input type="checkbox" checked={flatMode} onChange={(e) => setFlatMode(e.target.checked)} />
          </label>

          {flatMode ? (
            <div className="mt-2 flex items-center gap-3">
              <div className="flex items-center rounded-lg flex-1" style={{ background: C.cream }}>
                <input
                  type="number"
                  value={flatRate}
                  onChange={(e) => setFlatRate(clampRate(e.target.value))}
                  className="w-full bg-transparent px-3 py-2 text-lg font-bold outline-none"
                  style={{ color: C.ink }}
                />
                <span className="pr-3 text-sm font-semibold" style={{ color: C.mute }}>%</span>
              </div>
              <div className="text-[11px]" style={{ color: C.mute }}>
                例:¥2,000のお買い物 → P{Math.round(2000 * (flatRate / 100))}
              </div>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {tiers.map((t, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-7 flex items-center rounded-lg" style={{ background: C.cream }}>
                    {t.upTo === null ? (
                      <span className="px-3 py-2 text-sm" style={{ color: C.mute }}>それ以上</span>
                    ) : (
                      <>
                        <input
                          type="number"
                          value={t.upTo}
                          onChange={(e) => updateTier(i, "upTo", Number(e.target.value))}
                          className="w-full bg-transparent px-3 py-2 text-sm font-semibold outline-none"
                          style={{ color: C.ink }}
                        />
                        <span className="pr-3 text-xs font-semibold" style={{ color: C.mute }}>円まで</span>
                      </>
                    )}
                  </div>
                  <div className="col-span-5 flex items-center rounded-lg" style={{ background: C.cream }}>
                    <input
                      type="number"
                      value={t.rate}
                      onChange={(e) => updateTier(i, "rate", clampRate(e.target.value))}
                      className="w-full bg-transparent px-2 py-2 text-sm font-semibold outline-none"
                      style={{ color: C.ink }}
                    />
                    <span className="pr-2 text-xs font-semibold" style={{ color: C.mute }}>%</span>
                  </div>
                </div>
              ))}
              <div className="text-[10px]" style={{ color: C.mute }}>
                ※購入金額に応じて、該当する一番上の段階の還元率が適用されます
              </div>
            </div>
          )}

          <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
            <div className="text-[11px] font-semibold" style={{ color: C.ink }}>ポイントを付ける対象</div>
            <div className="mt-2 space-y-2">
              {[
                {
                  key: "deposit",
                  label: "預かり金から払った分",
                  note: "ポイントで払った分にはポイントが付きません",
                },
                {
                  key: "total",
                  label: "お会計の総額",
                  note: "ポイントで払った分にもポイントが付きます",
                },
              ].map((o) => (
                <label
                  key={o.key}
                  className="flex items-start gap-2 rounded-xl p-3 cursor-pointer"
                  style={{
                    background: pointBase === o.key ? C.coralSoft : C.cream,
                    border: `1px solid ${pointBase === o.key ? C.coral : "transparent"}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={pointBase === o.key}
                    onChange={() => setPointBase(o.key)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-[12px] font-semibold" style={{ color: C.ink }}>{o.label}</span>
                    <span className="block text-[10px] mt-0.5" style={{ color: C.mute }}>{o.note}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}

      <button
        onClick={save}
        className="mt-3 w-full rounded-full py-2 text-sm font-bold"
        style={{ background: C.teal, color: "#fff" }}
      >
        {saved ? "✓ 保存しました" : "保存"}
      </button>
    </div>
  );
}

// ---------------- SYSTEM SAFETY SETTINGS (daily cap, unrelated to bonus tables) ----------------
// ---------------- ISSUER INFO (法定表示) ----------------
// 発行者名・使えるお店・有効期限・苦情相談窓口。資金決済法上、前払式支払手段
// 発行者(=導入店舗)がお客様に開示する義務がある4項目。運営(the合同会社)は
// この情報の中身に一切関与せず、店舗が自分で入力・管理する(2026年8月6日決定)。
function IssuerInfoSettings({ storeSettings, onSave }) {
  const [issuerName, setIssuerName] = useState(storeSettings.issuerName || "");
  const [usableStores, setUsableStores] = useState(storeSettings.usableStores || "");
  const [expiryPolicyText, setExpiryPolicyText] = useState(storeSettings.expiryPolicyText || "");
  const [complaintContact, setComplaintContact] = useState(storeSettings.complaintContact || "");
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await onSave({ issuerName, usableStores, expiryPolicyText, complaintContact });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const fields = [
    { label: "発行者名", value: issuerName, set: setIssuerName, placeholder: "例:株式会社◯◯(屋号:△△)" },
    { label: "ご利用いただけるお店", value: usableStores, set: setUsableStores, placeholder: "例:◯◯店(住所)" },
    { label: "有効期限の表記", value: expiryPolicyText, set: setExpiryPolicyText, placeholder: "例:最終ご利用日から1年間" },
    { label: "苦情・相談窓口", value: complaintContact, set: setComplaintContact, placeholder: "例:電話番号・メールアドレス" },
  ];

  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} style={{ color: C.teal }} />
        <span className="text-sm font-bold" style={{ color: C.ink }}>発行者情報</span>
      </div>
      <div className="text-[11px] mt-1" style={{ color: C.mute }}>
        資金決済法により、前払式支払手段の発行者(導入店舗)はお客様への情報開示が必要です。ここで入力した内容がお客様画面に表示されます。運営はこの内容には関与しません。
      </div>
      {fields.map((f) => (
        <div key={f.label} className="mt-2 rounded-xl p-3" style={{ background: C.cream }}>
          <div className="text-[11px] font-semibold" style={{ color: C.ink }}>{f.label}</div>
          <input
            value={f.value}
            onChange={(e) => f.set(e.target.value)}
            placeholder={f.placeholder}
            className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "#fff", color: C.ink }}
          />
        </div>
      ))}
      <button
        onClick={save}
        className="mt-3 w-full rounded-full py-2 text-sm font-bold"
        style={{ background: C.teal, color: "#fff" }}
      >
        {saved ? "✓ 保存しました" : "保存"}
      </button>
    </div>
  );
}

// ---------------- DEPOSIT EXPIRY (預かり金の失効設定) ----------------
// 2026-08-06決定:起算日は最終来店日(lastVisitAt、transact.jsがチャージ・
// お会計のたびに記録)。初期値オフ。オンの店舗のみdeposit-expiry.js(日次
// バッチ)の対象になる。「執行通知」は失効1ヶ月前からお客様画面に予告を
// 出し続けるかどうかの別スイッチ(オフにすると全顧客一律で予告が消える)。
function DepositExpirySettings({ storeSettings, onSave }) {
  const [enabled, setEnabled] = useState(storeSettings.depositExpiryEnabled ?? false);
  const [years, setYears] = useState(storeSettings.depositExpiryYears ?? 1);
  const [noticeEnabled, setNoticeEnabled] = useState(storeSettings.depositExpiryNoticeEnabled ?? false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await onSave({
      depositExpiryEnabled: enabled,
      depositExpiryYears: Number(years),
      depositExpiryNoticeEnabled: noticeEnabled,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} style={{ color: C.teal }} />
        <span className="text-sm font-bold" style={{ color: C.ink }}>預かり金の失効設定</span>
      </div>
      <div className="text-[11px] mt-1" style={{ color: C.mute }}>
        最終ご来店日(チャージ・お会計のいずれか)から一定期間ご来店が無いお客様の預かり残高を失効させます。ポイントの有効期限とは別枠です。
      </div>

      <label className="mt-3 flex items-center justify-between rounded-xl p-3" style={{ background: C.cream }}>
        <span className="text-[11px] font-semibold" style={{ color: C.ink }}>失効を有効にする</span>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      </label>

      {enabled && (
        <>
          <div className="mt-2 rounded-xl p-3" style={{ background: C.cream }}>
            <div className="text-[11px] font-semibold" style={{ color: C.ink }}>失効までの期間</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[1, 2, 3].map((y) => (
                <button
                  key={y}
                  onClick={() => setYears(y)}
                  className="rounded-lg py-2 text-sm font-semibold"
                  style={{
                    background: years === y ? C.teal : "#fff",
                    color: years === y ? "#fff" : C.mute,
                    border: `1px solid ${years === y ? C.teal : C.line}`,
                  }}
                >
                  {y}年
                </button>
              ))}
            </div>
          </div>

          <label className="mt-2 flex items-center justify-between rounded-xl p-3" style={{ background: C.cream }}>
            <div>
              <div className="text-[11px] font-semibold" style={{ color: C.ink }}>執行通知</div>
              <div className="text-[10px] mt-0.5" style={{ color: C.mute }}>
                失効の1ヶ月前から、お客様画面に予告を表示し続けます(ご来店で消えます)
              </div>
            </div>
            <input type="checkbox" checked={noticeEnabled} onChange={(e) => setNoticeEnabled(e.target.checked)} />
          </label>
        </>
      )}

      <button
        onClick={save}
        className="mt-3 w-full rounded-full py-2 text-sm font-bold"
        style={{ background: C.teal, color: "#fff" }}
      >
        {saved ? "✓ 保存しました" : "保存"}
      </button>
    </div>
  );
}

function SystemSafetySettings({ storeSettings, onSave }) {
  const [dailyCap, setDailyCap] = useState(storeSettings.dailyChargeCap ?? 100000);
  // Without a per-day limit, a customer can charge → spend → charge again and
  // collect the bonus every time, so the store's cost has no ceiling. Both
  // default to once a day.
  const [depositLimit, setDepositLimit] = useState(storeSettings.depositBonusDailyLimit ?? 1);
  const [gachaLimit, setGachaLimit] = useState(storeSettings.gachaDailyLimit ?? 1);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await onSave({
      dailyChargeCap: Number(dailyCap),
      depositBonusDailyLimit: Math.max(1, Number(depositLimit) || 1),
      gachaDailyLimit: Math.max(1, Number(gachaLimit) || 1),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} style={{ color: C.teal }} />
        <span className="text-sm font-bold" style={{ color: C.ink }}>安全設定</span>
      </div>
      <div className="text-[11px] mt-1" style={{ color: C.mute }}>
        ボーナス率の設定とは関係なく、誤操作や不正利用を防ぐためのシステム全体の上限です。
      </div>
      <div className="mt-3 rounded-xl p-3" style={{ background: C.cream }}>
        <div className="text-[11px] font-semibold" style={{ color: C.ink }}>1人1日あたりの入金上限額</div>
        <div className="mt-1 flex items-center rounded-lg" style={{ background: "#fff" }}>
          <span className="pl-2 text-sm font-semibold" style={{ color: C.mute }}>¥</span>
          <input
            type="number"
            value={dailyCap}
            onChange={(e) => setDailyCap(e.target.value)}
            className="w-full bg-transparent px-2 py-2 text-sm font-semibold outline-none"
            style={{ color: C.ink }}
          />
        </div>
        <div className="text-[10px] mt-1" style={{ color: C.mute }}>
          これを超えるチャージは本人確認が必要になります(本人確認の閾値設定と連動)
        </div>
      </div>

      <div className="mt-2 rounded-xl p-3" style={{ background: C.cream }}>
        <div className="text-[11px] font-semibold" style={{ color: C.ink }}>1人1日あたりのボーナス回数</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[
            { label: "入金ボーナス", value: depositLimit, set: setDepositLimit },
            { label: "入金ガチャ", value: gachaLimit, set: setGachaLimit },
          ].map((f) => (
            <div key={f.label}>
              <div className="text-[10px]" style={{ color: C.mute }}>{f.label}</div>
              <div className="mt-1 flex items-center rounded-lg" style={{ background: "#fff" }}>
                <input
                  type="number"
                  min={1}
                  value={f.value}
                  onChange={(e) => f.set(e.target.value)}
                  className="w-full bg-transparent px-2 py-2 text-sm font-semibold outline-none"
                  style={{ color: C.ink }}
                />
                <span className="pr-2 text-xs font-semibold" style={{ color: C.mute }}>回</span>
              </div>
            </div>
          ))}
        </div>
        <div className="text-[10px] mt-1" style={{ color: C.mute }}>
          ※日付は深夜0時で切り替わります。雨の日ボーナスは入金ボーナスと同じ枠を使うため、雨の日ボーナスを受け取ったその日は入金ボーナスが付きません。購入ポイントは回数制限の対象外です
        </div>
      </div>
      <button
        onClick={save}
        className="mt-3 w-full rounded-full py-2 text-sm font-bold"
        style={{ background: C.teal, color: "#fff" }}
      >
        {saved ? "✓ 保存しました" : "保存"}
      </button>
    </div>
  );
}

// ---------------- WEATHER-LINKED GUERRILLA CAMPAIGN SETTINGS ----------------
function WeatherCampaignSettings({ weatherEnabled, setWeatherEnabled, storeSettings, onSave, onLookupArea }) {
  const [zip, setZip] = useState(storeSettings.weatherZip || "");
  const [areaCode, setAreaCode] = useState(storeSettings.weatherAreaCode || "");
  const [areaName, setAreaName] = useState(storeSettings.weatherArea || "");
  // The publishing office, saved alongside the area. It can't be derived from
  // the area code reliably — 北海道, 鹿児島, 沖縄 have several offices and their
  // codes don't simply zero out — so it's stored rather than recomputed.
  const [office, setOffice] = useState(storeSettings.weatherOffice || "");
  const [areaChoices, setAreaChoices] = useState([]);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState(null);
  const [rainThreshold, setRainThreshold] = useState(storeSettings.weatherRainThreshold ?? 80);
  const [autoMode, setAutoMode] = useState(storeSettings.weatherAutoMode || "confirm"); // "confirm" | "auto"
  const [sendHour, setSendHour] = useState(storeSettings.weatherSendHour ?? 10);
  const [rate, setRate] = useState(storeSettings.weatherRate ?? 10);
  const [cap, setCap] = useState(storeSettings.weatherCap ?? 10000);
  const [saved, setSaved] = useState(false);

  // Resolving the postal code happens once, here — not every morning. The
  // forecast job only ever needs the area code that comes out of it, so an
  // outage at the postal-lookup service can't stop the campaign running.
  const lookupArea = async () => {
    setLooking(true);
    setLookupError(null);
    try {
      const result = await onLookupArea(zip.replace(/[^0-9]/g, ""));
      setAreaChoices(result.areas || []);
      setOffice(result.office || "");
      const first = (result.areas || [])[0];
      if (first) {
        setAreaCode(first.code);
        setAreaName(`${result.pref}${first.name}`);
      } else {
        setLookupError("この郵便番号から地域を特定できませんでした");
      }
    } catch (e) {
      setLookupError(e.message || "地域の判定に失敗しました");
    } finally {
      setLooking(false);
    }
  };

  const save = async () => {
    await onSave({
      weatherZip: zip,
      weatherOffice: office,
      weatherAreaCode: areaCode,
      weatherArea: areaName,
      weatherRainThreshold: Number(rainThreshold),
      weatherAutoMode: autoMode,
      weatherSendHour: Number(sendHour),
      weatherRate: clampRate(rate),
      weatherCap: Number(cap),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={16} style={{ color: C.coral }} />
          <span className="text-sm font-bold" style={{ color: C.ink }}>天気連動ゲリラボーナス</span>
        </div>
        <button
          onClick={() => setWeatherEnabled && setWeatherEnabled(!weatherEnabled)}
          className="relative w-11 h-6 rounded-full transition-colors shrink-0"
          style={{ background: weatherEnabled ? C.teal : C.line }}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
            style={{ transform: weatherEnabled ? "translateX(22px)" : "translateX(2px)" }}
          />
        </button>
      </div>
      <div className="text-[11px] mt-1" style={{ color: C.mute }}>
        天気予報と連動して、雨の日などにゲリラボーナスを自動で案内します。
      </div>

      {weatherEnabled && (
        <>
          <div className="mt-3 space-y-2">
            <div>
              <div className="text-[11px] font-semibold" style={{ color: C.ink }}>郵便番号(天気予報の取得地点)</div>
              <div className="mt-1 flex gap-2">
                <input
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  placeholder="例: 1231234"
                  inputMode="numeric"
                  className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                  style={{ background: C.cream, color: C.ink }}
                />
                <button
                  onClick={lookupArea}
                  disabled={looking}
                  className="rounded-lg px-4 text-[11px] font-semibold"
                  style={{ background: C.teal, color: "#fff", opacity: looking ? 0.6 : 1 }}
                >
                  {looking ? "判定中…" : "地域を判定"}
                </button>
              </div>
              {lookupError && (
                <div className="mt-1 text-[10px] font-semibold" style={{ color: C.coral }}>{lookupError}</div>
              )}
              {areaName && (
                <div className="mt-1 text-[11px]" style={{ color: C.mute }}>
                  予報の地域:<span style={{ color: C.ink, fontWeight: 700 }}>{areaName}</span>
                </div>
              )}
              {areaChoices.length > 1 && (
                <select
                  value={areaCode}
                  onChange={(e) => {
                    const picked = areaChoices.find((a) => a.code === e.target.value);
                    setAreaCode(e.target.value);
                    if (picked) setAreaName(picked.name);
                  }}
                  className="mt-1 w-full rounded-lg px-2 py-2 text-[11px] outline-none"
                  style={{ background: C.cream, color: C.ink }}
                >
                  {areaChoices.map((a) => (
                    <option key={a.code} value={a.code}>{a.name}</option>
                  ))}
                </select>
              )}
              <div className="text-[10px] mt-1" style={{ color: C.mute }}>
                気象庁の予報は市区町村単位ではなく県内の区分単位です。違う区分が選ばれた場合は選び直してください
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold" style={{ color: C.ink }}>発動条件:降水確率</div>
              <div className="mt-1 flex items-center rounded-lg" style={{ background: C.cream }}>
                <input
                  type="number"
                  value={rainThreshold}
                  onChange={(e) => setRainThreshold(e.target.value)}
                  className="w-full bg-transparent px-3 py-2 text-sm font-semibold outline-none"
                  style={{ color: C.ink }}
                />
                <span className="pr-3 text-xs font-semibold" style={{ color: C.mute }}>%以上で発動</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[11px] font-semibold" style={{ color: C.ink }}>ボーナス率</div>
                <div className="mt-1 flex items-center rounded-lg" style={{ background: C.cream }}>
                  <input
                    type="number"
                    value={rate}
                    onChange={(e) => setRate(clampRate(e.target.value))}
                    className="w-full bg-transparent px-3 py-2 text-sm font-semibold outline-none"
                    style={{ color: C.ink }}
                  />
                  <span className="pr-2 text-xs font-semibold" style={{ color: C.mute }}>%</span>
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold" style={{ color: C.ink }}>適用上限</div>
                <div className="mt-1 flex items-center rounded-lg" style={{ background: C.cream }}>
                  <span className="pl-3 text-xs font-semibold" style={{ color: C.mute }}>¥</span>
                  <input
                    type="number"
                    value={cap}
                    onChange={(e) => setCap(e.target.value)}
                    className="w-full bg-transparent px-2 py-2 text-sm font-semibold outline-none"
                    style={{ color: C.ink }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 text-[11px] font-semibold" style={{ color: C.ink }}>配信方法</div>
          <div className="mt-1 flex gap-2">
            {[
              { key: "confirm", label: "条件を満たしたら確認を出す(手動配信)" },
              { key: "auto", label: "条件を満たしたら自動配信" },
            ].map((o) => (
              <button
                key={o.key}
                onClick={() => setAutoMode(o.key)}
                className="flex-1 rounded-lg py-2 text-[10px] font-semibold"
                style={
                  autoMode === o.key
                    ? { background: C.teal, color: "#fff" }
                    : { background: C.cream, color: C.mute }
                }
              >
                {o.label}
              </button>
            ))}
          </div>

          {autoMode === "auto" && (
            <div className="mt-2">
              <div className="text-[11px] font-semibold" style={{ color: C.ink }}>自動配信する時刻</div>
              <select
                value={sendHour}
                onChange={(e) => setSendHour(e.target.value)}
                className="mt-1 w-full rounded-lg px-2 py-2 text-sm outline-none"
                style={{ background: C.cream, color: C.ink }}
              >
                {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => (
                  <option key={h} value={h}>{h}時</option>
                ))}
              </select>
              <div className="text-[10px] mt-1" style={{ color: C.mute }}>
                この時刻の降水確率が条件を満たしていれば、その場で発動して一斉配信します
              </div>
            </div>
          )}

          <div className="mt-3 rounded-xl p-3" style={{ background: C.coralSoft }}>
            <div className="text-[11px] font-semibold" style={{ color: C.coral }}>プレビュー</div>
            <div className="text-[11px] mt-1" style={{ color: C.ink }}>
              {areaName || "(郵便番号を判定してください)"}の降水確率が{rainThreshold}%以上の日、
              {autoMode === "auto" ? `${sendHour}時に自動で` : "配信確認を出して"}
              「今日は雨予報 ☔ ¥{Number(cap).toLocaleString()}までチャージで{rate}%ボーナス」を配信
            </div>
          </div>

          <button
            onClick={save}
            className="mt-4 w-full rounded-full py-2.5 text-sm font-bold"
            style={{ background: C.teal, color: "#fff" }}
          >
            {saved ? "✓ 保存しました" : "保存"}
          </button>
        </>
      )}
    </div>
  );
}
// ---------------- RANK SETTINGS (Silver/Gold/Platinum) ----------------
function RankSettings({ rankingEnabled, setRankingEnabled, storeSettings, onSave }) {
  const [showTable, setShowTable] = useState(!!storeSettings.rankTiers);
  const [decideMode, setDecideMode] = useState(storeSettings.rankDecideMode || "manual"); // "manual" | "total" | "period"
  const [useVisitCount, setUseVisitCount] = useState(storeSettings.rankUseVisitCount || false);
  const [evalMethod, setEvalMethod] = useState(storeSettings.rankEvalMethod || "combined"); // "combined" | "amountOnly" | "visitOnly"
  const [ranks, setRanks] = useState(
    storeSettings.rankTiers || [
      { name: "シルバー", rate: 3, threshold: 0, visitThreshold: 0 },
      { name: "ゴールド", rate: 5, threshold: 50000, visitThreshold: 2 },
      { name: "プラチナ", rate: 8, threshold: 200000, visitThreshold: 4 },
    ]
  );
  const [saved, setSaved] = useState(false);

  const updateRank = (i, key, value) => {
    setRanks((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  };

  const autoOn = decideMode !== "manual";

  const save = async () => {
    await onSave({
      rankTiers: ranks.map((r) => ({ ...r, rate: clampRate(r.rate) })),
      rankDecideMode: decideMode,
      rankUseVisitCount: useVisitCount,
      rankEvalMethod: evalMethod,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={16} style={{ color: C.coral }} />
          <span className="text-sm font-bold" style={{ color: C.ink }}>会員ランク(シルバー/ゴールド/プラチナ)</span>
        </div>
        <button
          onClick={() => setRankingEnabled && setRankingEnabled(!rankingEnabled)}
          className="relative w-11 h-6 rounded-full transition-colors shrink-0"
          style={{ background: rankingEnabled ? C.teal : C.line }}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
            style={{ transform: rankingEnabled ? "translateX(22px)" : "translateX(2px)" }}
          />
        </button>
      </div>
      <div className="text-[11px] mt-1" style={{ color: C.mute }}>
        {rankingEnabled ? "オン:お客様画面にもランク表示されます" : "オフ:お客様画面にはランク表示されません"}
      </div>

      {rankingEnabled && !showTable && (
        <button
          onClick={() => setShowTable(true)}
          className="mt-3 text-xs font-semibold flex items-center gap-1"
          style={{ color: C.teal }}
        >
          <Plus size={13} /> ランキングテーブル追加
        </button>
      )}

      {rankingEnabled && showTable && (
        <>
          <div className="text-[11px] mt-1" style={{ color: C.mute }}>
            ランクごとにポイント還元率を変えられます。
          </div>

          {/* Rank table */}
          <div className="mt-3 space-y-2">
            {ranks.map((r, i) => (
              <div key={r.name} className="rounded-xl p-2" style={{ background: C.cream }}>
                <div className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-4 text-xs font-bold" style={{ color: C.ink }}>{r.name}</div>
                  <div className="col-span-8 flex items-center rounded-lg" style={{ background: "#fff" }}>
                    <input
                      type="number"
                      value={r.rate}
                      onChange={(e) => updateRank(i, "rate", clampRate(e.target.value))}
                      className="w-full bg-transparent px-2 py-1.5 text-sm font-semibold outline-none"
                      style={{ color: C.ink }}
                    />
                    <span className="pr-2 text-xs font-semibold" style={{ color: C.mute }}>%還元</span>
                  </div>
                </div>

                {autoOn && evalMethod !== "visitOnly" && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-[10px] w-20 shrink-0" style={{ color: C.mute }}>累計売上</span>
                    <div className="flex items-center rounded-lg flex-1" style={{ background: "#fff" }}>
                      <span className="pl-2 text-[11px]" style={{ color: C.mute }}>¥</span>
                      <input
                        type="number"
                        value={r.threshold}
                        onChange={(e) => updateRank(i, "threshold", e.target.value)}
                        className="w-full bg-transparent px-2 py-1.5 text-sm font-semibold outline-none"
                        style={{ color: C.ink }}
                      />
                    </div>
                  </div>
                )}

                {autoOn && useVisitCount && evalMethod !== "amountOnly" && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-[10px] w-20 shrink-0" style={{ color: C.mute }}>月間来店回数</span>
                    <div className="flex items-center rounded-lg flex-1" style={{ background: "#fff" }}>
                      <input
                        type="number"
                        value={r.visitThreshold}
                        onChange={(e) => updateRank(i, "visitThreshold", e.target.value)}
                        className="w-full bg-transparent px-2 py-1.5 text-sm font-semibold outline-none"
                        style={{ color: C.ink }}
                      />
                      <span className="pr-2 text-[11px]" style={{ color: C.mute }}>回/月</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Decision mode */}
          <div className="mt-4 text-[11px] font-semibold" style={{ color: C.ink }}>ランクの決め方</div>
          <div className="mt-1 flex gap-2">
            {[
              { key: "manual", label: "店側が個別に決める" },
              { key: "total", label: "累計売上で自動判定" },
              { key: "period", label: "期間売上でアップダウン" },
            ].map((o) => (
              <button
                key={o.key}
                onClick={() => setDecideMode(o.key)}
                className="flex-1 rounded-lg py-2 text-[10px] font-semibold"
                style={
                  decideMode === o.key
                    ? { background: C.teal, color: "#fff" }
                    : { background: C.cream, color: C.mute }
                }
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Visit count criterion — only meaningful when auto */}
          <label
            className="mt-3 flex items-center justify-between text-[12px] rounded-xl p-3"
            style={{ background: autoOn ? C.cream : C.line, color: autoOn ? C.ink : C.mute, opacity: autoOn ? 1 : 0.5 }}
          >
            <span>来店回数も判定基準に含める(売上に貢献しなくても、よく来る人を評価)</span>
            <input
              type="checkbox"
              disabled={!autoOn}
              checked={useVisitCount}
              onChange={(e) => setUseVisitCount(e.target.checked)}
            />
          </label>

          {/* Evaluation method — only meaningful when both auto + visit count are on */}
          {autoOn && useVisitCount && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold" style={{ color: C.ink }}>評価方法</div>
              <div className="mt-1 flex gap-2">
                {[
                  { key: "combined", label: "総合評価" },
                  { key: "amountOnly", label: "金額だけ" },
                  { key: "visitOnly", label: "来店だけ" },
                ].map((o) => (
                  <button
                    key={o.key}
                    onClick={() => setEvalMethod(o.key)}
                    className="flex-1 rounded-lg py-2 text-[10px] font-semibold"
                    style={
                      evalMethod === o.key
                        ? { background: C.teal, color: "#fff" }
                        : { background: C.cream, color: C.mute }
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="text-[10px] mt-1" style={{ color: C.mute }}>
                総合評価:売上・来店のどちらか達成でランクアップ / 金額だけ:売上のみで判定 / 来店だけ:来店回数のみで判定
              </div>
            </div>
          )}

          <button
            onClick={save}
            className="mt-4 w-full rounded-full py-2.5 text-sm font-bold"
            style={{ background: C.teal, color: "#fff" }}
          >
            {saved ? "✓ 保存しました" : "会員ランク設定を保存"}
          </button>
        </>
      )}
    </div>
  );
}

// ---------------- STORE CHARGE / PURCHASE SCREEN ----------------
function ChargeScreen({ onCharge, onDeduct }) {
  const [screenMode, setScreenMode] = useState("charge"); // "charge" | "purchase"
  const [amount, setAmount] = useState(10000);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [done, setDone] = useState(false);
  const [scannedName, setScannedName] = useState(null);
  const [posConnected, setPosConnected] = useState(true);
  const posMockAmount = 2480;
  const scannerRef = React.useRef(null);
  const scannerDivId = "picopay-qr-reader";
  const ROTATE_MS = 30000;

  const reset = () => {
    setScanning(false);
    setScanError(null);
    setDone(false);
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
      scannerRef.current = null;
    }
  };

  const switchMode = (m) => {
    setScreenMode(m);
    reset();
    if (m === "purchase" && posConnected) setAmount(posMockAmount);
    if (m === "charge") setAmount(10000);
  };

  const complete = async (customerId) => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
      scannerRef.current = null;
    }
    setScanning(true);
    try {
      if (screenMode === "charge") await onCharge(Number(amount), customerId);
      else await onDeduct(Number(amount), customerId);
      setScannedName(customerId);
      setScanning(false);
      setDone(true);
    } catch (e) {
      setScanning(false);
      setScanError(e?.message || "処理に失敗しました");
    }
  };

  const handleDecodedText = (text) => {
    const parts = text.split(":");
    if (parts.length !== 3 || parts[0] !== "PICOPAY") {
      setScanError("PicoPayのQRコードではありません");
      return;
    }
    const [, scannedId, scannedBucketStr] = parts;
    const scannedBucket = Number(scannedBucketStr);
    const currentBucket = Math.floor(Date.now() / ROTATE_MS);

    // Allow the current window and the one just before it, so a scan right
    // as the code rotates doesn't fail unnecessarily.
    if (Math.abs(currentBucket - scannedBucket) > 1) {
      setScanError("QRコードの有効期限が切れています。もう一度お客様の画面を表示してもらってください");
      return;
    }
    complete(scannedId);
  };

  const startScan = async () => {
    setScanError(null);
    setScanning(true);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(scannerDivId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 220 },
        (decodedText) => {
          scanner.stop().catch(() => {});
          scannerRef.current = null;
          handleDecodedText(decodedText);
        },
        () => {} // ignore per-frame "not found" errors
      );
    } catch (e) {
      setScanError("カメラを起動できませんでした。ブラウザのカメラ権限を確認してください");
      setScanning(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
      <div className="flex rounded-full p-0.5 w-fit" style={{ background: C.cream }}>
        {[
          { key: "charge", label: "チャージ" },
          { key: "purchase", label: "商品決済" },
        ].map((m) => (
          <button
            key={m.key}
            onClick={() => switchMode(m.key)}
            className="px-4 py-1.5 rounded-full text-xs font-semibold transition"
            style={screenMode === m.key ? { background: C.teal, color: "#fff" } : { color: C.mute }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <QrCode size={16} style={{ color: C.teal }} />
        <span className="text-sm font-bold" style={{ color: C.ink }}>
          {screenMode === "charge" ? "チャージ受付" : "お会計(残高から引き落とし)"}
        </span>
      </div>

      <div className="text-[11px] mt-1" style={{ color: C.mute }}>
        {screenMode === "charge"
          ? "金額を入力してから、お客様の画面のQRコードをカメラで読み取ります。同時に、お客様側・この管理画面側の両方に反映されます。"
          : "POS連携済みの店舗は会計金額が自動入力されます。未連携の場合は手動で金額を入力してください。"}
      </div>

      {screenMode === "purchase" && (
        <>
          <label className="mt-2 flex items-center gap-2 text-[11px]" style={{ color: C.mute }}>
            <input
              type="checkbox"
              checked={posConnected}
              onChange={(e) => {
                setPosConnected(e.target.checked);
                if (e.target.checked) setAmount(posMockAmount);
                reset();
              }}
            />
            POS連携済み(スマレジ)
          </label>
          <div className="text-[10px] mt-0.5" style={{ color: C.mute }}>
            連携しなくても手入力でそのままご利用いただけます
          </div>
        </>
      )}

      <div className="mt-3 flex items-center rounded-lg" style={{ background: C.cream }}>
        <span className="pl-3 text-lg font-semibold" style={{ color: C.mute }}>¥</span>
        <input
          type="number"
          value={amount}
          disabled={screenMode === "purchase" && posConnected}
          onChange={(e) => { setAmount(e.target.value); reset(); }}
          className="w-full bg-transparent px-2 py-3 text-xl font-bold outline-none disabled:opacity-70"
          style={{ color: C.ink }}
        />
        {screenMode === "purchase" && posConnected && (
          <span className="pr-3 text-[10px] font-semibold" style={{ color: C.teal }}>POSより自動入力</span>
        )}
      </div>

      {screenMode === "charge" && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[3000, 5000, 10000].map((v) => (
            <button
              key={v}
              onClick={() => { setAmount(v); reset(); }}
              className="rounded-lg py-2 text-sm font-semibold"
              style={{ background: C.cream, color: C.ink }}
            >
              ¥{v.toLocaleString()}
            </button>
          ))}
        </div>
      )}

      {scanning && (
        <div className="mt-3 rounded-xl overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
          <div id={scannerDivId} style={{ width: "100%" }} />
        </div>
      )}

      {scanError && (
        <div className="mt-3 rounded-xl p-3 text-[12px] font-semibold" style={{ background: C.coralSoft, color: C.coral }}>
          {scanError}
        </div>
      )}

      {!done ? (
        <button
          onClick={scanning ? undefined : startScan}
          className="mt-4 w-full rounded-full py-3 text-sm font-bold"
          style={{ background: screenMode === "charge" ? C.teal : C.ink, color: "#fff" }}
        >
          {scanning ? "カメラでお客様のQRコードを映してください" : "カメラでQRコードを読み取る"}
        </button>
      ) : (
        <div className="mt-4 rounded-xl p-3 text-center" style={{ background: C.coralSoft }}>
          <div className="text-sm font-bold" style={{ color: C.coral }}>
            {screenMode === "charge" ? "¥" : "-¥"}
            {Number(amount).toLocaleString()} {screenMode === "charge" ? "反映しました" : "お会計完了"}
          </div>
          <div className="text-[11px] mt-1" style={{ color: C.mute }}>
            {scannedName ? `お客様ID: ${scannedName}・` : ""}お客様の画面にも即時反映されています
          </div>
          <button
            onClick={reset}
            className="mt-3 text-xs font-semibold"
            style={{ color: C.teal }}
          >
            続ける
          </button>
        </div>
      )}
    </div>
  );
}


// ---------------- CUSTOMER REGISTRATION ----------------
function CustomerRegistration({ onDone, onRegister, existingCustomers }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [referredBy, setReferredBy] = useState("");
  const [notify, setNotify] = useState({ email: true });
  const [issued, setIssued] = useState(null);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState(null);

  const canSubmit = name.trim().length > 0 && phone.trim().length > 0;

  // Normalize common Japanese phone input ("090 1234 5678", "090-1234-5678")
  // into E.164 format ("+819012345678") since that's what Firebase phone
  // auth requires.
  const normalizePhone = (raw) => {
    const digits = raw.replace(/[^\d+]/g, "");
    if (digits.startsWith("+")) return digits;
    if (digits.startsWith("0")) return "+81" + digits.slice(1);
    return digits;
  };

  const issue = async () => {
    setIssueError(null);
    const normalizedPhone = normalizePhone(phone);
    const trimmedEmail = email.trim();
    const phoneTaken = (existingCustomers || []).some((c) => c.phone === normalizedPhone);
    const emailTaken = trimmedEmail && (existingCustomers || []).some((c) => c.email === trimmedEmail);
    if (phoneTaken) {
      setIssueError("この電話番号は既に登録されています");
      return;
    }
    if (emailTaken) {
      setIssueError("このメールアドレスは既に登録されています");
      return;
    }
    setIssuing(true);
    try {
      const customerId = await onRegister({
        name,
        phone: normalizedPhone,
        email,
        referredBy: referredBy.trim() || null,
      });
      setIssued(customerId);
    } catch (e) {
      setIssueError(e?.message || "登録に失敗しました。もう一度お試しください");
    } finally {
      setIssuing(false);
    }
  };


  if (issued) {
    const setupUrl = `${window.location.origin}/customer?id=${issued}`;
    return (
      <div className="mt-3 rounded-2xl p-4 text-center" style={{ background: C.coralSoft }}>
        <div className="text-sm font-bold" style={{ color: C.coral }}>登録完了しました</div>
        <div className="mt-2 text-xs" style={{ color: C.ink }}>{name} 様・お客様ID: {issued}</div>
        <div className="text-[11px] mt-1" style={{ color: C.mute }}>
          お客様のスマホでこのQRを読み取ると、PicoPayの画面がそのまま開きます(お客様ご自身での入力は不要です)
        </div>
        <div className="mt-3 rounded-lg bg-white p-3 inline-block">
          <QRCodeSVG value={setupUrl} size={80} level="M" />
        </div>
        <div className="text-[10px] mt-1" style={{ color: C.mute }}>
          このQRはお客様の初回設定用です(決済用QRとは別物です)
        </div>

        <button
          onClick={onDone}
          className="mt-3 w-full rounded-full py-2 text-sm font-bold"
          style={{ background: C.teal, color: "#fff" }}
        >
          完了
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
      <div className="flex items-center gap-2">
        <Users size={16} style={{ color: C.teal }} />
        <span className="text-sm font-bold" style={{ color: C.ink }}>お客様登録</span>
      </div>

      <div className="mt-3 space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="お名前"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.cream, color: C.ink }}
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="電話番号(必須・例: +819012345678)"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.cream, color: C.ink }}
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="メールアドレス(通知用・任意)"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.cream, color: C.ink }}
        />
        <input
          value={referredBy}
          onChange={(e) => setReferredBy(e.target.value)}
          placeholder="紹介者のお客様ID(任意)"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.cream, color: C.ink }}
        />
      </div>

      <div className="mt-2 text-[11px] font-semibold" style={{ color: C.ink }}>通知設定</div>
      <div className="mt-1 flex gap-3 text-[12px]" style={{ color: C.ink }}>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={notify.email}
            onChange={(e) => setNotify((n) => ({ ...n, email: e.target.checked }))}
          />
          メール通知
        </label>
      </div>

      <button
        onClick={issue}
        disabled={!canSubmit || issuing}
        className="mt-4 w-full rounded-full py-2.5 text-sm font-bold"
        style={{ background: canSubmit ? C.teal : C.line, color: canSubmit ? "#fff" : C.mute, opacity: issuing ? 0.6 : 1 }}
      >
        {issuing ? "登録中…" : "登録してお客様IDを発行"}
      </button>
      {issueError && (
        <div className="mt-2 text-[11px] font-semibold" style={{ color: C.coral }}>
          {issueError}
        </div>
      )}
    </div>
  );
}

// ---------------- CUSTOMER DATA EXPORT ----------------
function downloadCsv(filename, header, rows) {
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  // Prepend a BOM so Excel opens Japanese text correctly.
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCustomersCsv(customers) {
  downloadCsv(
    `picopay-customers-${new Date().toISOString().slice(0, 10)}.csv`,
    ["お客様ID", "お名前", "残高合計"],
    customers.map((c) => [c.id, c.name, c.balance])
  );
}

function CustomerDetailPanel({ customerId, onFetch, onSetStatus, onDeletePermanently, onDeleted, onReissue, permissions = {} }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showReissue, setShowReissue] = useState(false);
  const [idPhotoDataUrl, setIdPhotoDataUrl] = useState(null);
  const [newPhone, setNewPhone] = useState("");
  const [reissueUrl, setReissueUrl] = useState(null);
  const [reissueError, setReissueError] = useState(null);

  const load = () => {
    setLoading(true);
    onFetch(customerId).then((data) => {
      setDetail(data);
      setLoading(false);
    });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    onFetch(customerId).then((data) => {
      if (!cancelled) {
        setDetail(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, onFetch]);

  const printPanel = () => window.print();

  const changeStatus = async (status) => {
    setBusy(true);
    try {
      await onSetStatus(customerId, status);
      load();
    } finally {
      setBusy(false);
    }
  };

  // Downscale the captured ID photo before storing it, so it doesn't bloat
  // the database — a phone camera photo can be several MB, but a few
  // hundred KB is plenty to visually confirm an ID.
  const handlePhotoSelected = (file) => {
    if (!file) return;
    setReissueError(null);
    const reader = new FileReader();
    reader.onerror = () => setReissueError("写真の読み込みに失敗しました。もう一度お試しください");
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => setReissueError("写真の処理に失敗しました。もう一度お試しください");
      img.onload = () => {
        const maxW = 800;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setIdPhotoDataUrl(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const submitReissue = async () => {
    setReissueError(null);
    if (!idPhotoDataUrl) {
      setReissueError("身分証明書の写真を撮影してください");
      return;
    }
    setBusy(true);
    try {
      const normalizedPhone = newPhone.trim()
        ? (() => {
            const digits = newPhone.replace(/[^\d+]/g, "");
            if (digits.startsWith("+")) return digits;
            if (digits.startsWith("0")) return "+81" + digits.slice(1);
            return digits;
          })()
        : null;
      await onReissue({ customerId, newPhone: normalizedPhone, idPhotoDataUrl });
      setReissueUrl(`${window.location.origin}/customer?id=${customerId}`);
      load();
    } catch (e) {
      setReissueError(e?.message || "再発行に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  // 失敗した時に画面へ出す(2026-08-07)。以前は catch が無く、失敗しても
  // ボタンが薄くなって元に戻るだけで、何が起きたか分からなかった。
  const [deleteError, setDeleteError] = useState(null);
  const confirmedDelete = async () => {
    setBusy(true);
    setDeleteError(null);
    try {
      await onDeletePermanently(customerId);
      setConfirmDelete(false);
      onDeleted && onDeleted();
    } catch (e) {
      setDeleteError(e?.message || "削除に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="px-3 py-4 text-[12px]" style={{ background: C.cream, color: C.mute }}>
        読み込み中…
      </div>
    );
  }

  const status = detail?.status || "active";
  const statusLabel = { active: "有効", blacklisted: "ブラックリスト", suspended: "一時停止" }[status];
  const statusColor = { active: C.teal, blacklisted: C.coral, suspended: "#C9A227" }[status];

  return (
    <div className="px-3 py-4" style={{ background: C.cream }} id={`print-customer-${customerId}`}>
      <div className="picopay-print-only">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold" style={{ color: C.ink }}>{detail?.profile?.name}様 ご利用状況</div>
          <button
            onClick={printPanel}
            className="text-[11px] font-semibold no-print"
            style={{ color: C.teal }}
          >
            PDFで保存/印刷
          </button>
        </div>
        <div className="mt-1 no-print">
          <span
            className="text-[10px] font-semibold rounded-full px-2 py-0.5"
            style={{ background: status === "active" ? C.coralSoft : "#fff", color: statusColor, border: status === "active" ? "none" : `1px solid ${statusColor}` }}
          >
            {statusLabel}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]" style={{ color: C.ink }}>
          <div>お客様ID: {customerId}</div>
          <div>電話番号: {detail?.profile?.phone || "-"}</div>
          <div>メール: {detail?.profile?.email || "-"}</div>
          <div>ポイント: P{(detail?.pointBalance || 0).toLocaleString()}</div>
          <div>預かり残高: ¥{(detail?.depositBalance || 0).toLocaleString()}</div>
        </div>
        <div className="mt-3 text-[11px] font-semibold" style={{ color: C.ink }}>利用履歴</div>
        <div className="mt-1 rounded-lg overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
          {(detail?.history || []).length === 0 && (
            <div className="px-2 py-2 text-[11px]" style={{ background: C.paper, color: C.mute }}>
              履歴はまだありません
            </div>
          )}
          {(detail?.history || []).map((h, i) => (
            <div
              key={i}
              className="px-2 py-1.5 text-[11px] flex items-center justify-between"
              style={{ background: C.paper, borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}
            >
              <span style={{ color: C.mute }}>{h.date} {h.summary}</span>
              <span style={{ color: h.total > 0 ? C.teal : C.ink, fontWeight: 600 }}>
                {h.total > 0 ? "+" : ""}{h.total.toLocaleString()}
              </span>
            </div>
          ))}
        </div>

        {/* Status / deletion controls — only what this role may do is shown. */}
        {(permissions.blacklist || permissions.deleteCustomer) && (
        <div className="mt-3 no-print">
          <div className="text-[11px] font-semibold" style={{ color: C.ink }}>お客様の管理</div>
          <div className="mt-1 grid gap-2" style={{ gridTemplateColumns: `repeat(${(permissions.blacklist ? 2 : 0) + (permissions.deleteCustomer ? 1 : 0)}, minmax(0, 1fr))` }}>
            {permissions.blacklist && (
            <>
            <button
              onClick={() => changeStatus(status === "blacklisted" ? "active" : "blacklisted")}
              disabled={busy}
              className="rounded-lg py-2 text-[11px] font-semibold"
              style={
                status === "blacklisted"
                  ? { background: C.coral, color: "#fff" }
                  : { background: C.paper, color: C.ink, border: `1px solid ${C.line}` }
              }
            >
              {status === "blacklisted" ? "解除する" : "ブラックリスト"}
            </button>
            <button
              onClick={() => changeStatus(status === "suspended" ? "active" : "suspended")}
              disabled={busy}
              className="rounded-lg py-2 text-[11px] font-semibold"
              style={
                status === "suspended"
                  ? { background: "#C9A227", color: "#fff" }
                  : { background: C.paper, color: C.ink, border: `1px solid ${C.line}` }
              }
            >
              {status === "suspended" ? "解除する" : "一時停止"}
            </button>
            </>
            )}
            {permissions.deleteCustomer && (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="rounded-lg py-2 text-[11px] font-semibold"
              style={{ background: C.paper, color: C.coral, border: `1px solid ${C.coral}` }}
            >
              完全削除
            </button>
            )}
          </div>

          </div>
        )}
        <div className="no-print">
          <button
            onClick={() => { setShowReissue((v) => !v); setReissueUrl(null); setReissueError(null); }}
            className="mt-2 w-full rounded-lg py-2 text-[11px] font-semibold"
            style={{ background: C.paper, color: C.teal, border: `1px solid ${C.line}` }}
          >
            {showReissue ? "閉じる" : "端末紛失・機種変更時の再発行"}
          </button>

          {showReissue && !reissueUrl && (
            <div className="mt-2 rounded-xl p-3" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
              <div className="text-[11px]" style={{ color: C.mute }}>
                身分証明書(免許証・マイナンバーカード等、顔写真付き)を撮影して本人確認してください
              </div>
              <label className="mt-2 block" htmlFor={`id-photo-${customerId}`}>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => handlePhotoSelected(e.target.files?.[0])}
                  className="hidden"
                  id={`id-photo-${customerId}`}
                />
                <span
                  className="block w-full text-center rounded-lg py-2 text-[11px] font-semibold cursor-pointer"
                  style={{ background: idPhotoDataUrl ? C.coralSoft : C.cream, color: idPhotoDataUrl ? C.coral : C.ink }}
                >
                  {idPhotoDataUrl ? "✓ 撮影済み(撮り直す)" : "身分証明書を撮影する"}
                </span>
              </label>
              {idPhotoDataUrl && (
                <img src={idPhotoDataUrl} alt="身分証明書プレビュー" className="mt-2 w-full rounded-lg" />
              )}
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="新しい電話番号(番号が変わった場合のみ入力)"
                className="mt-2 w-full rounded-lg px-3 py-2 text-[12px] outline-none"
                style={{ background: C.cream, color: C.ink }}
              />
              <button
                onClick={submitReissue}
                disabled={busy || !idPhotoDataUrl}
                className="mt-2 w-full rounded-full py-2 text-[12px] font-bold"
                style={{ background: idPhotoDataUrl ? C.teal : C.line, color: idPhotoDataUrl ? "#fff" : C.mute, opacity: busy ? 0.6 : 1 }}
              >
                {busy ? "処理中…" : "本人確認して再発行する"}
              </button>
              {reissueError && (
                <div className="mt-2 text-[11px] font-semibold" style={{ color: C.coral }}>
                  {reissueError}
                </div>
              )}
            </div>
          )}

          {reissueUrl && (
            <div className="mt-2 rounded-xl p-3 text-center" style={{ background: C.coralSoft }}>
              <div className="text-[12px] font-bold" style={{ color: C.coral }}>再発行しました</div>
              <div className="text-[11px] mt-1" style={{ color: C.mute }}>
                お客様の新しいスマホでこのQRを読み取ってください(SMS認証後、これまでの履歴・残高がそのまま引き継がれます)
              </div>
              <div className="mt-2 rounded-lg bg-white p-3 inline-block">
                <QRCodeSVG value={reissueUrl} size={80} level="M" />
              </div>
            </div>
          )}
        </div>

        {confirmDelete && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center px-6 no-print"
            style={{ background: "rgba(0,0,0,0.4)" }}
          >
            <div className="rounded-2xl p-4 w-full max-w-xs" style={{ background: "#fff" }}>
              <div className="text-sm font-bold" style={{ color: C.ink }}>本当によろしいですか?</div>
              <div className="text-[12px] mt-2" style={{ color: C.mute }}>
                {detail?.profile?.name}様のデータを完全に削除します。この操作は取り消せません。
              </div>
              {deleteError && (
                <div className="mt-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: "#FDEDED", color: "#B3261E" }}>
                  {deleteError}
                </div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-full py-2 text-sm font-semibold"
                  style={{ background: C.cream, color: C.ink }}
                >
                  キャンセル
                </button>
                <button
                  onClick={confirmedDelete}
                  disabled={busy}
                  className="rounded-full py-2 text-sm font-bold"
                  style={{ background: C.coral, color: "#fff", opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? "削除中…" : "完全削除"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- BROADCAST (配信) — shared UI for a broadcast channel ----------------
// Sending push notifications goes through a server-side function (Netlify
// Functions + Firebase Cloud Messaging, see App.jsx's handleSendPush) that
// actually delivers the message. Group management and history are handled
// entirely here.
const MAX_BROADCAST_GROUPS = 10;

function ChannelBroadcastSection({ channelKey, channelLabel, customers, storeSettings, onSave, onSend, pushIndex = {} }) {
  const [body, setBody] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showGroupSend, setShowGroupSend] = useState(false);
  const [showGroupCreate, setShowGroupCreate] = useState(false);
  const [showGroupList, setShowGroupList] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [pickedCustomerIds, setPickedCustomerIds] = useState([]);
  const [openGroupId, setOpenGroupId] = useState(null); // which group's 追加/削除 is open in the group list
  const [groupAction, setGroupAction] = useState(null); // "add" | "remove"
  const [addPickIds, setAddPickIds] = useState([]);
  const [removePickIds, setRemovePickIds] = useState([]);

  const historyKey = `${channelKey}BroadcastHistory`;
  const groupsKey = `${channelKey}Groups`;
  const history = storeSettings[historyKey] || [];
  const groups = storeSettings[groupsKey] || [];

  // 通知を受け取る設定かどうかは pushIndex を見る(2026-08-07)。顧客一覧は
  // ログイン時の状態のままなので、後から許可した人が入ってこなかった。
  const optedIn = customers
    .filter((c) => pushIndex[c.id]?.push)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ja"));

  const [sendError, setSendError] = useState(null);
  const [sending, setSending] = useState(false);

  // count は「実際に送った宛先の数」。以前は通知を受け取る設定の人数を
  // 記録していたため、宛先0件で何も送れていなくても履歴だけが残り、
  // 届かない時に気づけなかった(2026-08-07)。
  const logHistory = async (target, count) => {
    const entry = { date: new Date().toLocaleDateString("ja-JP"), body, target, count };
    await onSave({ [historyKey]: [entry, ...history].slice(0, 10) });
  };

  const tokensFor = (pool) => {
  const allTokens = [];
  for (const c of pool) {
    const t = pushIndex[c.id]?.tokens;
    if (Array.isArray(t)) {
      allTokens.push(...t.filter(Boolean));
    } else if (t && typeof t === "object") {
      allTokens.push(...Object.keys(t));
    }
  }
  return [...new Set(allTokens)];
};

  const sendToAll = async () => {
    setSendError(null);
    setSending(true);
    try {
      const tokens = tokensFor(optedIn);
      if (tokens.length === 0) {
        setSendError("送信先がありません(通知を受け取る設定のお客様がいません)");
        return;
      }
      if (onSend) await onSend(tokens, body);
      await logHistory("全員", tokens.length);
      setBody("");
    } catch (e) {
      setSendError(e?.message || "送信に失敗しました");
    } finally {
      setSending(false);
    }
  };

  const sendToGroups = async () => {
    const pool = customers.filter((c) =>
      selectedGroupIds.some((gid) => groups.find((g) => g.id === gid)?.customerIds.includes(c.id))
    );
    const targeted = pool.filter((c) => pushIndex[c.id]?.push);
    const label = groups.filter((g) => selectedGroupIds.includes(g.id)).map((g) => g.name).join("・");
    setSendError(null);
    setSending(true);
    try {
      const tokens = tokensFor(targeted);
      if (tokens.length === 0) {
        setSendError("送信先がありません(通知を受け取る設定のお客様がいません)");
        return;
      }
      if (onSend) await onSend(tokens, body);
      await logHistory(label, tokens.length);
      setBody("");
      setSelectedGroupIds([]);
      setShowGroupSend(false);
    } catch (e) {
      setSendError(e?.message || "送信に失敗しました");
    } finally {
      setSending(false);
    }
  };

  const createGroup = async () => {
    if (!groupNameDraft.trim() || pickedCustomerIds.length === 0) return;
    const newGroup = { id: `${channelKey}-grp-${Date.now()}`, name: groupNameDraft.trim(), customerIds: pickedCustomerIds };
    await onSave({ [groupsKey]: [...groups, newGroup] });
    setGroupNameDraft("");
    setPickedCustomerIds([]);
    setShowGroupCreate(false);
  };

  const deleteGroup = async (id) => {
    await onSave({ [groupsKey]: groups.filter((g) => g.id !== id) });
    setOpenGroupId(null);
  };

  const addMembers = async (id) => {
    if (addPickIds.length === 0) return;
    const next = groups.map((g) =>
      g.id === id ? { ...g, customerIds: [...g.customerIds, ...addPickIds] } : g
    );
    await onSave({ [groupsKey]: next });
    setAddPickIds([]);
    setGroupAction(null);
  };

  const removeMembers = async (id) => {
    if (removePickIds.length === 0) return;
    const next = groups.map((g) =>
      g.id === id ? { ...g, customerIds: g.customerIds.filter((cid) => !removePickIds.includes(cid)) } : g
    );
    await onSave({ [groupsKey]: next });
    setRemovePickIds([]);
    setGroupAction(null);
  };

  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
      <div className="text-sm font-bold" style={{ color: C.ink }}>{channelLabel}</div>
      <div className="text-[11px] mt-1" style={{ color: C.mute }}>
        通知の受け取りを許可しているお客様(現在{optedIn.length}名)にのみ届きます
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="配信内容を入力してください"
        rows={4}
        className="mt-3 w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
        style={{ background: C.cream, color: C.ink }}
      />

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={sendToAll}
          disabled={!body.trim() || sending}
          className="rounded-full py-2.5 text-sm font-bold"
          style={{ background: body.trim() ? C.teal : C.line, color: body.trim() ? "#fff" : C.mute, opacity: sending ? 0.6 : 1 }}
        >
          {sending ? "送信中…" : "一斉配信"}
        </button>
        <button
          onClick={() => setShowGroupSend((v) => !v)}
          disabled={sending}
          className="rounded-full py-2.5 text-sm font-bold"
          style={{ background: C.cream, color: C.ink }}
        >
          グループ配信
        </button>
      </div>

      {sendError && (
        <div className="mt-2 text-[11px] font-semibold" style={{ color: C.coral }}>{sendError}</div>
      )}

      {showGroupSend && (
        <div className="mt-2 rounded-xl p-3" style={{ background: C.cream }}>
          {groups.length === 0 && (
            <div className="text-[11px] text-center py-2" style={{ color: C.mute }}>配信グループがまだありません</div>
          )}
          {groups.map((g) => (
            <label key={g.id} className="flex items-center justify-between py-1.5 text-[13px]" style={{ color: C.ink }}>
              <span>{g.name}({g.customerIds.length}名)</span>
              <input
                type="checkbox"
                checked={selectedGroupIds.includes(g.id)}
                onChange={() =>
                  setSelectedGroupIds((ids) => (ids.includes(g.id) ? ids.filter((x) => x !== g.id) : [...ids, g.id]))
                }
              />
            </label>
          ))}
          {groups.length > 0 && (
            <button
              onClick={sendToGroups}
              disabled={selectedGroupIds.length === 0 || !body.trim() || sending}
              className="mt-2 w-full rounded-full py-2 text-sm font-bold"
              style={{
                background: selectedGroupIds.length > 0 && body.trim() ? C.teal : C.line,
                color: selectedGroupIds.length > 0 && body.trim() ? "#fff" : C.mute,
                opacity: sending ? 0.6 : 1,
              }}
            >
              {sending ? "送信中…" : "配信する"}
            </button>
          )}
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => { setShowGroupCreate((v) => !v); setShowGroupList(false); }}
          disabled={groups.length >= MAX_BROADCAST_GROUPS}
          className="rounded-full py-2 text-xs font-semibold"
          style={{ background: C.cream, color: groups.length >= MAX_BROADCAST_GROUPS ? C.mute : C.ink }}
        >
          {groups.length >= MAX_BROADCAST_GROUPS ? "グループは最大10個まで" : "グループ作成"}
        </button>
        <button
          onClick={() => { setShowGroupList((v) => !v); setShowGroupCreate(false); }}
          className="rounded-full py-2 text-xs font-semibold"
          style={{ background: C.cream, color: C.ink }}
        >
          グループ一覧
        </button>
      </div>

      {showGroupCreate && (
        <div className="mt-2 rounded-xl p-3" style={{ background: C.cream }}>
          <input
            value={groupNameDraft}
            onChange={(e) => setGroupNameDraft(e.target.value)}
            placeholder="グループ名"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "#fff", color: C.ink }}
          />
          <div className="text-[10px] mt-2" style={{ color: C.mute }}>
            {channelLabel}を許可しているお客様(あいうえお順)
          </div>
          <div className="mt-1 max-h-52 overflow-y-auto rounded-lg" style={{ background: "#fff" }}>
            {optedIn.length === 0 && (
              <div className="text-[11px] text-center py-3" style={{ color: C.mute }}>対象のお客様がいません</div>
            )}
            {optedIn.map((c) => (
              <label key={c.id} className="flex items-center justify-between px-3 py-2 text-[13px]" style={{ color: C.ink, borderBottom: `1px solid ${C.line}` }}>
                <span>{c.name}</span>
                <input
                  type="checkbox"
                  checked={pickedCustomerIds.includes(c.id)}
                  onChange={() =>
                    setPickedCustomerIds((ids) =>
                      ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id]
                    )
                  }
                />
              </label>
            ))}
          </div>
          <button
            onClick={createGroup}
            disabled={!groupNameDraft.trim() || pickedCustomerIds.length === 0}
            className="mt-2 w-full rounded-full py-2 text-sm font-bold"
            style={{
              background: groupNameDraft.trim() && pickedCustomerIds.length > 0 ? C.teal : C.line,
              color: groupNameDraft.trim() && pickedCustomerIds.length > 0 ? "#fff" : C.mute,
            }}
          >
            グループ作成
          </button>
        </div>
      )}

      {showGroupList && (
        <div className="mt-2 rounded-xl overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
          {groups.length === 0 && (
            <div className="px-3 py-3 text-center text-[12px]" style={{ background: C.cream, color: C.mute }}>
              まだ配信グループがありません
            </div>
          )}
          {groups.map((g, i) => {
            const memberSet = new Set(g.customerIds);
            const nonMembers = optedIn.filter((c) => !memberSet.has(c.id));
            const members = optedIn.filter((c) => memberSet.has(c.id));
            return (
              <div key={g.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                <button
                  onClick={() => {
                    setOpenGroupId(openGroupId === g.id ? null : g.id);
                    setGroupAction(null);
                    setAddPickIds([]);
                    setRemovePickIds([]);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2"
                  style={{ background: C.paper }}
                >
                  <span className="text-sm font-semibold" style={{ color: C.ink }}>{g.name}({g.customerIds.length}名)</span>
                  <ChevronRight size={14} style={{ color: C.mute, transform: openGroupId === g.id ? "rotate(90deg)" : "none" }} />
                </button>
                {openGroupId === g.id && (
                  <div className="px-3 pb-3" style={{ background: C.cream }}>
                    <div className="grid grid-cols-3 gap-2 pt-2">
                      <button
                        onClick={() => setGroupAction(groupAction === "add" ? null : "add")}
                        className="rounded-full py-1.5 text-[11px] font-semibold"
                        style={{ background: groupAction === "add" ? C.teal : "#fff", color: groupAction === "add" ? "#fff" : C.ink }}
                      >
                        追加
                      </button>
                      <button
                        onClick={() => setGroupAction(groupAction === "remove" ? null : "remove")}
                        className="rounded-full py-1.5 text-[11px] font-semibold"
                        style={{ background: groupAction === "remove" ? C.coral : "#fff", color: groupAction === "remove" ? "#fff" : C.ink }}
                      >
                        削除
                      </button>
                      <button
                        onClick={() => deleteGroup(g.id)}
                        className="rounded-full py-1.5 text-[11px] font-semibold"
                        style={{ background: "#fff", color: C.coral }}
                      >
                        グループ削除
                      </button>
                    </div>

                    {groupAction === "add" && (
                      <div className="mt-2">
                        <div className="max-h-44 overflow-y-auto rounded-lg" style={{ background: "#fff" }}>
                          {nonMembers.length === 0 && (
                            <div className="text-[11px] text-center py-3" style={{ color: C.mute }}>追加できるお客様がいません</div>
                          )}
                          {nonMembers.map((c) => (
                            <label key={c.id} className="flex items-center justify-between px-3 py-2 text-[13px]" style={{ color: C.ink, borderBottom: `1px solid ${C.line}` }}>
                              <span>{c.name}</span>
                              <input
                                type="checkbox"
                                checked={addPickIds.includes(c.id)}
                                onChange={() =>
                                  setAddPickIds((ids) => (ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id]))
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <button
                          onClick={() => addMembers(g.id)}
                          disabled={addPickIds.length === 0}
                          className="mt-2 w-full rounded-full py-2 text-xs font-bold"
                          style={{ background: addPickIds.length > 0 ? C.teal : C.line, color: addPickIds.length > 0 ? "#fff" : C.mute }}
                        >
                          追加する
                        </button>
                      </div>
                    )}

                    {groupAction === "remove" && (
                      <div className="mt-2">
                        <div className="max-h-44 overflow-y-auto rounded-lg" style={{ background: "#fff" }}>
                          {members.length === 0 && (
                            <div className="text-[11px] text-center py-3" style={{ color: C.mute }}>メンバーがいません</div>
                          )}
                          {members.map((c) => (
                            <label key={c.id} className="flex items-center justify-between px-3 py-2 text-[13px]" style={{ color: C.ink, borderBottom: `1px solid ${C.line}` }}>
                              <span>{c.name}</span>
                              <input
                                type="checkbox"
                                checked={removePickIds.includes(c.id)}
                                onChange={() =>
                                  setRemovePickIds((ids) => (ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id]))
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <button
                          onClick={() => removeMembers(g.id)}
                          disabled={removePickIds.length === 0}
                          className="mt-2 w-full rounded-full py-2 text-xs font-bold"
                          style={{ background: removePickIds.length > 0 ? C.coral : C.line, color: removePickIds.length > 0 ? "#fff" : C.mute }}
                        >
                          削除する
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={() => setShowHistory((v) => !v)}
        className="mt-2 w-full rounded-full py-2 text-xs font-semibold"
        style={{ background: C.cream, color: C.ink }}
      >
        配信履歴
      </button>
      {showHistory && (
        <div className="mt-2 rounded-xl overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
          {history.length === 0 && (
            <div className="px-3 py-3 text-center text-[12px]" style={{ background: C.cream, color: C.mute }}>
              まだ配信履歴がありません
            </div>
          )}
          {history.map((h, i) => (
            <div key={i} className="px-3 py-2" style={{ background: C.paper, borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
              <div className="text-[10px]" style={{ color: C.mute }}>{h.date}・{h.target}({h.count}名)</div>
              <div className="text-[11px]" style={{ color: C.ink }}>{h.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BroadcastPanel({ customers, storeSettings, onSave, onSendPush, pushIndex = {} }) {
  return (
    <ChannelBroadcastSection
      channelKey="push"
      channelLabel="プッシュ通知"
      customers={customers}
      storeSettings={storeSettings}
      onSave={onSave}
      onSend={onSendPush}
      pushIndex={pushIndex}
    />
  );
}

// ---------------- STORE BRANDING SETTINGS ----------------
function compressImage(file, maxDim, quality, onDone, onError) {
  const reader = new FileReader();
  reader.onerror = () => onError && onError();
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => onError && onError();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      onDone(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function ImageUploadButton({ id, label, currentImage, onImageReady, onDelete, isDeleted, maxDim = 800 }) {
  const [error, setError] = useState(null);
  return (
    <div>
      <label htmlFor={id}>
        <input
          type="file"
          accept="image/*"
          id={id}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError(null);
            compressImage(
              file,
              maxDim,
              0.8,
              (dataUrl) => onImageReady(dataUrl),
              () => setError("画像の読み込みに失敗しました")
            );
          }}
        />
        <span
          className="block w-full text-center rounded-lg py-2 text-[11px] font-semibold cursor-pointer"
          style={{ background: currentImage ? C.coralSoft : C.cream, color: currentImage ? C.coral : C.ink }}
        >
          {currentImage ? `✓ ${label}(変更する)` : label}
        </span>
      </label>
      {onDelete && !isDeleted && (
        <button
          onClick={onDelete}
          className="mt-1 block w-full text-center rounded-lg py-1.5 text-[10px] font-semibold"
          style={{ background: C.cream, color: C.mute }}
        >
          画像を削除する
        </button>
      )}
      {error && <div className="mt-1 text-[10px]" style={{ color: C.coral }}>{error}</div>}
    </div>
  );
}

// ---------------- REFERRAL PROGRAM SETTINGS ----------------
function ReferralSettings({ storeSettings, onSave }) {
  const [enabled, setEnabled] = useState(storeSettings.referralEnabled || false);
  const [referrerRate, setReferrerRate] = useState(storeSettings.referralReferrerRate ?? 10);
  const [refereeRate, setRefereeRate] = useState(storeSettings.referralRefereeRate ?? 10);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await onSave({
      referralEnabled: enabled,
      referralReferrerRate: clampRate(referrerRate),
      referralRefereeRate: clampRate(refereeRate),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold" style={{ color: C.ink }}>お友達紹介プログラム</div>
        <button
          onClick={() => setEnabled(!enabled)}
          className="relative w-11 h-6 rounded-full transition-colors shrink-0"
          style={{ background: enabled ? C.teal : C.line }}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
            style={{ transform: enabled ? "translateX(22px)" : "translateX(2px)" }}
          />
        </button>
      </div>
      <div className="text-[11px] mt-1" style={{ color: C.mute }}>
        紹介されたお客様が初めてチャージした金額に応じて、紹介した人・された人の両方にポイントを付与します
      </div>

      {enabled && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <div className="text-[11px] font-semibold" style={{ color: C.ink }}>紹介した人への還元率</div>
              <div className="mt-1 flex items-center rounded-lg" style={{ background: C.cream }}>
                <input
                  type="number"
                  value={referrerRate}
                  onChange={(e) => setReferrerRate(clampRate(e.target.value))}
                  className="w-full bg-transparent px-3 py-2 text-sm font-semibold outline-none"
                  style={{ color: C.ink }}
                />
                <span className="pr-3 text-xs font-semibold" style={{ color: C.mute }}>%</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold" style={{ color: C.ink }}>紹介された人への還元率</div>
              <div className="mt-1 flex items-center rounded-lg" style={{ background: C.cream }}>
                <input
                  type="number"
                  value={refereeRate}
                  onChange={(e) => setRefereeRate(clampRate(e.target.value))}
                  className="w-full bg-transparent px-3 py-2 text-sm font-semibold outline-none"
                  style={{ color: C.ink }}
                />
                <span className="pr-3 text-xs font-semibold" style={{ color: C.mute }}>%</span>
              </div>
            </div>
          </div>
          <div className="text-[10px] mt-2" style={{ color: C.mute }}>
            例:紹介された方が初回¥10,000チャージした場合、紹介者にP{Math.round(10000 * (referrerRate / 100))}・紹介された方にP{Math.round(10000 * (refereeRate / 100))}が付与されます
          </div>
        </>
      )}

      <button
        onClick={save}
        className="mt-3 w-full rounded-full py-2.5 text-sm font-bold"
        style={{ background: C.teal, color: "#fff" }}
      >
        {saved ? "✓ 保存しました" : "保存"}
      </button>
    </div>
  );
}

function StoreBrandingSettings({ storeSettings, onSave, branding = {}, onSaveBranding }) {
  const [brandMode, setBrandMode] = useState(storeSettings.brandMode || "default");
  // These hold the *stored* value (null = untouched, "" = deleted), not what
  // gets displayed — see resolveBrandImage above. They live under a separate
  // `branding` node, not storeSettings — storeSettings is what every
  // decision reads (once per charge/sale), and the images were the one
  // thing in it too large to justify that.
  const [logoImage, setLogoImage] = useState(branding.logoImage ?? null);
  const [iconImage, setIconImage] = useState(branding.iconImage ?? null);
  const [iconShape, setIconShape] = useState(storeSettings.iconShape || "circle");
  const [storeName, setStoreName] = useState(storeSettings.storeName || "");
  const [storeNameFont, setStoreNameFont] = useState(storeSettings.storeNameFont || "gothic");
  const [storeNameWeight, setStoreNameWeight] = useState(storeSettings.storeNameWeight || "normal");
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await Promise.all([
      onSave({
        brandMode,
        iconShape,
        storeName,
        storeNameFont,
        storeNameWeight,
      }),
      onSaveBranding({ logoImage, iconImage }),
    ]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const shownLogo = resolveBrandImage(logoImage, PICO_PLACEHOLDER.logo);
  const shownIcon = resolveBrandImage(iconImage, PICO_PLACEHOLDER.icon);

  // In "default" mode the header shows PicoPay's own branding, so the
  // home-screen icon is covered too — no warning is warranted there.
  const appIconSource =
    brandMode === "iconName"
      ? shownIcon
      : brandMode === "logo"
      ? shownLogo
      : PICO_PLACEHOLDER.icon;

  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
      <div className="text-sm font-bold" style={{ color: C.ink }}>お店のアイコン・名前</div>
      <div className="text-[11px] mt-1" style={{ color: C.mute }}>
        ヘッダーの表示(今のピコのアイコン〜「PicoPay」の文字がある幅)を、お店独自のロゴまたはアイコン+店舗名に差し替えられます
      </div>

      <div className="mt-3 flex items-center gap-3 rounded-lg p-3" style={{ background: C.cream }}>
        <div
          className="h-14 w-14 shrink-0 overflow-hidden flex items-center justify-center"
          style={{ borderRadius: iconShape === "square" ? 12 : 9999, background: appIconSource ? "#fff" : "transparent", border: `1px solid ${C.line}` }}
        >
          {appIconSource ? (
            <img src={appIconSource} alt="ホーム画面アイコンのプレビュー" className="h-full w-full object-contain" />
          ) : (
            <span className="text-lg">⚠️</span>
          )}
        </div>
        <div className="text-[11px]" style={{ color: appIconSource ? C.mute : C.coral }}>
          {appIconSource
            ? "ホーム画面に追加した時のアイコンにも、これが使われます"
            : "⚠️ 画面用アイコンが設定されておりません(ホーム画面に追加した時に使われるアイコンです)"}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        {[
          { key: "logo", label: "ロゴのみ" },
          { key: "iconName", label: "アイコン+店舗名" },
        ].map((o) => (
          <button
            key={o.key}
            onClick={() => setBrandMode(o.key)}
            className="flex-1 rounded-lg py-2 text-[11px] font-semibold"
            style={
              brandMode === o.key
                ? { background: C.teal, color: "#fff" }
                : { background: C.cream, color: C.mute }
            }
          >
            {o.label}
          </button>
        ))}
      </div>

      {brandMode === "logo" && (
        <div className="mt-3">
          <div className="text-[10px]" style={{ color: C.mute }}>
            推奨サイズ:横{BRANDING_SIZES.logoWidth}px × 縦{BRANDING_SIZES.logoHeight}px(横長のロゴがこの枠にぴったり収まります)
          </div>
          <div className="mt-1">
            <ImageUploadButton
              id="branding-logo"
              label="ロゴ画像をアップロード"
              currentImage={shownLogo}
              onImageReady={setLogoImage}
              onDelete={() => setLogoImage("")}
              isDeleted={logoImage === ""}
              maxDim={BRANDING_SIZES.logoWidth * 3}
            />
          </div>
          {shownLogo && (
            <div className="mt-2 flex justify-center rounded-lg p-3" style={{ background: C.cream }}>
              <img
                src={shownLogo}
                alt="ロゴプレビュー"
                style={{ height: BRANDING_SIZES.logoHeight, maxWidth: BRANDING_SIZES.logoWidth, objectFit: "contain" }}
              />
            </div>
          )}
        </div>
      )}

      {brandMode === "iconName" && (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] font-semibold" style={{ color: C.ink }}>アイコンの形</div>
          <div className="flex gap-2">
            {[
              { key: "circle", label: "丸" },
              { key: "square", label: "四角(角丸)" },
            ].map((o) => (
              <button
                key={o.key}
                onClick={() => setIconShape(o.key)}
                className="flex-1 rounded-lg py-2 text-[11px] font-semibold"
                style={
                  iconShape === o.key
                    ? { background: C.teal, color: "#fff" }
                    : { background: C.cream, color: C.mute }
                }
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="text-[10px]" style={{ color: C.mute }}>
            推奨サイズ:{BRANDING_SIZES.iconSize}px × {BRANDING_SIZES.iconSize}px の正方形画像
          </div>
          <ImageUploadButton
            id="branding-icon"
            label="アイコン画像をアップロード"
            currentImage={shownIcon}
            onImageReady={setIconImage}
            onDelete={() => setIconImage("")}
            isDeleted={iconImage === ""}
            maxDim={BRANDING_SIZES.iconSize}
          />

          <input
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="お店の名前"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: C.cream, color: C.ink }}
          />

          <div className="text-[11px] font-semibold" style={{ color: C.ink }}>フォント</div>
          <div className="flex gap-2">
            {[
              { key: "gothic", label: "ゴシック" },
              { key: "mincho", label: "明朝" },
            ].map((o) => (
              <button
                key={o.key}
                onClick={() => setStoreNameFont(o.key)}
                className="flex-1 rounded-lg py-2 text-[11px] font-semibold"
                style={
                  storeNameFont === o.key
                    ? { background: C.teal, color: "#fff" }
                    : { background: C.cream, color: C.mute }
                }
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="text-[11px] font-semibold" style={{ color: C.ink }}>太さ</div>
          <div className="flex gap-2">
            {[
              { key: "bold", label: "太字" },
              { key: "normal", label: "標準" },
            ].map((o) => (
              <button
                key={o.key}
                onClick={() => setStoreNameWeight(o.key)}
                className="flex-1 rounded-lg py-2 text-[11px] font-semibold"
                style={
                  storeNameWeight === o.key
                    ? { background: C.teal, color: "#fff" }
                    : { background: C.cream, color: C.mute }
                }
              >
                {o.label}
              </button>
            ))}
          </div>

          {shownIcon && storeName && (
            <div className="flex items-center gap-2 rounded-lg p-3" style={{ background: C.cream }}>
              <div
                className="h-9 w-9 overflow-hidden shrink-0"
                style={{ borderRadius: iconShape === "square" ? 10 : 9999 }}
              >
                <img src={shownIcon} alt="preview" className="h-9 w-9 object-cover" />
              </div>
              <div
                className="text-[15px]"
                style={{
                  color: C.ink,
                  fontFamily: storeNameFont === "mincho" ? "'Hiragino Mincho ProN', serif" : "'Hiragino Sans', sans-serif",
                  fontWeight: storeNameWeight === "bold" ? 700 : 500,
                }}
              >
                {storeName}
              </div>
            </div>
          )}
        </div>
      )}

      <button
        onClick={save}
        className="mt-4 w-full rounded-full py-2.5 text-sm font-bold"
        style={{ background: C.teal, color: "#fff" }}
      >
        {saved ? "✓ 保存しました" : "保存"}
      </button>
    </div>
  );
}


// ---------------- 各種集計 ----------------
// Terms follow the prepaid-instrument reference dates: 前期 4/1–9/30,
// 後期 10/1–3/31. Kept in this file (rather than imported) so the screen
// renders without reaching into the database layer.
function termKeyOfDate(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  if (m >= 4 && m <= 9) return `${y}-H1`;
  if (m >= 10) return `${y}-H2`;
  return `${y - 1}-H2`;
}

function termLabelOf(key) {
  const [y, half] = key.split("-");
  const year = Number(y);
  return half === "H1"
    ? `${year}/4/1〜${year}/9/30`
    : `${year}/10/1〜${year + 1}/3/31`;
}

function formatDateTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const PAGE_SIZE = 50;

// The store thinks of points in three groups, with the deposit-side ones
// broken out because they're the ones that get tuned most often.
function PointBreakdown({ points = {}, compact = false }) {
  const depositSide =
    (points.depositBonus || 0) + (points.weather || 0) + (points.gacha || 0);
  const groups = [
    {
      label: "入金ポイント",
      value: depositSide,
      children: [
        { label: "入金ボーナス", value: points.depositBonus || 0 },
        { label: "雨の日ボーナス", value: points.weather || 0 },
        { label: "入金ガチャ", value: points.gacha || 0 },
      ],
    },
    { label: "購入ポイント", value: points.purchase || 0, children: [] },
    { label: "友達紹介ポイント", value: points.referral || 0, children: [] },
  ];

  return (
    <div className={compact ? "mt-1" : "mt-2 pt-2"} style={compact ? {} : { borderTop: `1px solid ${C.line}` }}>
      {groups.map((g) => (
        <div key={g.label}>
          <div className="flex justify-between text-[11px]" style={{ color: C.mute }}>
            <span>{g.label}</span>
            <span>P{g.value.toLocaleString()}</span>
          </div>
          {g.children.map((c) => (
            <div key={c.label} className="flex justify-between text-[10px] pl-3" style={{ color: C.mute, opacity: 0.75 }}>
              <span>・{c.label}</span>
              <span>P{c.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function AggregateScreen({ stats = {}, customers = [], onLoadTransactions, onCancelTransaction, canCancel = false, onBack }) {
  const currentTerm = termKeyOfDate(new Date());
  const termKeys = Object.keys(stats.terms || {});
  if (!termKeys.includes(currentTerm)) termKeys.push(currentTerm);
  termKeys.sort().reverse();

  const [showAllTerms, setShowAllTerms] = useState(false);
  const [showTx, setShowTx] = useState(false);
  const [txTerm, setTxTerm] = useState(currentTerm);
  const [nameQuery, setNameQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cancelingId, setCancelingId] = useState(null);
  const [cancelError, setCancelError] = useState(null);

  // Only today's, not-yet-canceled, non-cancellation entries can be
  // reversed — the server enforces the same rule, this just avoids
  // offering a button that would fail.
  const todayStr = new Date().toDateString();
  const canCancelRow = (r) =>
    canCancel &&
    !r.canceled &&
    r.kind !== "cancellation" &&
    new Date(r.ts).toDateString() === todayStr;

  const doCancel = async (r) => {
    setCancelingId(r.id);
    setCancelError(null);
    try {
      const result = await onCancelTransaction(r.customerId, r.id);
      if (result?.note) setCancelError(result.note);
      await loadTx(txTerm, nameQuery);
    } catch (e) {
      setCancelError(e.message || "取消に失敗しました");
    } finally {
      setCancelingId(null);
    }
  };

  const depositTotal = customers.reduce((sum, c) => sum + (c.depositBalance || 0), 0);
  const pointTotal = customers.reduce((sum, c) => sum + (c.pointBalance || 0), 0);

  // 表示するぶんだけDBから引く(2026-08-06)。以前は全件を読んでから
  // 画面側で50件ずつ切り出していたため、読む量が店舗の全履歴に比例して
  // 増え続けていた。今は「もっと見る」を押した時に初めて続きを取りに行く。
  const loadTx = async (term, query) => {
    setLoading(true);
    try {
      const result = await onLoadTransactions({ termKey: term, nameQuery: query, limit: PAGE_SIZE });
      setRows(result.rows);
      setDone(result.done);
    } finally {
      setLoading(false);
    }
  };

  const loadMoreTx = async () => {
    if (loading || done || rows.length === 0) return;
    setLoading(true);
    try {
      const result = await onLoadTransactions({
        termKey: txTerm,
        nameQuery,
        limit: PAGE_SIZE,
        before: rows[rows.length - 1].ts,
      });
      setRows((prev) => [...prev, ...result.rows]);
      setDone(result.done);
    } finally {
      setLoading(false);
    }
  };

  const openTx = () => {
    setShowTx(true);
    if (rows.length === 0) loadTx(txTerm, nameQuery);
  };

  const shownTerms = showAllTerms ? termKeys : termKeys.slice(0, 6);

  // 画面に読み込み済みの行だけを書き出す。全期間ぶんを毎回読むのをやめた
  // ため(2026-08-06)、「もっと見る」で読んだところまでが対象になる。
  const exportTxCsv = () => {
    downloadCsv(
      `picopay-transactions-${txTerm}.csv`,
      [
        "日時",
        "お客様ID",
        "お名前",
        "種別",
        "お会計総額",
        "預かり金から充当",
        "ポイントから充当",
        "チャージ額",
        "付与ポイント",
        "摘要",
      ],
      rows.map((r) => [
        formatDateTime(r.ts),
        r.customerId,
        r.customerName,
        r.kind === "payment" ? "お会計" : r.kind === "charge" ? "チャージ" : "ポイント付与",
        r.kind === "payment" ? r.gross || 0 : "",
        r.kind === "payment" ? r.depositUsed || 0 : "",
        r.kind === "payment" ? r.pointUsed || 0 : "",
        r.kind === "charge" ? r.cash || 0 : "",
        r.kind === "payment" ? r.earned || 0 : r.point || 0,
        r.summary || "",
      ])
    );
  };

  // Term totals are small, so this one needs no loading step.
  const exportTermsCsv = () => {
    downloadCsv(
      `picopay-terms-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "期間",
        "チャージ(預かり金)",
        "ポイント発行",
        "入金ボーナス",
        "雨の日ボーナス",
        "入金ガチャ",
        "購入ポイント",
        "友達紹介",
      ],
      termKeys.map((k) => {
        const t = (stats.terms || {})[k] || {};
        const pt = t.points || {};
        return [
          termLabelOf(k),
          t.cash || 0,
          t.point || 0,
          pt.depositBonus || 0,
          pt.weather || 0,
          pt.gacha || 0,
          pt.purchase || 0,
          pt.referral || 0,
        ];
      })
    );
  };

  const Card = ({ title, children }) => (
    <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
      <div className="text-sm font-bold" style={{ color: C.ink }}>{title}</div>
      {children}
    </div>
  );

  const Row = ({ label, value, sub }) => (
    <div className="mt-2 flex items-baseline justify-between">
      <span className="text-[12px]" style={{ color: C.mute }}>{label}</span>
      <span className="text-sm font-bold" style={{ color: sub ? C.mute : C.ink }}>{value}</span>
    </div>
  );

  return (
    <div className="max-w-md mx-auto px-4 pb-10">
      <button
        onClick={onBack}
        className="mt-4 flex items-center gap-1 text-[12px] font-semibold"
        style={{ color: C.mute }}
      >
        <ChevronLeft size={14} /> 設定に戻る
      </button>

      <div className="mt-2 text-lg font-bold" style={{ color: C.ink }}>各種集計</div>

      <Card title="累計(ご利用開始から)">
        <div className="text-[11px] mt-1" style={{ color: C.mute }}>
          開始日:{stats.startedAt ? formatDateTime(stats.startedAt).split(" ")[0] : "—"}
        </div>
        <Row label="累計チャージ(預かり金)" value={`¥${(stats.cashTotal || 0).toLocaleString()}`} />
        <Row label="累計ポイント発行" value={`P${(stats.pointTotal || 0).toLocaleString()}`} />
        <PointBreakdown points={stats.points || {}} />
      </Card>

      <Card title="現在の残高">
        <Row label="預かり残高の合計" value={`¥${depositTotal.toLocaleString()}`} />
        <Row label="未使用ポイントの合計" value={`P${pointTotal.toLocaleString()}`} />
        <div className="mt-2 text-[10px]" style={{ color: C.mute }}>
          ※財務局への届出判定に使うのは、預かり残高の合計です
        </div>
      </Card>

      <Card title="期別">
        <div className="mt-1 space-y-2">
          {shownTerms.map((key) => {
            const t = (stats.terms || {})[key] || {};
            return (
              <div key={key} className="rounded-xl p-3" style={{ background: C.cream }}>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold" style={{ color: C.ink }}>
                    {termLabelOf(key)}
                  </span>
                  {key === currentTerm && (
                    <span className="text-[10px] font-bold" style={{ color: C.coral }}>今期</span>
                  )}
                </div>
                {/* 期別は預かり金(現金)の累計のみ。ポイントは法的に関係ない
                    ので、ここには入れない(2026-08-07)。基準日時点の残高を
                    記録する処理も廃止した — 必要な時に期間を指定して
                    データを出せるので、貯めておく必要がない。 */}
                <div className="mt-1 flex justify-between text-[11px]" style={{ color: C.mute }}>
                  <span>チャージ(預かり金)</span>
                  <span style={{ color: C.ink, fontWeight: 700 }}>
                    ¥{(t.cash || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <button
          onClick={exportTermsCsv}
          className="mt-2 w-full rounded-lg py-2 text-[11px] font-semibold"
          style={{ background: C.cream, color: C.teal }}
        >
          期別集計をCSV出力
        </button>
        {termKeys.length > 6 && (
          <button
            onClick={() => setShowAllTerms(!showAllTerms)}
            className="mt-2 w-full rounded-lg py-2 text-[11px] font-semibold"
            style={{ background: C.cream, color: C.mute }}
          >
            {showAllTerms ? "直近6期だけ表示" : `それ以前も表示(全${termKeys.length}期)`}
          </button>
        )}
      </Card>

      <Card title="取引履歴">
        {!showTx ? (
          <button
            onClick={openTx}
            className="mt-2 w-full rounded-full py-2.5 text-sm font-bold"
            style={{ background: C.teal, color: "#fff" }}
          >
            取引履歴を表示
          </button>
        ) : (
          <>
            <div className="mt-2 flex gap-2">
              <select
                value={txTerm}
                onChange={(e) => {
                  setTxTerm(e.target.value);
                  loadTx(e.target.value, nameQuery);
                }}
                className="flex-1 rounded-lg px-2 py-2 text-[11px] outline-none"
                style={{ background: C.cream, color: C.ink }}
              >
                {termKeys.map((k) => (
                  <option key={k} value={k}>{termLabelOf(k)}</option>
                ))}
              </select>
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                placeholder="お客様名で絞り込み"
                className="flex-1 rounded-lg px-3 py-2 text-[12px] outline-none"
                style={{ background: C.cream, color: C.ink }}
              />
              <button
                onClick={() => loadTx(txTerm, nameQuery)}
                className="rounded-lg px-4 text-[11px] font-semibold"
                style={{ background: C.teal, color: "#fff" }}
              >
                絞り込む
              </button>
            </div>

            {loading ? (
              <div className="mt-4 text-center text-[12px]" style={{ color: C.mute }}>読み込み中…</div>
            ) : rows.length === 0 ? (
              <div className="mt-4 text-center text-[12px]" style={{ color: C.mute }}>
                この期間の取引はまだありません
              </div>
            ) : (
              <>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px]" style={{ color: C.mute }}>{rows.length}件</span>
                  <button
                    onClick={exportTxCsv}
                    className="rounded-lg px-3 py-1.5 text-[11px] font-semibold"
                    style={{ background: C.cream, color: C.teal }}
                  >
                    CSV出力({rows.length}件すべて)
                  </button>
                </div>
                <div className="mt-1 space-y-2">
                  {rows.map((r, i) => (
                    <div
                      key={i}
                      className="rounded-xl p-3"
                      style={{ background: C.cream, opacity: r.canceled ? 0.5 : 1 }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px]" style={{ color: C.mute }}>{formatDateTime(r.ts)}</span>
                        <span className="text-[12px] font-semibold" style={{ color: C.ink }}>{r.customerName}</span>
                      </div>
                      {r.canceled && (
                        <div className="text-[10px] font-bold" style={{ color: C.coral }}>取消済み</div>
                      )}
                      {r.kind === "payment" ? (
                        <>
                          <div className="mt-1 text-[12px] font-bold" style={{ color: C.ink }}>
                            お会計 ¥{(r.gross || 0).toLocaleString()}
                          </div>
                          <div className="mt-0.5 text-[11px]" style={{ color: C.mute }}>
                            預かり金 ¥{(r.depositUsed || 0).toLocaleString()} ／ ポイント P{(r.pointUsed || 0).toLocaleString()}
                          </div>
                          {r.earned > 0 && (
                            <div className="text-[11px] font-semibold" style={{ color: C.coral }}>
                              付与 P{r.earned.toLocaleString()}
                            </div>
                          )}
                        </>
                      ) : r.kind === "charge" ? (
                        <div className="mt-1 text-[12px] font-bold" style={{ color: C.ink }}>
                          チャージ ¥{(r.cash || 0).toLocaleString()}
                        </div>
                      ) : (
                        <div className="mt-1 text-[12px] font-bold" style={{ color: C.ink }}>
                          {r.summary}
                          {r.point > 0 && (
                            <span style={{ color: C.coral }}> P{r.point.toLocaleString()}</span>
                          )}
                        </div>
                      )}
                      {canCancelRow(r) && (
                        <button
                          onClick={() => doCancel(r)}
                          disabled={cancelingId === r.id}
                          className="mt-2 rounded-lg px-3 py-1 text-[10px] font-semibold"
                          style={{ background: "#fff", color: C.coral, opacity: cancelingId === r.id ? 0.6 : 1 }}
                        >
                          {cancelingId === r.id ? "取消中…" : "この取引を取消"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {cancelError && (
                  <div className="mt-2 text-[11px] font-semibold" style={{ color: C.coral }}>{cancelError}</div>
                )}
                {!done && (
                  <button
                    onClick={loadMoreTx}
                    className="mt-2 w-full rounded-lg py-2 text-[11px] font-semibold"
                    style={{ background: C.cream, color: C.mute }}
                  >
                    {loading ? "読み込み中…" : "もっと見る"}
                  </button>
                )}
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}


// ---------------- 権限 ----------------
// One till, one login, several people. Rather than an account each, the
// screen starts at the lowest level and someone types a password to raise it
// for a while. Only the levels that have actually been set up are offered.
const PERMISSION_LIST = [
  { key: "blacklist", label: "ブラックリスト・一時停止" },
  { key: "deleteCustomer", label: "会員削除" },
  { key: "settingsBasic", label: "設定の変更(オン/オフを除く)" },
  { key: "settingsFull", label: "設定画面すべて(各種集計を除く)" },
  { key: "aggregate", label: "各種集計" },
];

const ROLE_ORDER = ["other2", "other3", "admin"];
const ROLE_LABEL = {
  other1: "その他1",
  other2: "その他2",
  other3: "その他3",
  admin: "admin",
  owner: "adminオーナー",
};

function AdminLogin({ roles, activeRole, onVerify, onExit, onBack, onSignOut }) {
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Only levels that exist are shown — an empty box for a level nobody set up
  // just invites wrong guesses.
  const available = ROLE_ORDER.filter((r) => roles[r]);

  const submit = async (role) => {
    setBusy(true);
    setError(null);
    try {
      await onVerify(role, values[role] || "");
      onBack();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 pb-10">
      <button onClick={onBack} className="mt-4 flex items-center gap-1 text-[12px] font-semibold" style={{ color: C.mute }}>
        <ChevronLeft size={14} /> 設定に戻る
      </button>
      <div className="mt-2 text-lg font-bold" style={{ color: C.ink }}>adminログイン</div>
      <div className="text-[11px] mt-1" style={{ color: C.mute }}>
        現在:{ROLE_LABEL[activeRole] || activeRole}。パスワードを入れると30分間その権限になります
      </div>

      <div className="mt-4 space-y-3">
        {[...available, "owner"].map((role) => (
          <div key={role} className="rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
            <div className="text-[12px] font-semibold" style={{ color: C.ink }}>{ROLE_LABEL[role]}</div>
            {role === "owner" && (
              <div className="text-[10px] mt-0.5" style={{ color: C.mute }}>
                チャットで発行した6桁のコードを入れてください(10分間有効・1回限り)
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <input
                type="password"
                value={values[role] || ""}
                onChange={(e) => setValues({ ...values, [role]: e.target.value })}
                className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: C.cream, color: C.ink }}
              />
              <button
                onClick={() => submit(role)}
                disabled={busy}
                className="rounded-lg px-4 text-[11px] font-semibold"
                style={{ background: C.teal, color: "#fff", opacity: busy ? 0.6 : 1 }}
              >
                入る
              </button>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-3 text-[11px] font-semibold" style={{ color: C.coral }}>{error}</div>
      )}

      {activeRole !== "other1" && (
        <button
          onClick={() => {
            onExit();
            onBack();
          }}
          className="mt-4 w-full rounded-2xl py-3 text-sm font-bold"
          style={{ background: C.paper, border: `1px solid ${C.line}`, color: C.mute }}
        >
          通常の状態に戻す
        </button>
      )}

      {/* ここは店舗そのものではなく権限だけを外す(2026-08-07)。以前は
          店舗ログアウトを呼んでいたため、押すと店舗のログイン画面まで
          戻ってしまっていた。 */}
      <SignOutButton
        onSignOut={() => {
          onExit();
          onBack();
        }}
        label="権限ログアウト"
        note="権限のない通常の状態に戻ります。店舗のログインはそのままです"
      />
    </div>
  );
}

// Only adminオーナー sees this. Creating a level = ticking what it may do and
// giving it a password (その他1 never has one — it's the default state).
function RoleEditor({ roles, onSave, onDelete, onBack }) {
  const [editing, setEditing] = useState(null);
  const [perms, setPerms] = useState({});
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(false);

  const open = (role) => {
    setEditing(role);
    setPerms(roles[role] || {});
    setPassword("");
    setSaved(false);
  };

  const save = async () => {
    await onSave(editing, { perms, password: editing === "other1" ? null : password });
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      setEditing(null);
    }, 1200);
  };

  if (editing) {
    return (
      <div className="max-w-md mx-auto px-4 pb-10">
        <button onClick={() => setEditing(null)} className="mt-4 flex items-center gap-1 text-[12px] font-semibold" style={{ color: C.mute }}>
          <ChevronLeft size={14} /> 一覧に戻る
        </button>
        <div className="mt-2 text-lg font-bold" style={{ color: C.ink }}>{ROLE_LABEL[editing]}の設定</div>

        <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
          <div className="text-sm font-bold" style={{ color: C.ink }}>できること</div>
          <div className="mt-2 space-y-2">
            {PERMISSION_LIST.map((p) => (
              <label key={p.key} className="flex items-center gap-2 rounded-xl p-3 cursor-pointer" style={{ background: C.cream }}>
                <input
                  type="checkbox"
                  checked={!!perms[p.key]}
                  onChange={(e) => setPerms({ ...perms, [p.key]: e.target.checked })}
                />
                <span className="text-[12px]" style={{ color: C.ink }}>{p.label}</span>
              </label>
            ))}
          </div>

          {editing !== "other1" && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold" style={{ color: C.ink }}>パスワード</div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={roles[editing] ? "変更する場合のみ入力" : "新しいパスワード"}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: C.cream, color: C.ink }}
              />
              <div className="text-[10px] mt-1" style={{ color: C.mute }}>
                保存後は表示できません。控えを取ってから保存してください
              </div>
            </div>
          )}

          <button
            onClick={save}
            className="mt-3 w-full rounded-full py-2.5 text-sm font-bold"
            style={{ background: C.teal, color: "#fff" }}
          >
            {saved ? "✓ 保存しました" : "保存"}
          </button>

          {roles[editing] && editing !== "other1" && (
            <button
              onClick={async () => {
                if (!window.confirm(`${ROLE_LABEL[editing]}を削除しますか?`)) return;
                await onDelete(editing);
                setEditing(null);
              }}
              className="mt-2 w-full rounded-full py-2 text-[11px] font-semibold"
              style={{ background: C.cream, color: C.mute }}
            >
              この区分を削除する
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pb-10">
      <button onClick={onBack} className="mt-4 flex items-center gap-1 text-[12px] font-semibold" style={{ color: C.mute }}>
        <ChevronLeft size={14} /> 設定に戻る
      </button>
      <div className="mt-2 text-lg font-bold" style={{ color: C.ink }}>権限の設定</div>
      <div className="text-[11px] mt-1" style={{ color: C.mute }}>
        「その他1」はパスワードなしの通常の状態です。他は設定するとadminログインに現れます
      </div>

      <div className="mt-4 space-y-2">
        {["other1", "other2", "other3", "admin"].map((role) => (
          <button
            key={role}
            onClick={() => open(role)}
            className="w-full rounded-2xl p-4 flex items-center justify-between"
            style={{ background: C.paper, border: `1px solid ${C.line}` }}
          >
            <div className="text-left">
              <div className="text-[13px] font-bold" style={{ color: C.ink }}>{ROLE_LABEL[role]}</div>
              <div className="text-[10px] mt-0.5" style={{ color: C.mute }}>
                {roles[role]
                  ? PERMISSION_LIST.filter((p) => roles[role][p.key]).map((p) => p.label).join("・") || "できることなし"
                  : "未設定"}
              </div>
            </div>
            <ChevronRight size={15} style={{ color: C.mute }} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- SIGN OUT ----------------
// Lives at the very bottom of the settings tab rather than floating on every
// screen — signing out is rare, and having it always visible invited misclicks.
// label / note は呼び出し側から渡す。設定画面のものは店舗そのものの
// ログアウト、admin画面のものは権限だけを外す「権限ログアウト」で、
// 押した後どうなるかが違うため(2026-08-07)。
function SignOutButton({ onSignOut, label = "ログアウト", note }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
        <div className="text-sm font-bold" style={{ color: C.ink }}>{label}しますか?</div>
        <div className="text-[11px] mt-1" style={{ color: C.mute }}>
          {note || "次に使う時は、メールアドレスとパスワードでのログインが必要になります"}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setConfirming(false)}
            className="flex-1 rounded-full py-2.5 text-sm font-bold"
            style={{ background: C.cream, color: C.mute }}
          >
            キャンセル
          </button>
          <button
            onClick={onSignOut}
            className="flex-1 rounded-full py-2.5 text-sm font-bold"
            style={{ background: C.coral, color: "#fff" }}
          >
            {label}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="mt-4 w-full rounded-2xl py-3 text-sm font-bold"
      style={{ background: C.paper, border: `1px solid ${C.line}`, color: C.mute }}
    >
      {label}
    </button>
  );
}

function StoreView({ totalBalance, onCharge, onDeduct, rankingEnabled, setRankingEnabled, weatherEnabled, setWeatherEnabled, customers, pushIndex = {}, onRegisterCustomer, onFetchCustomerDetail, onSetCustomerStatus, onDeleteCustomer, onReissueCustomer, storeSettings = {}, onSaveStoreSettings, onSendPush, onSignOut, stats = {}, onLoadTransactions, weather = {}, onLookupArea, roles = {}, activeRole = "other1", permissions = {}, onVerifyRole, onExitRole, onSaveRole, onDeleteRole, onCancelTransaction, onExportAllData, branding = {}, onSaveBranding }) {
  const [tab, setTab] = useState("dashboard");
  const [showAggregate, setShowAggregate] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [showRoleEditor, setShowRoleEditor] = useState(false);
  const [exporting, setExporting] = useState(false);

  // 店舗が自分のパソコンに控えを取るための書き出し(2026-08-07)。運営側では
  // バックアップを持たない方針にしたので、控えが要る店舗はこれを使う。
  // 顧客一覧と取引履歴の2ファイルに分けて出す — CSVは1ファイルに違う形の
  // 表を混ぜられないため。
  const exportAllData = async () => {
    setExporting(true);
    try {
      const { customers: list, transactions } = await onExportAllData();
      const stamp = new Date().toISOString().slice(0, 10);

      downloadCsv(
        `picopay-customers-${stamp}.csv`,
        ["お客様ID", "お名前", "電話番号", "メール", "ポイント残高", "預かり残高", "状態"],
        list.map((c) => [c.id, c.name, c.phone, c.email, c.pointBalance, c.depositBalance, c.status])
      );

      downloadCsv(
        `picopay-transactions-${stamp}.csv`,
        [
          "日時",
          "お客様ID",
          "お名前",
          "種別",
          "お会計総額",
          "預かり金から充当",
          "ポイントから充当",
          "チャージ額",
          "付与ポイント",
          "摘要",
          "取消",
        ],
        transactions.map((r) => [
          formatDateTime(r.ts),
          r.customerId,
          r.customerName,
          r.kind === "payment" ? "お会計" : r.kind === "charge" ? "チャージ" : r.kind === "cancellation" ? "取消" : "ポイント付与",
          r.gross ?? "",
          r.depositUsed ?? "",
          r.pointUsed ?? "",
          r.cash ?? "",
          r.point ?? r.earned ?? "",
          r.summary || "",
          r.canceled ? "取消済み" : "",
        ])
      );
    } finally {
      setExporting(false);
    }
  };
  const [showRegister, setShowRegister] = useState(false);
  const [rainSent, setRainSent] = useState(false);
  const [rainSending, setRainSending] = useState(false);

  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const weatherActiveToday = storeSettings.weatherActiveDate === todayKey;
  // Written by the hourly job. Null until the first run of the day, in which
  // case the card falls back to the plain wording.
  const popToday = weather.date === todayKey && weather.currentPop != null ? weather.currentPop : null;
  const rainLikelyToday =
    popToday !== null && popToday >= Number(storeSettings.weatherRainThreshold ?? 80);

  // Turning the campaign on and announcing it are one action: a bonus nobody
  // heard about is pointless, and an announcement without the bonus behind it
  // is worse.
  const activateWeatherBonus = async () => {
    setRainSending(true);
    try {
      await onSaveStoreSettings({ weatherActiveDate: todayKey });
      const tokens = customers.flatMap((c) => pushIndex[c.id]?.tokens || []);
      if (tokens.length > 0) {
        const cap = (storeSettings.weatherCap ?? 10000).toLocaleString();
        const rate = clampRate(storeSettings.weatherRate ?? 10);
        await onSendPush(tokens, `今日は雨の日ボーナス☔ ¥${cap}までのチャージで${rate}%還元!`);
        setRainSent(true);
      }
    } finally {
      setRainSending(false);
    }
  };
  const [expandedId, setExpandedId] = useState(null);
  const [customerSearch, setCustomerSearch] = useState("");

  // Switching tabs (概況/決済/配信/設定) should always start at the top —
  // otherwise the page keeps whatever scroll position it had before.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [showAggregate]);

  if (showAdminLogin) {
    return (
      <AdminLogin
        roles={roles}
        activeRole={activeRole}
        onVerify={onVerifyRole}
        onExit={onExitRole}
        onSignOut={onSignOut}
        onBack={() => setShowAdminLogin(false)}
      />
    );
  }

  if (showRoleEditor) {
    return (
      <RoleEditor
        roles={roles}
        onSave={onSaveRole}
        onDelete={onDeleteRole}
        onBack={() => setShowRoleEditor(false)}
      />
    );
  }

  if (showAggregate) {
    return (
      <AggregateScreen
        stats={stats}
        customers={customers}
        onLoadTransactions={onLoadTransactions}
        onCancelTransaction={onCancelTransaction}
        canCancel={!!permissions.deleteCustomer}
        onBack={() => setShowAggregate(false)}
      />
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 pb-24">
      {tab === "dashboard" && (
        <>
      {/* Balance / compliance card */}
      <div
        className="mt-4 rounded-2xl p-5"
        style={{ background: C.tealDeep, color: "#fff" }}
      >
        {/* 預かり金(現金)のみ。ポイントは法的に関係ないので出さない。
            以前はここに合計の82%/18%を掛けた内訳を出していたが、実データ
            ではなく見た目だけの数字だったため削除した(2026-08-07)。 */}
        <div className="flex items-center justify-between">
          <span className="text-xs opacity-80">預かり残高(自家型・自店限定)</span>
          <ShieldCheck size={16} className="opacity-80" />
        </div>
        <div className="mt-2 text-3xl font-bold tracking-tight">
          ¥{totalBalance.toLocaleString()}
        </div>
        <div className="mt-3 flex items-center justify-between text-[11px] opacity-80">
          <span>基準日:3/31・9/30</span>
          <span>供託ライン ¥10,000,000 まで残り ¥{Math.max(0, 10000000 - totalBalance).toLocaleString()}</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-white/20 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, (totalBalance / 10000000) * 100)}%`, background: C.coral }}
          />
        </div>
      </div>

      {/* Quick stats */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          { icon: Users, label: "登録客数", value: customers.length },
          { icon: TrendingUp, label: "累計チャージ", value: `¥${(stats.cashTotal || 0).toLocaleString()}` },
          { icon: Gift, label: "累計ポイント発行", value: `P${(stats.pointTotal || 0).toLocaleString()}` },
        ].map((s, i) => (
          <div key={i} className="rounded-xl p-3" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
            <s.icon size={16} style={{ color: C.teal }} />
            <div className="mt-2 text-[11px]" style={{ color: C.mute }}>{s.label}</div>
            <div className="text-sm font-bold" style={{ color: C.ink }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Guerrilla campaign card — the "signature" element */}
      {weatherEnabled && (weatherActiveToday || rainLikelyToday) && (
        <div
          className="mt-4 rounded-2xl p-4 relative overflow-hidden"
          style={{ background: C.coralSoft }}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <Sparkles size={15} style={{ color: C.coral }} />
                <span className="text-xs font-bold" style={{ color: C.coral }}>ゲリラボーナス配信</span>
              </div>
              <div className="mt-1 text-sm font-bold" style={{ color: C.ink }}>
                {popToday === null
                  ? "雨の日ボーナスを発動しますか?"
                  : `本日は雨の確率が${popToday}%です`}
              </div>
              {weatherActiveToday && (
                <div className="text-[11px] font-bold" style={{ color: C.coral }}>
                  雨の日ボーナス実施中
                </div>
              )}
              <div className="text-[11px] mt-1" style={{ color: C.mute }}>
                ¥{(storeSettings.weatherCap ?? 10000).toLocaleString()}まで
                {clampRate(storeSettings.weatherRate ?? 10)}%ボーナス・プッシュ通知で一斉配信
              </div>
              <div className="text-[10px] mt-1" style={{ color: C.mute }}>
                発動した日は、通常の入金ボーナスに代えてこちらが付きます
              </div>
            </div>
          </div>
          {weatherActiveToday ? (
            <div className="mt-3 rounded-full py-2 text-center text-sm font-bold" style={{ background: "#fff", color: C.coral }}>
              ✓ 発動中{rainSent ? "・配信しました" : ""}
            </div>
          ) : (
            <button
              onClick={activateWeatherBonus}
              disabled={rainSending}
              className="mt-3 w-full rounded-full py-2 text-sm font-bold"
              style={{ background: C.coral, color: "#fff", opacity: rainSending ? 0.6 : 1 }}
            >
              {rainSending ? "発動中…" : "発動して一斉配信する"}
            </button>
          )}
        </div>
      )}

          {/* Customer list */}
          <div className="mt-5 flex items-center justify-between">
            <span className="text-sm font-bold" style={{ color: C.ink }}>顧客一覧</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => exportCustomersCsv(customers)}
                className="text-xs font-semibold"
                style={{ color: C.teal }}
              >
                CSV出力
              </button>
              <button
                onClick={() => setShowRegister((v) => !v)}
                className="text-xs font-semibold flex items-center gap-1"
                style={{ color: C.teal }}
              >
                <Plus size={13} /> {showRegister ? "閉じる" : "新規登録"}
              </button>
            </div>
          </div>

          {showRegister && (
            <CustomerRegistration
              onRegister={onRegisterCustomer}
              onDone={() => setShowRegister(false)}
              existingCustomers={customers}
            />
          )}

          <input
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            placeholder="名前・お客様ID・電話番号で検索"
            className="mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: C.cream, color: C.ink }}
          />

          <div className="mt-2 rounded-xl overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
            {customers.length === 0 && (
              <div className="px-3 py-4 text-center text-[12px]" style={{ background: C.paper, color: C.mute }}>
                まだ登録されたお客様がいません
              </div>
            )}
            {customers.length > 0 && (() => {
              const q = customerSearch.trim().toLowerCase();
              const filtered = customers
                .filter(
                  (c) =>
                    !q ||
                    (c.name || "").toLowerCase().includes(q) ||
                    (c.id || "").toLowerCase().includes(q) ||
                    (c.phone || "").toLowerCase().includes(q)
                )
                .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ja"));

              if (filtered.length === 0) {
                return (
                  <div className="px-3 py-4 text-center text-[12px]" style={{ background: C.paper, color: C.mute }}>
                    該当するお客様が見つかりません
                  </div>
                );
              }

              return filtered.map((c, i) => (
              <React.Fragment key={c.id}>
                <button
                  onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  className="w-full flex items-center justify-between px-3 py-3 text-left"
                  style={{ background: C.paper, borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}
                >
                  <div>
                    <div className="text-sm font-semibold" style={{ color: C.ink }}>
                      {rankingEnabled && c.rank && (
                        <span style={{ color: RANK_META[c.rank]?.color }}>
                          {RANK_META[c.rank]?.crown} {c.rank}
                        </span>
                      )}{rankingEnabled && c.rank ? " " : ""}{c.name}
                    </div>
                    <div className="text-[11px]" style={{ color: C.mute }}>お客様ID: {c.id}</div>
                  </div>
                  <div className="text-right flex items-center gap-1">
                    <div className="text-sm font-bold" style={{ color: C.teal }}>¥{c.balance.toLocaleString()}</div>
                    <ChevronRight
                      size={14}
                      style={{ color: C.mute, transform: expandedId === c.id ? "rotate(90deg)" : "none", transition: "transform .15s" }}
                    />
                  </div>
                </button>
                {expandedId === c.id && (
                  <CustomerDetailPanel
                    customerId={c.id}
                    onFetch={onFetchCustomerDetail}
                    permissions={permissions}
                    onSetStatus={onSetCustomerStatus}
                    onDeletePermanently={onDeleteCustomer}
                    onDeleted={() => setExpandedId(null)}
                    onReissue={onReissueCustomer}
                  />
                )}
              </React.Fragment>
              ));
            })()}
          </div>
        </>
      )}

      {tab === "settings" && (
        <>
          {/* 設定を触れる権限があるかどうかで、出すものを変える。オン/オフの
              切り替えは settingsFull を持つ人だけ。 */}
          {(permissions.settingsBasic || permissions.settingsFull) && (
            <>
              <PointSettings storeSettings={storeSettings} onSave={onSaveStoreSettings} />
              <RankSettings
                rankingEnabled={rankingEnabled}
                setRankingEnabled={permissions.settingsFull ? setRankingEnabled : null}
                storeSettings={storeSettings}
                onSave={onSaveStoreSettings}
              />
              <ReferralSettings storeSettings={storeSettings} onSave={onSaveStoreSettings} />
              <DepositBonusSettings storeSettings={storeSettings} onSave={onSaveStoreSettings} />
              <GachaSettings storeSettings={storeSettings} onSave={onSaveStoreSettings} />
              <SystemSafetySettings storeSettings={storeSettings} onSave={onSaveStoreSettings} />
              <WeatherCampaignSettings
                weatherEnabled={weatherEnabled}
                setWeatherEnabled={permissions.settingsFull ? setWeatherEnabled : null}
                storeSettings={storeSettings}
                onSave={onSaveStoreSettings}
                onLookupArea={onLookupArea}
              />
              <StoreBrandingSettings storeSettings={storeSettings} onSave={onSaveStoreSettings} branding={branding} onSaveBranding={onSaveBranding} />
              <IssuerInfoSettings storeSettings={storeSettings} onSave={onSaveStoreSettings} />
              <DepositExpirySettings storeSettings={storeSettings} onSave={onSaveStoreSettings} />
            </>
          )}

          <button
            onClick={() => setShowAdminLogin(true)}
            className="mt-4 w-full rounded-2xl py-3 text-sm font-bold flex items-center justify-center gap-1"
            style={{ background: C.paper, border: `1px solid ${C.line}`, color: C.teal }}
          >
            adminログイン
            {activeRole !== "other1" && (
              <span className="text-[10px] font-bold" style={{ color: C.coral }}>
                ({ROLE_LABEL[activeRole] || activeRole})
              </span>
            )}
            <ChevronRight size={15} />
          </button>

          {permissions.owner && (
            <button
              onClick={() => setShowRoleEditor(true)}
              className="mt-2 w-full rounded-2xl py-3 text-sm font-bold flex items-center justify-center gap-1"
              style={{ background: C.paper, border: `1px solid ${C.line}`, color: C.teal }}
            >
              権限の設定 <ChevronRight size={15} />
            </button>
          )}

          {permissions.aggregate && (
          <button
            onClick={() => setShowAggregate(true)}
            className="mt-4 w-full rounded-2xl py-3 text-sm font-bold flex items-center justify-center gap-1"
            style={{ background: C.paper, border: `1px solid ${C.line}`, color: C.teal }}
          >
            各種集計 <ChevronRight size={15} />
          </button>
          )}

          {permissions.aggregate && (
          <button
            onClick={exportAllData}
            disabled={exporting}
            className="mt-2 w-full rounded-2xl py-3 text-sm font-bold flex items-center justify-center gap-1"
            style={{ background: C.paper, border: `1px solid ${C.line}`, color: C.teal, opacity: exporting ? 0.6 : 1 }}
          >
            {exporting ? "書き出し中…" : "データを書き出す(CSV)"}
          </button>
          )}
          <SignOutButton onSignOut={onSignOut} />
        </>
      )}

      {tab === "pay" && <ChargeScreen onCharge={onCharge} onDeduct={onDeduct} />}

      {tab === "notify" && (
        <BroadcastPanel
          customers={customers}
          storeSettings={storeSettings}
          onSave={onSaveStoreSettings}
          onSendPush={onSendPush}
        />
      )}

      {/* Bottom nav */}
      <div
        className="fixed bottom-0 left-0 right-0"
        style={{ background: C.paper, borderTop: `1px solid ${C.line}` }}
      >
        <div className="max-w-md mx-auto grid grid-cols-4 text-center py-2">
          {[
            { key: "dashboard", icon: Store, label: "概況" },
            { key: "pay", icon: QrCode, label: "決済" },
            { key: "notify", icon: Bell, label: "配信" },
            { key: "settings", icon: Settings, label: "設定" },
          ].map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className="flex flex-col items-center gap-0.5">
              <t.icon size={18} style={{ color: tab === t.key ? C.teal : C.mute }} />
              <span className="text-[10px]" style={{ color: tab === t.key ? C.teal : C.mute }}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- CUSTOMER VIEW ----------------
function CustomerView({ pointBalance, depositBalance, cumulativeSpend = 0, customerName, onOpenTerms, bonusEligible, onUseBonusSpin, history, rankingEnabled, customerId, storeSettings = {}, branding = {}, notifyOptIn, onUpdateNotifyPrefs }) {
  const [showNotifySettings, setShowNotifySettings] = useState(false);
  const [notifyDraft, setNotifyDraft] = useState({
    push: notifyOptIn?.push || false,
  });
  const [notifySaved, setNotifySaved] = useState(false);
  const [showPushHistory, setShowPushHistory] = useState(false);
  const pushHistory = notifyOptIn?.pushHistory || [];

  const saveNotifyPrefs = async () => {
    await onUpdateNotifyPrefs(notifyDraft);
    setNotifySaved(true);
    setTimeout(() => setNotifySaved(false), 2000);
  };

  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [openDate, setOpenDate] = useState(null);

  // The QR code encodes a token that changes every 30 seconds, so a
  // screenshot or photo of the screen stops working shortly after — it has
  // to be the customer's live screen at the moment the store scans it.
  const ROTATE_MS = 30000;
  const [qrBucket, setQrBucket] = useState(Math.floor(Date.now() / ROTATE_MS));
  useEffect(() => {
    const id = setInterval(() => setQrBucket(Math.floor(Date.now() / ROTATE_MS)), 1000);
    return () => clearInterval(id);
  }, []);
  const qrValue = `PICOPAY:${customerId}:${qrBucket}`;
  const secondsLeft = ROTATE_MS / 1000 - (Math.floor(Date.now() / 1000) % (ROTATE_MS / 1000));

  const spin = async () => {
    if (!bonusEligible || !onUseBonusSpin) return;
    setSpinning(true);
    setResult(null);
    // The rate comes back from the server — deciding it here would let the
    // customer's own device pick its prize.
    const [rate] = await Promise.all([
      onUseBonusSpin(),
      new Promise((resolve) => setTimeout(resolve, 1400)),
    ]);
    setSpinning(false);
    setResult(rate ?? 0);
  };

  const usableTotal = pointBalance + depositBalance;

  // Use the store's saved rank tiers if they've configured any; otherwise
  // fall back to the built-in default silver/gold/platinum tiers.
  const effectiveRanks =
    storeSettings.rankTiers && storeSettings.rankTiers.length > 0 ? storeSettings.rankTiers : RANKS;

  // 会員ランクの判定に使う累計利用額。transact.js がお会計のたびに
  // 積んでいる実データ(2026-08-07)。以前はここが 68000 の固定値で、
  // 登録した瞬間から誰でもゴールドになっていた。
  const currentRankIdx = [...effectiveRanks].reverse().findIndex((r) => cumulativeSpend >= r.threshold);
  const currentRank = effectiveRanks[effectiveRanks.length - 1 - currentRankIdx];
  const nextRank = effectiveRanks[effectiveRanks.indexOf(currentRank) + 1];

  return (
    <div className="max-w-md mx-auto px-4 pb-10">
      {/* Rank banner */}
      {rankingEnabled && (
        <div
          className="mt-4 rounded-2xl p-4 flex items-center gap-3"
          style={{ background: C.paper, border: `1px solid ${RANK_META[currentRank.name].color}` }}
        >
          <div className="text-3xl">{RANK_META[currentRank.name].crown}</div>
          <div>
            {customerName && (
              <div className="text-[12px] font-semibold" style={{ color: C.ink }}>
                {customerName} 様
              </div>
            )}
            <div className="text-sm font-bold" style={{ color: RANK_META[currentRank.name].color }}>
              あなたは今{currentRank.name}会員!
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: C.mute }}>
              {nextRank
                ? `あと¥${(nextRank.threshold - cumulativeSpend).toLocaleString()}で${nextRank.name}会員です!`
                : "最高ランクです!"}
            </div>
          </div>
        </div>
      )}

      {/* Balance card */}
      <div
        className="mt-4 rounded-2xl p-5 text-center"
        style={{ background: C.teal, color: "#fff" }}
      >
        <div className="text-xs opacity-80">ご利用可能金額</div>
        <div className="text-4xl font-bold tracking-tight mt-1">¥{usableTotal.toLocaleString()}</div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-white/15 px-3 py-2">
            <div className="text-[10px] opacity-80">ポイント(ボーナス含む・先に使われます)</div>
            <div className="text-base font-bold">P{pointBalance.toLocaleString()}</div>
          </div>
          <div className="rounded-lg bg-white/15 px-3 py-2">
            <div className="text-[10px] opacity-80">預かり残高</div>
            <div className="text-base font-bold">¥{depositBalance.toLocaleString()}</div>
          </div>
        </div>
        <div className="mt-4 flex justify-center">
          <div className="bg-white rounded-xl p-3">
            <QRCodeSVG value={qrValue} size={112} level="M" />
          </div>
        </div>
        <div className="text-[11px] mt-2 opacity-80">
          お店の端末にこの画面をかざしてください({secondsLeft}秒ごとに更新)
        </div>
      </div>

      {/* Gacha */}
      {storeSettings.gachaEnabled !== false && (
      <div className="mt-4 rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
        <div className="flex items-center gap-2">
          <div
            className="h-7 w-7 rounded-full flex items-center justify-center overflow-hidden"
            style={{ background: C.coralSoft }}
          >
            <img src={PICO.logo} alt="ピコ" className="h-7 w-7 object-cover scale-125" />
          </div>
          <span className="text-sm font-bold" style={{ color: C.ink }}>ピコのボーナスガチャ</span>
        </div>

        <div className="mt-3 rounded-xl p-3 text-center" style={{ background: bonusEligible ? C.coralSoft : C.cream }}>
          {bonusEligible ? (
            <div className="flex items-center justify-center gap-2">
              <img src={PICO.bonusGet} alt="ボーナスGET" className="h-8 w-8 object-contain" />
              <div className="text-[12px] font-bold" style={{ color: C.coral }}>
                やったー!ガチャ一回回してね!
              </div>
            </div>
          ) : (
            <div className="text-[11px]" style={{ color: C.mute }}>
              ¥10,000以上のチャージでガチャに挑戦できます
            </div>
          )}
          <div className="mt-2 flex justify-center">
            <div
              className="h-14 w-14 rounded-full flex items-center justify-center text-xl font-bold transition-transform"
              style={{
                background: bonusEligible ? C.coral : C.line,
                color: bonusEligible ? "#fff" : C.mute,
                transform: spinning ? "rotate(360deg) scale(0.9)" : "rotate(0deg) scale(1)",
                transition: "transform 1.4s ease",
              }}
            >
              {spinning ? "?" : result ? `${result}%` : "?"}
            </div>
          </div>
          {result && !spinning && (
            <div className="mt-2 flex flex-col items-center gap-1">
              <img src={PICO.pointGet} alt="当たり" className="h-16 w-16 object-contain" />
              <div className="text-sm font-bold" style={{ color: C.coral }}>
                当たり!今回は+{result}%ボーナス 🎉
              </div>
            </div>
          )}
          <button
            onClick={spin}
            disabled={spinning || !bonusEligible}
            className="mt-3 w-full rounded-full py-2 text-sm font-bold"
            style={{
              background: bonusEligible ? C.ink : C.line,
              color: bonusEligible ? "#fff" : C.mute,
              opacity: spinning ? 0.6 : 1,
            }}
          >
            {spinning ? "回転中…" : bonusEligible ? "ガチャを回す" : "対象のチャージがありません"}
          </button>
        </div>
      </div>
      )}

      {/* History */}
      <div className="mt-4 flex items-center gap-2">
        <History size={16} style={{ color: C.teal }} />
        <span className="text-sm font-bold" style={{ color: C.ink }}>利用履歴</span>
      </div>
      <div className="mt-2 rounded-xl overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
        {history.map((day, i) => (
          <div key={day.id || i} style={{ borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
            <button
              onClick={() => setOpenDate(openDate === (day.id || i) ? null : day.id || i)}
              className="w-full flex items-center justify-between px-3 py-2.5"
              style={{ background: C.paper }}
            >
              <div className="text-left">
                <div className="text-sm" style={{ color: C.ink }}>{day.summary}</div>
                <div className="text-[11px]" style={{ color: C.mute }}>{day.date}</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm font-bold" style={{ color: day.total > 0 ? C.teal : C.ink }}>
                  {day.total > 0 ? "+" : ""}
                  {day.total.toLocaleString()}
                </div>
                <ChevronRight
                  size={14}
                  style={{ color: C.mute, transform: openDate === (day.id || i) ? "rotate(90deg)" : "none", transition: "transform .15s" }}
                />
              </div>
            </button>
            {openDate === (day.id || i) && (
              <div className="px-3 pb-3" style={{ background: C.cream }}>
                {day.items.map((it, j) => (
                  <div key={j} className="flex items-center justify-between py-1.5 text-xs" style={{ color: C.mute }}>
                    <span>{it.label}</span>
                    <span style={{ color: it.amount > 0 ? C.teal : C.ink, fontWeight: 600 }}>
                      {it.amount > 0 ? "+" : ""}
                      {it.amount.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Rank benefit table */}
      {rankingEnabled && (
        <div className="mt-5 rounded-xl overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
          <div className="px-3 py-2 text-[11px] font-bold" style={{ background: C.cream, color: C.ink }}>
            会員ランク特典
          </div>
          {effectiveRanks.map((r, i) => (
            <div
              key={r.name}
              className="flex items-center justify-between px-3 py-2"
              style={{ background: C.paper, borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}
            >
              <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: C.ink }}>
                <span>{RANK_META[r.name].crown}</span>
                <span>{r.name}</span>
                {r.name === currentRank.name && (
                  <span className="text-[10px] rounded-full px-1.5 py-0.5" style={{ background: C.coralSoft, color: C.coral }}>
                    現在
                  </span>
                )}
              </div>
              <div className="text-xs font-bold" style={{ color: C.teal }}>還元率 {r.rate}%</div>
            </div>
          ))}
        </div>
      )}
      {/* Referral program — share this customer's ID with a friend */}
      {storeSettings.referralEnabled && (
        <div className="mt-5 rounded-2xl p-4" style={{ background: C.coralSoft }}>
          <div className="text-sm font-bold" style={{ color: C.coral }}>お友達紹介</div>
          <div className="text-[11px] mt-1" style={{ color: C.ink }}>
            このIDをお友達に伝えて、登録時に入力してもらうと、お友達が初めてチャージした時にお二人ともポイントがもらえます
          </div>
          <div className="mt-2 rounded-lg bg-white px-3 py-2 text-center">
            <div className="text-[10px]" style={{ color: C.mute }}>あなたの紹介ID</div>
            <div className="text-sm font-bold tracking-wide" style={{ color: C.ink }}>{customerId}</div>
          </div>
        </div>
      )}

      {/* Notification preferences — collapsed by default */}
      <div className="mt-5 rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
        <button
          onClick={() => setShowNotifySettings((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3"
          style={{ background: C.paper }}
        >
          <span className="text-sm font-bold" style={{ color: C.ink }}>通知設定</span>
          <span className="text-[11px]" style={{ color: C.mute }}>{showNotifySettings ? "閉じる" : "設定する"}</span>
        </button>
        {showNotifySettings && (
          <div className="px-4 py-3" style={{ background: C.cream }}>
            <div className="text-[11px]" style={{ color: C.mute }}>
              お店からのお知らせを受け取る方法を選んでください(何も選ばなければ届きません)
            </div>

            <label className="mt-2 flex items-center justify-between text-[13px]" style={{ color: C.ink }}>
              <span>プッシュ通知を受け取る</span>
              <input
                type="checkbox"
                checked={notifyDraft.push}
                onChange={(e) => setNotifyDraft((d) => ({ ...d, push: e.target.checked }))}
              />
            </label>
            <div className="text-[10px] mt-0.5" style={{ color: C.mute }}>
              ホーム画面に追加しないとプッシュ通知は届きません
            </div>
            <button
              onClick={() => setShowPushHistory((v) => !v)}
              className="mt-1.5 text-[11px] font-semibold"
              style={{ color: C.teal }}
            >
              {showPushHistory ? "プッシュ通知履歴を閉じる" : "プッシュ通知履歴"}
            </button>
            {showPushHistory && (
              <div className="mt-1 rounded-lg overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
                {pushHistory.length === 0 && (
                  <div className="px-3 py-3 text-center text-[11px]" style={{ background: C.paper, color: C.mute }}>
                    まだ通知履歴がありません
                  </div>
                )}
                {pushHistory.map((h, i) => (
                  <div key={i} className="px-3 py-2 text-[11px]" style={{ background: C.paper, borderTop: i === 0 ? "none" : `1px solid ${C.line}`, color: C.ink }}>
                    <div style={{ color: C.mute }} className="text-[10px]">{h.date}</div>
                    {h.body}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={saveNotifyPrefs}
              className="mt-3 w-full rounded-full py-2 text-sm font-bold"
              style={{ background: C.teal, color: "#fff" }}
            >
              {notifySaved ? "✓ 確定しました" : "確定"}
            </button>
          </div>
        )}
      </div>

      {/* 発行者情報等(法定表示)。店舗が入力していない項目は表示自体を省く。
          運営はこの内容の中身に関与しない — 店舗が設定画面から入力したものを
          そのまま出すだけ。2026-08-06決定。 */}
      {(storeSettings.issuerName || storeSettings.usableStores || storeSettings.expiryPolicyText || storeSettings.complaintContact) && (
        <div className="mt-4 rounded-2xl p-3 text-[10px] leading-relaxed" style={{ background: C.paper, border: `1px solid ${C.line}`, color: C.mute }}>
          {storeSettings.issuerName && <div>発行者:{storeSettings.issuerName}</div>}
          {storeSettings.usableStores && <div>ご利用いただけるお店:{storeSettings.usableStores}</div>}
          {storeSettings.expiryPolicyText && <div>有効期限:{storeSettings.expiryPolicyText}</div>}
          {storeSettings.complaintContact && <div>苦情・相談窓口:{storeSettings.complaintContact}</div>}
        </div>
      )}

      {/* 利用規約はいつでも読めるようにしておく(2026-08-07)。押すと規約の
          画面になり、戻るボタンでここに戻る。 */}
      <button
        onClick={onOpenTerms}
        className="mt-3 w-full rounded-2xl py-3 text-[12px] font-semibold"
        style={{ background: C.paper, border: `1px solid ${C.line}`, color: C.ink }}
      >
        利用規約
      </button>
    </div>
  );
}

export { C, PICO, mockCustomers, RANK_META, RANKS, BRANDING_SIZES, StoreView, CustomerView };
