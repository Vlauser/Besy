import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

import { haptic } from "../lib/telegram";
import { T } from "../theme";

/**
 * Scratch-to-reveal engine.
 *
 * Reveal fires on the share of the cover actually erased, sampled from the
 * canvas alpha channel — not on how far the finger travelled. Scrubbing one
 * spot fast would otherwise beat the mechanic.
 */
export function useScratch(coverageThreshold, onDone) {
  const canvasRef = useRef(null);
  const [revealed, setRevealed] = useState(false);
  const [fading, setFading] = useState(false);
  const last = useRef(null);
  const done = useRef(false);
  const lastCheck = useRef(0);

  function paintCover(width, height, lines) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const grd = ctx.createLinearGradient(0, 0, width, height);
    grd.addColorStop(0, "#C7D0E6");
    grd.addColorStop(0.5, "#DCE3F4");
    grd.addColorStop(1, "#B6C1DA");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    for (let i = -height; i < width; i += 5) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + height, height);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(27,35,64,0.55)";
    ctx.textAlign = "center";
    ctx.font = "600 10px 'Plus Jakarta Sans', sans-serif";
    lines.forEach((line, index) =>
      ctx.fillText(line, width / 2, height / 2 + (index - (lines.length - 1) / 2) * 13)
    );
  }

  function toLocal(event) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function strokeSegment(from, to) {
    const ctx = canvasRef.current.getContext("2d", { willReadFrequently: true });
    ctx.globalCompositeOperation = "destination-out";
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const steps = Math.max(1, Math.ceil(distance / 3));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const cx = from.x + dx * t;
      const cy = from.y + dy * t;
      // Grainy, particle-based erase instead of a smooth brush — reads as
      // foil coming off rather than a rubber eraser.
      for (let i = 0; i < 5; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 6;
        ctx.globalAlpha = 0.5 + Math.random() * 0.5;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, 1 + Math.random() * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function clearedRatio() {
    const canvas = canvasRef.current;
    const { width, height } = canvas;
    if (!width || !height) return 0;
    const data = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    const grid = 18;
    let cleared = 0;
    let total = 0;
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        const px = Math.min(width - 1, Math.floor((gx + 0.5) * (width / grid)));
        const py = Math.min(height - 1, Math.floor((gy + 0.5) * (height / grid)));
        total++;
        if (data[(py * width + px) * 4 + 3] < 60) cleared++;
      }
    }
    return total ? cleared / total : 0;
  }

  function down(event) {
    if (done.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toLocal(event);
    last.current = point;
    strokeSegment(point, point);
    haptic.light();
  }

  function move(event) {
    if (!last.current || done.current) return;
    const point = toLocal(event);
    strokeSegment(last.current, point);
    last.current = point;

    // getImageData is the expensive part; 90ms is well under the time it
    // takes to erase a meaningful area.
    const now = performance.now();
    if (now - lastCheck.current < 90) return;
    lastCheck.current = now;

    if (clearedRatio() > coverageThreshold) {
      done.current = true;
      setFading(true);
      haptic.success();
      setTimeout(() => {
        setRevealed(true);
        onDone?.();
      }, 280);
    }
  }

  function up() {
    last.current = null;
  }

  return { canvasRef, revealed, fading, paintCover, down, move, up };
}

/** Scratch cover sized to its parent, rendered above `children`. */
export function ScratchCover({ lines = ["ПОТРИ", "КАРТУ"], threshold = 0.5, rounded = "1rem", onDone, children }) {
  const wrapRef = useRef(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const scratch = useScratch(threshold, onDone);

  useLayoutEffect(() => {
    const element = wrapRef.current;
    if (!element) return undefined;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setDims({ w: Math.round(rect.width), h: Math.round(rect.height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!scratch.revealed && dims.w && dims.h) scratch.paintCover(dims.w, dims.h, lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims.w, dims.h]);

  return (
    <div ref={wrapRef} className="relative" style={{ borderRadius: rounded, overflow: "hidden" }}>
      {children}
      {!scratch.revealed && dims.w > 0 && (
        <canvas
          ref={scratch.canvasRef}
          width={dims.w}
          height={dims.h}
          onPointerDown={scratch.down}
          onPointerMove={scratch.move}
          onPointerUp={scratch.up}
          onPointerLeave={scratch.up}
          className={`absolute inset-0 cursor-pointer touch-none transition-opacity duration-300 ${
            scratch.fading ? "opacity-0" : "opacity-100"
          }`}
        />
      )}
    </div>
  );
}

/** Round scratch used for the photo reveal moment inside a chat. */
export function ScratchPhoto({ size = 150, src, grad, onDone }) {
  const scratch = useScratch(0.5, onDone);
  useEffect(() => {
    scratch.paintCover(size, size, ["ПОТРИ", "чтобы открыть фото"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <div
        className="absolute inset-0 rounded-full overflow-hidden"
        style={{ background: grad, boxShadow: `0 0 0 3px ${T.gold}` }}
      >
        {src && <img src={src} alt="" className="w-full h-full object-cover" />}
      </div>
      {!scratch.revealed && (
        <canvas
          ref={scratch.canvasRef}
          width={size}
          height={size}
          onPointerDown={scratch.down}
          onPointerMove={scratch.move}
          onPointerUp={scratch.up}
          onPointerLeave={scratch.up}
          className={`absolute inset-0 rounded-full cursor-pointer touch-none transition-opacity duration-300 ${
            scratch.fading ? "opacity-0" : "opacity-100"
          }`}
        />
      )}
    </div>
  );
}
