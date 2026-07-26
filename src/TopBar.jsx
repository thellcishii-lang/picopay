import React from "react";
import { C, PICO } from "./components.jsx";

export default function ModeTopBar({ mode, setMode }) {
  return (
    <div className="sticky top-0 z-10" style={{ background: C.paper, borderBottom: `1px solid ${C.line}` }}>
      <div className="max-w-md mx-auto px-4 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
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
              {mode === "store" ? "店舗用(この端末)" : "お客様用(この端末)"}
            </div>
          </div>
        </div>
        <div className="flex rounded-full p-0.5" style={{ background: C.cream }}>
          {[
            { key: "store", label: "店舗" },
            { key: "customer", label: "お客様" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setMode(t.key)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold transition"
              style={mode === t.key ? { background: C.teal, color: "#fff" } : { color: C.mute }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
