import React, { useEffect, useRef, useState } from "react";

import { T } from "../theme";

/** Compatibility ring — the hero metric, animated from 0 on mount. */
export function CompatRing({ percent, size = 128, stroke = 9 }) {
  const [mounted, setMounted] = useState(false);
  const [display, setDisplay] = useState(0);
  const frame = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!mounted) return undefined;
    let start;
    function tick(timestamp) {
      if (!start) start = timestamp;
      const progress = Math.min(1, (timestamp - start) / 900);
      setDisplay(Math.round(progress * percent));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    }
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [mounted, percent]);

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - ((mounted ? percent : 0) / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 128 128">
        <circle cx="64" cy="64" r={radius} fill="none" stroke={T.line} strokeWidth={stroke} />
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke={T.coral}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: "stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)",
            transform: "rotate(-90deg)",
            transformOrigin: "64px 64px",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-bold" style={{ color: T.ink, fontSize: size * 0.24 }}>
          {display}%
        </span>
        <span style={{ color: T.muted, fontSize: Math.max(9, size * 0.08) }} className="uppercase tracking-wide">
          совпадение
        </span>
      </div>
    </div>
  );
}
