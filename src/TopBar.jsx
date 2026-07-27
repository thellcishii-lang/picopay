import React from "react";
import { C, PICO } from "./components.jsx";

export default function ModeTopBar({ mode }) {
  return (
    <div className="sticky top-0 z-10" style={{ background: C.paper, borderBottom: `1px solid ${C.line}` }}>
      <div className="max-w-md mx-auto px-4 pt-4 pb-3 flex items-center gap-2">
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
      </div>
    </div>
  );
}
