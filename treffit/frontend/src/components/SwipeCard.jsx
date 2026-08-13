import React, { useRef, useState } from "react";
import { Check, Flag, MapPin, Star } from "lucide-react";

import { mediaUrl } from "../api/client";
import { haptic } from "../lib/telegram";
import { FALLBACK_GRADIENT, T } from "../theme";

const SWIPE_DISTANCE = 110;
const MAX_ROTATION = 14;

/**
 * A draggable profile card.
 *
 * Only the top card listens for pointer events; the ones behind are static
 * so the stack cannot be dragged by accident.
 */
export function SwipeCard({ candidate, onDecide, interactive = true, depth = 0, blindMode }) {
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [leaving, setLeaving] = useState(null);
  const origin = useRef(null);
  const passedThreshold = useRef(false);

  const photo = candidate.photos?.[0];
  const photoSrc = photo?.url ? mediaUrl(photo.url) : null;
  const grad = photo?.gradient || FALLBACK_GRADIENT;

  function begin(event) {
    if (!interactive || leaving) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = { x: event.clientX, y: event.clientY };
  }

  function move(event) {
    if (!origin.current) return;
    const x = event.clientX - origin.current.x;
    const y = event.clientY - origin.current.y;
    setDrag({ x, y });
    const crossed = Math.abs(x) > SWIPE_DISTANCE;
    if (crossed !== passedThreshold.current) {
      passedThreshold.current = crossed;
      if (crossed) haptic.light();
    }
  }

  function end() {
    if (!origin.current) return;
    origin.current = null;
    passedThreshold.current = false;
    if (Math.abs(drag.x) > SWIPE_DISTANCE) {
      fly(drag.x > 0 ? "like" : "pass");
    } else {
      setDrag({ x: 0, y: 0 });
    }
  }

  function fly(action) {
    setLeaving(action);
    haptic.medium();
    // Let the exit animation finish before the parent drops the card.
    setTimeout(() => onDecide(action), 240);
  }

  const rotation = Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, drag.x / 12));
  const likeOpacity = Math.min(1, Math.max(0, drag.x / SWIPE_DISTANCE));
  const passOpacity = Math.min(1, Math.max(0, -drag.x / SWIPE_DISTANCE));

  const exitTransform = {
    like: "translateX(140%) rotate(22deg)",
    pass: "translateX(-140%) rotate(-22deg)",
    superlike: "translateY(-140%) scale(0.9)",
  }[leaving];

  return (
    <div
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      className="absolute inset-0 rounded-3xl overflow-hidden select-none"
      style={{
        touchAction: "none",
        background: T.surface,
        boxShadow: "0 20px 46px -22px rgba(30,40,90,0.45)",
        transform:
          exitTransform ||
          `translate(${drag.x}px, ${drag.y * 0.35}px) rotate(${rotation}deg) scale(${1 - depth * 0.04}) translateY(${depth * 10}px)`,
        transition: origin.current ? "none" : "transform 280ms cubic-bezier(0.22,1,0.36,1)",
        opacity: leaving ? 0 : 1,
        zIndex: 10 - depth,
        cursor: interactive ? "grab" : "default",
      }}
    >
      <div className="relative w-full h-full" style={{ background: grad }}>
        {photoSrc && <img src={photoSrc} alt="" className="w-full h-full object-cover" draggable={false} />}

        {!photoSrc && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
            <div
              className="rounded-full px-3 py-1 text-xs font-bold mb-3"
              style={{ background: "rgba(255,255,255,0.9)", color: T.gold }}
            >
              {blindMode ? "ФОТО СКРЫТО" : "БЕЗ ФОТО"}
            </div>
            {blindMode && (
              <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.95)" }}>
                Откроется после трёх ваших сообщений в чате
              </p>
            )}
          </div>
        )}

        <div
          className="absolute inset-x-0 bottom-0 pt-16 pb-4 px-4"
          style={{ background: "linear-gradient(to top, rgba(12,18,42,0.86), rgba(12,18,42,0))" }}
        >
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="font-display text-2xl text-white truncate">
                  {candidate.first_name}
                  {candidate.age ? `, ${candidate.age}` : ""}
                </h3>
                {candidate.is_verified && (
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: T.coral }}
                  >
                    <Check size={11} color="#fff" strokeWidth={3} />
                  </span>
                )}
              </div>
              {candidate.is_online && (
                <p className="text-xs mt-0.5" style={{ color: "#8BE8C4" }}>сейчас онлайн</p>
              )}
            </div>
            <div
              className="rounded-full px-3 py-1.5 text-sm font-bold flex-shrink-0"
              style={{ background: T.coral, color: "#fff" }}
            >
              {candidate.compatibility_pct}%
            </div>
          </div>

          {candidate.bio && (
            <p className="text-sm mt-2 line-clamp-2" style={{ color: "rgba(255,255,255,0.85)" }}>
              {candidate.bio}
            </p>
          )}

          {candidate.shared_flags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {candidate.shared_flags.slice(0, 2).map((flag) => (
                <span
                  key={flag}
                  className="flex items-center gap-1 rounded-full px-2 py-1 text-xs"
                  style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }}
                >
                  <Flag size={10} />
                  {flag}
                </span>
              ))}
            </div>
          )}

          {candidate.event && (
            <div className="flex items-center gap-1.5 mt-2">
              <MapPin size={12} color="#fff" />
              <span className="text-xs truncate" style={{ color: "rgba(255,255,255,0.9)" }}>
                {candidate.event.title}
              </span>
            </div>
          )}
        </div>

        <Stamp label="НРАВИТСЯ" color={T.success} rotate={-14} opacity={likeOpacity} side="left" />
        <Stamp label="ПРОПУСК" color={T.danger} rotate={14} opacity={passOpacity} side="right" />
      </div>
    </div>
  );
}

function Stamp({ label, color, rotate, opacity, side }) {
  return (
    <div
      className="absolute top-8 px-3 py-1.5 rounded-xl font-display text-lg pointer-events-none"
      style={{
        [side]: 20,
        color,
        border: `3px solid ${color}`,
        transform: `rotate(${rotate}deg)`,
        opacity,
        background: "rgba(255,255,255,0.9)",
        transition: "opacity 100ms linear",
      }}
    >
      {label}
    </div>
  );
}

export function SwipeControls({ onPass, onSuperlike, onLike, disabled }) {
  const buttons = [
    { key: "pass", icon: "✕", onClick: onPass, color: T.danger, size: 56 },
    { key: "super", icon: <Star size={22} fill={T.gold} color={T.gold} />, onClick: onSuperlike, color: T.gold, size: 48 },
    { key: "like", icon: "♥", onClick: onLike, color: T.coral, size: 56 },
  ];
  return (
    <div className="flex items-center justify-center gap-5 py-4">
      {buttons.map((button) => (
        <button
          key={button.key}
          onClick={button.onClick}
          disabled={disabled}
          className="rounded-full flex items-center justify-center active:scale-90 transition-transform duration-150 disabled:opacity-40"
          style={{
            width: button.size,
            height: button.size,
            background: T.surface,
            border: `1px solid ${T.line}`,
            boxShadow: "0 8px 18px -10px rgba(30,40,90,0.4)",
            color: button.color,
            fontSize: button.size * 0.42,
            lineHeight: 1,
          }}
        >
          {button.icon}
        </button>
      ))}
    </div>
  );
}
