import React from "react";
import { Check, Loader2, X } from "lucide-react";

import { FALLBACK_GRADIENT, T, gradient } from "../theme";

export function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
      :root { color-scheme: light; }
      body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; overscroll-behavior: none; }
      .font-display { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; }
      .font-ui { font-family: 'Plus Jakarta Sans', sans-serif; }
      @keyframes riseIn { from { opacity: 0; transform: translateY(10px);} to { opacity: 1; transform: translateY(0);} }
      .rise-in { animation: riseIn 300ms ease-out; }
      @keyframes popIn { from { opacity: 0; transform: scale(0.94);} to { opacity: 1; transform: scale(1);} }
      .pop-in { animation: popIn 240ms cubic-bezier(0.22,1,0.36,1); }
      @keyframes slideUp { from { transform: translateY(100%);} to { transform: translateY(0);} }
      .slide-up { animation: slideUp 260ms cubic-bezier(0.22,1,0.36,1); }
      @keyframes pulseSoft { 0%,100% { opacity: 0.45; } 50% { opacity: 1; } }
      .pulse-soft { animation: pulseSoft 1.6s ease-in-out infinite; }
      .no-scrollbar::-webkit-scrollbar { display: none; }
      .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    `}</style>
  );
}

export function Spinner({ size = 20, color = T.coral }) {
  return <Loader2 size={size} color={color} className="animate-spin" />;
}

export function Loading({ label = "Загрузка…" }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
      <Spinner size={26} />
      <p className="text-sm" style={{ color: T.muted }}>{label}</p>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center py-16">
      {Icon && (
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
          style={{ background: T.surfaceSoft }}
        >
          <Icon size={24} color={T.coral} />
        </div>
      )}
      <p className="font-display text-lg mb-1" style={{ color: T.ink }}>{title}</p>
      {hint && <p className="text-sm mb-5" style={{ color: T.muted }}>{hint}</p>}
      {action}
    </div>
  );
}

export function Button({ children, variant = "primary", disabled, loading, className = "", ...props }) {
  const styles = {
    primary: { background: gradient.action, color: "#FFFFFF", border: "none" },
    secondary: { background: T.surface, color: T.ink, border: `1px solid ${T.line}` },
    ghost: { background: "transparent", color: T.coral, border: "none" },
    danger: { background: T.surface, color: T.danger, border: `1px solid ${T.line}` },
  }[variant];

  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`w-full rounded-full py-3.5 font-semibold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all duration-150 disabled:opacity-50 ${className}`}
      style={{ ...styles, ...(props.style || {}) }}
    >
      {loading && <Spinner size={16} color={variant === "primary" ? "#fff" : T.coral} />}
      {children}
    </button>
  );
}

export function Pill({ children, tone = "coral" }) {
  const palette = {
    coral: { background: "#E1EBFF", color: T.coralDeep },
    gold: { background: T.goldSoft, color: T.gold },
    muted: { background: T.surfaceSoft, color: T.muted },
    success: { background: "#DFF5EC", color: T.success },
  }[tone];
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={palette}>
      {children}
    </span>
  );
}

/**
 * Avatar. When `src` is absent the gradient placeholder is shown — that is
 * the locked state, and there is deliberately no blurred real image behind
 * it, because a CSS blur can be removed in devtools.
 */
export function Avatar({ src, grad = FALLBACK_GRADIENT, size = 56, verified, ring = true, online }) {
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      {ring && (
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ boxShadow: `0 0 0 2px ${src ? T.gold : T.line}`, transition: "box-shadow 400ms ease" }}
        />
      )}
      <div className="w-full h-full rounded-full overflow-hidden" style={{ background: grad }}>
        {src && <img src={src} alt="" className="w-full h-full object-cover" />}
      </div>
      {verified && (
        <div
          className="absolute rounded-full flex items-center justify-center"
          style={{
            width: Math.max(16, size * 0.32),
            height: Math.max(16, size * 0.32),
            right: -2,
            bottom: -2,
            background: T.coral,
            border: "2px solid #FFFFFF",
          }}
        >
          <Check size={Math.max(9, size * 0.18)} color="#FFFFFF" strokeWidth={3} />
        </div>
      )}
      {online && !verified && (
        <div
          className="absolute rounded-full"
          style={{
            width: Math.max(10, size * 0.22),
            height: Math.max(10, size * 0.22),
            right: 0,
            bottom: 0,
            background: T.success,
            border: "2px solid #FFFFFF",
          }}
        />
      )}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(20,28,56,0.45)" }} onClick={onClose}>
      <div
        className="slide-up w-full max-w-md rounded-t-3xl overflow-hidden"
        style={{ background: T.surface, maxHeight: "88vh" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3" style={{ borderBottom: `1px solid ${T.line}` }}>
          <span className="font-display text-base" style={{ color: T.ink }}>{title}</span>
          <button onClick={onClose} className="p-1 rounded-full active:scale-90 transition-transform">
            <X size={18} color={T.muted} />
          </button>
        </div>
        <div className="overflow-y-auto no-scrollbar" style={{ maxHeight: "76vh" }}>{children}</div>
      </div>
    </div>
  );
}

export function Toast({ message, tone = "error", onDone }) {
  React.useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(onDone, 3200);
    return () => clearTimeout(timer);
  }, [message, onDone]);

  if (!message) return null;
  const background = tone === "error" ? T.danger : T.ink;
  return (
    <div className="fixed left-0 right-0 flex justify-center px-4 z-[60]" style={{ bottom: 88 }}>
      <div className="pop-in rounded-2xl px-4 py-2.5 text-sm text-white max-w-sm text-center" style={{ background }}>
        {message}
      </div>
    </div>
  );
}

export function ProgressDots({ total, index }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="h-1 flex-1 rounded-full transition-colors duration-300"
          style={{ background: i <= index ? T.coral : T.line, minWidth: 12 }}
        />
      ))}
    </div>
  );
}
