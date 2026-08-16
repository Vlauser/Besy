import React from "react";
import { Check, Loader2, X } from "lucide-react";

import { DURATION, EASE, SPRING, transition } from "../motion";
import { FALLBACK_GRADIENT, T, gradient } from "../theme";

export function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
      :root { color-scheme: light; }
      body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; overscroll-behavior: none; }
      .font-display { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; }
      .font-ui { font-family: 'Plus Jakarta Sans', sans-serif; }
      /* Кривые и длительности — из motion.js, одни на всё приложение.
         Разнобой в них и читается как «деревянно»: каждый элемент
         двигается по своим правилам, и целое не складывается. */
      @keyframes riseIn { from { opacity: 0; transform: translateY(10px);} to { opacity: 1; transform: translateY(0);} }
      .rise-in { animation: riseIn ${DURATION.screen}ms ${EASE}; }
      @keyframes popIn { from { opacity: 0; transform: scale(0.94);} to { opacity: 1; transform: scale(1);} }
      .pop-in { animation: popIn ${DURATION.sheet}ms ${SPRING}; }
      @keyframes slideUp { from { transform: translateY(100%);} to { transform: translateY(0);} }
      .slide-up { animation: slideUp ${DURATION.sheet}ms ${EASE}; }
      @keyframes pulseSoft { 0%,100% { opacity: 0.45; } 50% { opacity: 1; } }
      .pulse-soft { animation: pulseSoft 1.6s ease-in-out infinite; }

      /* Блик по главной кнопке. Медленный и редкий: частый превращается в
         мишуру, а один проход раз в несколько секунд читается как «дорого». */
      @keyframes sheen { 0% { transform: translateX(-120%) skewX(-18deg); } 60%,100% { transform: translateX(320%) skewX(-18deg); } }
      .sheen::after {
        content: ""; position: absolute; top: 0; bottom: 0; width: 38%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.42), transparent);
        animation: sheen 3.6s ${EASE} infinite; pointer-events: none;
      }

      /* Заготовка вместо пустоты: видно, что грузится, и что именно. */
      @keyframes shimmer { 0% { background-position: -180% 0; } 100% { background-position: 180% 0; } }
      .skeleton {
        background: linear-gradient(90deg, rgba(16,16,20,0.05) 25%, rgba(16,16,20,0.10) 37%, rgba(16,16,20,0.05) 63%);
        background-size: 220% 100%;
        animation: shimmer 1.4s linear infinite;
      }

      /* Смена вкладки: экран приходит со сдвигом, а не возникает рывком.
         Сдвиг — по направлению перехода: вкладка правее въезжает справа,
         левее — слева. Иначе движение спорит с тем, что человек нажал. */
      @keyframes screenIn { from { opacity: 0; transform: translateY(8px) scale(0.995); } to { opacity: 1; transform: none; } }
      .screen-in { animation: screenIn ${DURATION.screen}ms ${EASE}; }
      @keyframes screenInFwd { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }
      .screen-in-fwd { animation: screenInFwd ${DURATION.screen}ms ${EASE}; }
      @keyframes screenInBack { from { opacity: 0; transform: translateX(-16px); } to { opacity: 1; transform: none; } }
      .screen-in-back { animation: screenInBack ${DURATION.screen}ms ${EASE}; }

      /* Уважение к системной настройке: кому анимации мешают — тем их нет. */
      @media (prefers-reduced-motion: reduce) {
        .sheen::after, .skeleton { animation: none; }
        .screen-in, .screen-in-fwd, .screen-in-back, .rise-in, .pop-in, .slide-up { animation-duration: 1ms; }
      }
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

/** Серый прямоугольник на месте будущего содержимого.
 *
 *  Спиннер сообщает одно: «что-то происходит». Заготовка сообщает ещё и
 *  что придёт и сколько места займёт, поэтому экран не прыгает, когда
 *  данные доедут, и не выглядит подвисшим, пока они в пути.
 */
// Скругление отдельным параметром, а не классом: `rounded-full` в
// className не победил бы базовый `rounded-xl` — порядок решает таблица
// стилей, а не строка, и кружки выходили квадратами.
export function Skeleton({ className = "", rounded = "rounded-xl", style }) {
  return <div className={`skeleton ${rounded} ${className}`} style={style} />;
}

/** Колода: одна большая карточка и ряд кнопок под ней. */
export function DeckSkeleton() {
  return (
    <div className="flex flex-col flex-1 min-h-0 px-4 pt-3 pb-2">
      <Skeleton className="flex-1" rounded="rounded-3xl" style={{ minHeight: 320 }} />
      <div className="flex items-center justify-center gap-5 py-4">
        <Skeleton rounded="rounded-full" style={{ width: 52, height: 52 }} />
        <Skeleton rounded="rounded-full" style={{ width: 62, height: 62 }} />
        <Skeleton rounded="rounded-full" style={{ width: 52, height: 52 }} />
      </div>
    </div>
  );
}

/** Список людей: аватар и две строки текста. */
export function ListSkeleton({ rows = 6, className = "px-4 py-3" }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="flex-shrink-0" rounded="rounded-full" style={{ width: 52, height: 52 }} />
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-3.5" style={{ width: "42%" }} />
            <Skeleton className="h-3" style={{ width: "72%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Карточки событий: при `poster` сверху место под картинку. */
export function CardSkeleton({ rows = 3, poster = false, className = "px-4 py-3" }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="rounded-2xl overflow-hidden"
          style={{ background: T.surface, border: `1px solid ${T.line}` }}
        >
          {poster && <Skeleton rounded="rounded-none" style={{ height: 132 }} />}
          <div className="p-3.5 space-y-2.5">
            <Skeleton className="h-4" style={{ width: "64%" }} />
            <Skeleton className="h-3" style={{ width: "46%" }} />
            <Skeleton className="h-9" rounded="rounded-full" style={{ width: "38%" }} />
          </div>
        </div>
      ))}
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
    primary: {
      background: gradient.action,
      color: "#FFFFFF",
      border: "none",
      // Тень под кнопкой того же цвета, что и заливка: так она выглядит
      // источником света, а не наклейкой на фоне.
      boxShadow: `0 8px 20px -8px ${T.coralDeep}`,
    },
    secondary: { background: T.surface, color: T.ink, border: `1px solid ${T.line}` },
    ghost: { background: "transparent", color: T.coral, border: "none" },
    danger: { background: T.surface, color: T.danger, border: `1px solid ${T.line}` },
  }[variant];

  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`relative overflow-hidden w-full rounded-full py-3.5 font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.97] disabled:opacity-50 ${
        variant === "primary" && !disabled && !loading ? "sheen" : ""
      } ${className}`}
      style={{ transition: transition("transform, box-shadow, opacity"), ...styles, ...(props.style || {}) }}
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
          style={{ boxShadow: `0 0 0 2px ${src ? T.gold : T.line}`, transition: transition("box-shadow", DURATION.sheet) }}
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
          className="h-1 flex-1 rounded-full"
          style={{
            background: i <= index ? T.coral : T.line,
            minWidth: 12,
            transition: transition("background", DURATION.screen),
          }}
        />
      ))}
    </div>
  );
}
