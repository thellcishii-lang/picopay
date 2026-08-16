import React from "react";
import { C, PICO, BRANDING_SIZES, PICO_PLACEHOLDER, resolveBrandImage } from "./components.jsx";

export default function ModeTopBar({ mode, storeSettings = {}, branding = {}, loaded = true }) {
  const brandMode = storeSettings.brandMode || "default";
  const fontFamily =
    storeSettings.storeNameFont === "mincho"
      ? "'Hiragino Mincho ProN', serif"
      : "'Hiragino Sans', sans-serif";
  const fontWeight = storeSettings.storeNameWeight === "bold" ? 700 : 500;
  const logo = resolveBrandImage(branding.logoImage, PICO_PLACEHOLDER.logo);
  const icon = resolveBrandImage(branding.iconImage, PICO_PLACEHOLDER.icon);

  // 店舗の設定が読み込めるまでは中身を出さない(2026-08-07)。中身は
  // 「読み込み中…」で待っているのにヘッダーだけ先に描かれるため、既定の
  // PicoPay のロゴと名前が一瞬出てから店舗のものに差し替わっていた。
  // 枠だけ同じ高さで確保しておき、揃ってから一度に出す。
  if (!loaded) {
    return (
      <div className="sticky top-0 z-10" style={{ background: C.paper, borderBottom: `1px solid ${C.line}` }}>
        <div className="max-w-md mx-auto px-4 pt-4 pb-3 flex items-center gap-2">
          <div className="h-9" />
        </div>
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-10" style={{ background: C.paper, borderBottom: `1px solid ${C.line}` }}>
      <div className="max-w-md mx-auto px-4 pt-4 pb-3 flex items-center gap-2">
        {brandMode === "logo" && logo ? (
          <img
            src={logo}
            alt="店舗ロゴ"
            style={{ height: BRANDING_SIZES.logoHeight, maxWidth: BRANDING_SIZES.logoWidth, objectFit: "contain" }}
          />
        ) : brandMode === "iconName" && icon && storeSettings.storeName ? (
          <>
            <div
              className="h-9 w-9 overflow-hidden shrink-0"
              style={{
                borderRadius: storeSettings.iconShape === "square" ? 10 : 9999,
                background: C.coralSoft,
              }}
            >
              <img src={icon} alt={storeSettings.storeName} className="h-9 w-9 object-cover" />
            </div>
            <div
              className="text-[15px] leading-none"
              style={{ color: C.ink, fontFamily, fontWeight }}
            >
              {storeSettings.storeName}
            </div>
          </>
        ) : (
          <>
            <div
              className="h-9 w-9 rounded-full flex items-center justify-center overflow-hidden"
              style={{ background: C.coralSoft }}
            >
              <img src={PICO.logo} alt="ピコ" className="h-9 w-9 object-cover scale-125" />
            </div>
            <div>
              <div className="text-[15px] font-bold leading-none" style={{ color: C.ink }}>
                PicoPay
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: C.mute }}>
                {mode === "store" ? "店舗用" : "ピッと、トクする毎日を。"}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
