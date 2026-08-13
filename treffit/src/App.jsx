import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import {
  ChevronLeft,
  X,
  Heart,
  Send,
  Sparkles,
  Radio,
  MapPin,
  Home,
  LayoutGrid,
  MessageCircle,
  User,
  Flag,
  Check,
} from "lucide-react";

const T = {
  bg: "#F3F6FD",
  surface: "#FFFFFF",
  surfaceSoft: "#EAF0FE",
  ink: "#1B2340",
  muted: "#8992A8",
  gold: "#2A3B8F",
  goldSoft: "#D7E1FA",
  coral: "#3D6BFF",
  coralDeep: "#2748D9",
  lavender: "#6E85E8",
  line: "#E1E7FA",
};

const TEST_CARDS = [
  { id: 1, q: "Пятница вечером", left: "Вечеринка", right: "Плед и сериал" },
  { id: 2, q: "Отпуск", left: "Спонтанный трип", right: "План по часам" },
  { id: 3, q: "Конфликт", left: "Обсудить сразу", right: "Сначала остыть" },
  { id: 4, q: "Первое свидание", left: "Кофе днём", right: "Бар вечером" },
  { id: 5, q: "Идеальные выходные", left: "Город", right: "Природа" },
  { id: 6, q: "Юмор", left: "Чёрный", right: "Добрый" },
];

const MATCHES = [
  { id: 1, name: "Аня, 26", percent: 87, event: "Концерт в Tele-Club — сегодня", live: true,
    grad: "linear-gradient(135deg,#8FB8FF,#3D6BFF)",
    opener: "Привет! Увидела, что ты тоже идёшь на концерт сегодня 👀",
    flags: ["Оба любят живую музыку", "Совпали на «вечеринка в пятницу»"] },
  { id: 2, name: "Соня, 24", percent: 91, event: "Выставка граффити — суббота", live: false,
    grad: "linear-gradient(135deg,#B9C6FF,#6E85E8)",
    opener: "Привет! Судя по тесту, ты тоже за спонтанные трипы 😄",
    flags: ["Оба выбрали спонтанные трипы", "Совпадение по юмору"] },
  { id: 3, name: "Игорь, 29", percent: 74, event: null, live: false,
    grad: "linear-gradient(135deg,#A9C6FF,#2A3B8F)",
    opener: "Привет! Плед и сериал — это по мне, а у тебя?",
    flags: ["Оба за плед и сериал", "Похожий взгляд на конфликты"] },
  { id: 4, name: "Дима, 31", percent: 68, event: null, live: false,
    grad: "linear-gradient(135deg,#B7CBFF,#5B7FE8)",
    opener: "Привет :) чёрный юмор — это про нас, кажется",
    flags: ["Общий чёрный юмор", "Оба выбрали природу на выходных"] },
];

const REPLIES = ["О, расскажи больше", "Го на следующей неделе?", "Хах, звучит как я", "Согласен(на) на все сто"];
const AUTO_REPLIES = ["Ахах, узнаю себя", "О, а ты откуда?", "Мне нравится ход мыслей", "Договорились"];
const REVEAL_THRESHOLD = 3;

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
      .font-display { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; }
      .font-ui { font-family: 'Plus Jakarta Sans', sans-serif; }
      @keyframes twinkle { 0% { transform: translateY(0) scale(0.4); opacity: 1; } 100% { transform: translateY(-26px) scale(1); opacity: 0; } }
      .twinkle-dot { animation: twinkle 700ms ease-out forwards; }
      @keyframes driftSlow { 0%,100% { transform: translateY(0px);} 50% { transform: translateY(-10px);} }
      .drift-slow { animation: driftSlow 6s ease-in-out infinite; }
      @keyframes pulseSoft { 0%,100% { opacity: 0.45; } 50% { opacity: 1; } }
      .pulse-soft { animation: pulseSoft 2s ease-in-out infinite; }
      @keyframes riseIn { from { opacity: 0; transform: translateY(10px);} to { opacity: 1; transform: translateY(0);} }
      .rise-in { animation: riseIn 320ms ease-out; }
      @keyframes popIn { from { opacity: 0; transform: scale(0.96);} to { opacity: 1; transform: scale(1);} }
      .pop-in { animation: popIn 250ms ease-out; }
    `}</style>
  );
}

/* ---------------- shared scratch engine ---------------- */
function useScratch(coverageThreshold, onDone) {
  const canvasRef = useRef(null);
  const [revealed, setRevealed] = useState(false);
  const [fading, setFading] = useState(false);
  const [particles, setParticles] = useState([]);
  const last = useRef(null);
  const pid = useRef(0);
  const checking = useRef(false);

  function paintCover(w, h, lines) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const grd = ctx.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, "#C7D0E6");
    grd.addColorStop(0.5, "#DCE3F4");
    grd.addColorStop(1, "#B6C1DA");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    for (let i = -h; i < w; i += 5) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + h, h);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(27,35,64,0.55)";
    ctx.textAlign = "center";
    ctx.font = "600 10px 'Plus Jakarta Sans', sans-serif";
    lines.forEach((line, i) => ctx.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 13));
  }

  function toLocal(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function strokeSegment(from, to) {
    const ctx = canvasRef.current.getContext("2d");
    ctx.globalCompositeOperation = "destination-out";
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const steps = Math.max(1, Math.ceil(dist / 3));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = from.x + dx * t;
      const cy = from.y + dy * t;
      for (let i = 0; i < 5; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.random() * 6;
        const gx = cx + Math.cos(ang) * rad;
        const gy = cy + Math.sin(ang) * rad;
        const gr = 1 + Math.random() * 2.2;
        ctx.globalAlpha = 0.5 + Math.random() * 0.5;
        ctx.beginPath();
        ctx.arc(gx, gy, gr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  // Real cleared-area check: samples the canvas alpha channel on a coarse
  // grid, so reveal only fires once the cover is actually mostly gone —
  // not just after enough finger travel.
  function clearedRatio() {
    const canvas = canvasRef.current;
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return 0;
    const data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    const grid = 18;
    let cleared = 0, total = 0;
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        const px = Math.min(w - 1, Math.floor((gx + 0.5) * (w / grid)));
        const py = Math.min(h - 1, Math.floor((gy + 0.5) * (h / grid)));
        const alpha = data[(py * w + px) * 4 + 3];
        total++;
        if (alpha < 60) cleared++;
      }
    }
    return total ? cleared / total : 0;
  }
  function down(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toLocal(e);
    last.current = p;
    strokeSegment(p, p);
  }
  function move(e) {
    if (!last.current || revealed || fading || checking.current) return;
    const p = toLocal(e);
    strokeSegment(last.current, p);
    last.current = p;
    checking.current = true;
    if (clearedRatio() > coverageThreshold) {
      setFading(true);
      setTimeout(() => {
        setRevealed(true);
        onDone && onDone();
      }, 280);
    }
    checking.current = false;
  }
  function up() { last.current = null; }

  return { canvasRef, revealed, fading, particles, setParticles, paintCover, down, move, up };
}

function ScratchParticles({ particles, onRemove }) {
  return particles.map((p) => (
    <span
      key={p.id}
      className="twinkle-dot absolute rounded-full pointer-events-none"
      style={{ left: p.x - 2, top: p.y - 2, width: 4, height: 4, background: T.gold }}
      onAnimationEnd={() => onRemove(p.id)}
    />
  ));
}

function PhoneChrome({ title, onBack, footer, children }) {
  return (
    <div className="relative w-full max-w-sm mx-auto rounded-3xl overflow-hidden flex flex-col font-ui"
      style={{ height: 720, background: T.bg, boxShadow: "0 30px 70px -22px rgba(30,40,90,0.4), 0 0 0 1px rgba(61,107,255,0.12)" }}>
      <div className="flex justify-center pt-2 pb-1" style={{ background: T.surface }}>
        <div className="w-10 h-1 rounded-full" style={{ background: T.line }} />
      </div>
      <div className="flex items-center gap-2 px-4 py-3.5" style={{ background: T.surface, borderBottom: `1px solid ${T.line}` }}>
        {onBack ? (
          <button onClick={onBack} className="p-1 -ml-1 rounded-full active:scale-90 transition-transform">
            <ChevronLeft size={20} color={T.ink} />
          </button>
        ) : (
          <span className="font-ui font-extrabold text-xs tracking-widest" style={{ color: T.coral }}>TREFFIT</span>
        )}
        <span className="font-display font-semibold text-base" style={{ color: T.ink }}>{title}</span>
      </div>
      <div className="flex-1 overflow-y-auto relative" style={{ background: T.bg }}>{children}</div>
      {footer}
    </div>
  );
}

function Avatar({ grad, size = 56, revealed, ring = true }) {
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      {ring && (
        <div className="absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${revealed ? T.gold : T.line}`, transition: "box-shadow 400ms ease" }} />
      )}
      <div className="w-full h-full rounded-full overflow-hidden">
        <div className={`w-full h-full transition-all duration-500 ease-out ${revealed ? "blur-none" : "blur-md"}`} style={{ background: grad }} />
      </div>
      {revealed && (
        <div
          className="absolute rounded-full flex items-center justify-center"
          style={{ width: Math.max(16, size * 0.32), height: Math.max(16, size * 0.32), right: -2, bottom: -2, background: T.coral, border: "2px solid #FFFFFF" }}
        >
          <Check size={Math.max(9, size * 0.18)} color="#FFFFFF" strokeWidth={3} />
        </div>
      )}
    </div>
  );
}

function Pill({ children, tone = "coral" }) {
  const bg = tone === "gold" ? T.goldSoft : "#E1EBFF";
  const color = tone === "gold" ? "#2A3B8F" : T.coralDeep;
  return <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: bg, color }}>{children}</span>;
}

/* ---------------- SCRATCH: photo reveal in chat ---------------- */
function ScratchPhoto({ grad, onDone }) {
  const s = useScratch(0.55, onDone);
  const SIZE = 140;
  useEffect(() => { s.paintCover(SIZE, SIZE, ["ПОТРИ", "чтобы открыть фото"]); }, []);

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
      <div className="absolute inset-0 rounded-full overflow-hidden" style={{ background: grad, boxShadow: `0 0 0 3px ${T.gold}` }} />
      {!s.revealed && (
        <canvas ref={s.canvasRef} width={SIZE} height={SIZE}
          onPointerDown={s.down} onPointerMove={s.move} onPointerUp={s.up} onPointerLeave={s.up}
          className={`absolute inset-0 rounded-full cursor-pointer touch-none transition-opacity duration-300 ${s.fading ? "opacity-0" : "opacity-100"}`} />
      )}
      
    </div>
  );
}

/* ---------------- SCRATCH: match card in the pack ---------------- */
function ScratchMatchCard({ match, revealed, onReveal, onOpen }) {
  const wrapRef = useRef(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const s = useScratch(0.55, () => onReveal(match.id));
  const isRevealed = revealed || s.revealed;

  useLayoutEffect(() => {
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setDims({ w: Math.round(r.width), h: Math.round(r.height) });
    }
  }, []);
  useLayoutEffect(() => {
    if (!isRevealed && dims.w && dims.h) s.paintCover(dims.w, dims.h, ["ПОТРИ", "КАРТУ"]);
    // eslint-disable-next-line
  }, [dims.w, dims.h]);

  return (
    <div ref={wrapRef} className="relative rounded-2xl overflow-hidden" style={{ boxShadow: "0 8px 20px -14px rgba(30,40,90,0.28)" }}>
      <button
        onClick={() => isRevealed && onOpen(match.id)}
        className="w-full flex flex-col items-center text-center p-3.5 active:scale-95 transition-transform duration-150"
        style={{ background: T.surface, border: `1px solid ${T.line}`, minHeight: 178 }}
      >
        <Avatar grad={match.grad} size={64} revealed={false} />
        <span className="text-sm font-semibold mt-2" style={{ color: T.ink }}>{match.name}</span>
        <Pill>{match.percent}% совпадение</Pill>
        {match.event && (
          <div className="flex items-center gap-1 mt-2">
            <MapPin size={10} color={T.gold} />
            <span className="text-xs truncate" style={{ color: T.muted }}>{match.event.split(" — ")[0]}</span>
          </div>
        )}
      </button>
      {!isRevealed && dims.w > 0 && (
        <canvas ref={s.canvasRef} width={dims.w} height={dims.h}
          onPointerDown={s.down} onPointerMove={s.move} onPointerUp={s.up} onPointerLeave={s.up}
          className={`absolute inset-0 cursor-pointer touch-none transition-opacity duration-300 ${s.fading ? "opacity-0" : "opacity-100"}`} />
      )}
      
    </div>
  );
}

/* ---------------- ANIMATED COMPAT RING ---------------- */
function CompatRing({ percent, size = 128 }) {
  const [mounted, setMounted] = useState(false);
  const [display, setDisplay] = useState(0);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 80); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!mounted) return;
    let raf, start;
    function tick(ts) {
      if (!start) start = ts;
      const t = Math.min(1, (ts - start) / 900);
      setDisplay(Math.round(t * percent));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mounted, percent]);

  const r = 54, c = 2 * Math.PI * r;
  const offset = c - (mounted ? percent : 0) / 100 * c;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 128 128">
        <circle cx="64" cy="64" r={r} fill="none" stroke={T.line} strokeWidth="9" />
        <circle cx="64" cy="64" r={r} fill="none" stroke={T.coral} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)", transform: "rotate(-90deg)", transformOrigin: "64px 64px" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-bold text-3xl" style={{ color: T.ink }}>{display}%</span>
        <span style={{ color: T.muted, fontSize: 10 }} className="uppercase tracking-wide">совпадение</span>
      </div>
    </div>
  );
}

/* ---------------- HOME ---------------- */
function HomeScreen({ testDone, unscratchedCount, onGoTest, onGoDiscover, onToggleLive, liveExpanded }) {
  return (
    <div className="pb-4">
      <div className="px-4 pt-4">
        <button onClick={onToggleLive}
          className="relative w-full text-left rounded-2xl p-4 flex items-center gap-3 active:scale-95 transition-transform duration-150"
          style={{ background: T.gold }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.15)" }}>
            <Radio size={16} color="#fff" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold tracking-wide" style={{ color: "rgba(255,255,255,0.75)" }}>LIVE РЯДОМ</p>
            <p className="font-display text-base mt-0.5" style={{ color: "#fff" }}>Джаз-вечер сегодня · окно 1ч 42м</p>
          </div>
        </button>
        {liveExpanded && (
          <div className="mt-2 rounded-2xl p-3 flex gap-2" style={{ background: T.surfaceSoft, border: `1px solid ${T.line}` }}>
            {["Марк", "Лера"].map((n) => (
              <div key={n} className="flex items-center gap-2 rounded-full px-2.5 py-1.5" style={{ background: T.surface }}>
                <div className="w-6 h-6 rounded-full blur-sm" style={{ background: "linear-gradient(135deg,#B9C6FF,#6E85E8)" }} />
                <span className="text-xs font-medium" style={{ color: T.ink }}>{n} тоже здесь</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pt-3">
        <button onClick={onGoDiscover}
          className="relative w-full flex items-center gap-3 rounded-2xl p-3.5 active:scale-95 transition-transform duration-150 overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${T.coral}, ${T.coralDeep})` }}>
          <div className="relative flex-shrink-0" style={{ width: 44, height: 44 }}>
            <div className="absolute rounded-xl" style={{ width: 34, height: 40, background: "rgba(255,255,255,0.35)", left: 6, top: 2, transform: "rotate(-8deg)" }} />
            <div className="absolute rounded-xl" style={{ width: 34, height: 40, background: "#fff", left: 5, top: 0, transform: "rotate(4deg)" }} />
          </div>
          <div className="flex-1 text-left">
            <p className="text-sm font-bold text-white">{unscratchedCount > 0 ? `${unscratchedCount} новые карты ждут` : "Все карты открыты"}</p>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.85)" }}>Потри, чтобы узнать, кто там</p>
          </div>
        </button>
      </div>

      <div className="px-4 pt-3">
        <button onClick={onGoTest}
          className="w-full flex items-center gap-3 rounded-2xl p-3.5 active:scale-95 transition-transform duration-150"
          style={{ background: T.surface, border: `1px solid ${T.line}` }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: T.goldSoft }}>
            <Sparkles size={18} color={T.gold} />
          </div>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold" style={{ color: T.ink }}>{testDone ? "Тест пройден" : "Пройди мини-тест"}</p>
            <p className="text-xs" style={{ color: T.muted }}>{testDone ? "Профиль собран по твоим ответам" : "6 карточек · совпадения без фото"}</p>
          </div>
        </button>
      </div>
    </div>
  );
}

/* ---------------- TEST ---------------- */
function TestScreen({ onFinish }) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState("idle");

  function choose() {
    if (phase !== "idle") return;
    setPhase("leaving");
    setTimeout(() => {
      if (index + 1 >= TEST_CARDS.length) onFinish();
      else { setIndex((i) => i + 1); setPhase("idle"); }
    }, 220);
  }

  const card = TEST_CARDS[index];

  return (
    <div className="flex flex-col h-full px-5 pt-5 pb-4">
      <div className="flex gap-1.5 mb-6">
        {TEST_CARDS.map((c, i) => (
          <div key={c.id} className="h-1 flex-1 rounded-full transition-colors duration-300" style={{ background: i <= index ? T.coral : T.line }} />
        ))}
      </div>
      <p className="text-center text-xs mb-6 tracking-wide uppercase" style={{ color: T.muted }}>Вопрос {index + 1} из {TEST_CARDS.length}</p>
      <div className={`transition-all duration-200 ${phase === "leaving" ? "opacity-0 -translate-y-2" : "opacity-100 translate-y-0"}`}>
        <p className="font-display font-semibold text-3xl text-center leading-tight mb-8" style={{ color: T.ink }}>{card.q}</p>
        <div className="flex flex-col gap-3">
          <button onClick={choose} className="w-full flex items-center gap-3 rounded-2xl p-4 text-left active:scale-95 transition-transform duration-150"
            style={{ background: T.surface, border: `1px solid ${T.line}`, boxShadow: "0 8px 20px -14px rgba(30,40,90,0.3)" }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: T.surfaceSoft }}><X size={15} color={T.muted} /></div>
            <span className="font-semibold text-sm" style={{ color: T.ink }}>{card.left}</span>
          </button>
          <button onClick={choose} className="w-full flex items-center gap-3 rounded-2xl p-4 text-left active:scale-95 transition-transform duration-150"
            style={{ background: `linear-gradient(135deg, ${T.coral}, ${T.coralDeep})`, boxShadow: "0 10px 24px -12px rgba(39,72,217,0.5)" }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.3)" }}><Heart size={15} color="#FFFFFF" /></div>
            <span className="font-semibold text-sm text-white">{card.right}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultScreen({ onContinue }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-5" style={{ background: `linear-gradient(135deg, ${T.coral}, ${T.gold})` }}>
        <Sparkles size={26} color="#FFFFFF" />
      </div>
      <h2 className="font-display font-semibold text-2xl mb-2" style={{ color: T.ink }}>Профиль готов</h2>
      <p className="text-sm mb-7" style={{ color: T.muted }}>Фото пока не нужно — совпадения уже считаются по ответам</p>
      <button onClick={onContinue} className="w-full rounded-full py-3.5 font-semibold text-sm text-white active:scale-95 transition-transform duration-150"
        style={{ background: `linear-gradient(135deg, ${T.coral}, ${T.coralDeep})` }}>
        Открыть пачку карт
      </button>
    </div>
  );
}

/* ---------------- DISCOVER: pack of scratch cards ---------------- */
function DiscoverScreen({ scratchedIds, onReveal, onOpenMatch }) {
  return (
    <div className="px-4 pt-4 pb-4">
      <p className="text-xs mb-3" style={{ color: T.muted }}>Проведи пальцем по карте, чтобы открыть</p>
      <div className="grid grid-cols-2 gap-3">
        {MATCHES.map((m) => (
          <ScratchMatchCard key={m.id} match={m} revealed={!!scratchedIds[m.id]} onReveal={onReveal} onOpen={onOpenMatch} />
        ))}
      </div>
    </div>
  );
}

/* ---------------- MATCH DETAIL ---------------- */
function MatchDetailScreen({ match, hasChat, onStartChat }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return (
    <div className={`flex flex-col h-full transition-opacity duration-300 ${mounted ? "opacity-100" : "opacity-0"}`}>
      <div className="flex-1 overflow-y-auto px-5 pt-6 pb-3">
        <div className="flex flex-col items-center">
          <Avatar grad={match.grad} size={88} revealed={false} />
          <h2 className="font-display font-semibold text-xl mt-3" style={{ color: T.ink }}>{match.name}</h2>
          <div className="mt-2"><CompatRing percent={match.percent} /></div>
        </div>
        <div className="mt-4 space-y-2.5">
          {match.flags.map((f, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-2xl p-3" style={{ background: T.surface, border: `1px solid ${T.line}` }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: T.goldSoft }}><Flag size={13} color={T.gold} /></div>
              <span className="text-sm" style={{ color: T.ink }}>{f}</span>
            </div>
          ))}
          {match.event && (
            <div className="flex items-center gap-2.5 rounded-2xl p-3" style={{ background: "#E1EBFF", border: `1px solid ${T.line}` }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#FFFFFF" }}><MapPin size={13} color={T.coral} /></div>
              <span className="text-sm" style={{ color: T.ink }}>{match.event}</span>
            </div>
          )}
        </div>
      </div>
      <div className="px-5 pb-5 pt-2" style={{ borderTop: `1px solid ${T.line}` }}>
        <button onClick={onStartChat} className="w-full rounded-full py-3.5 font-semibold text-sm text-white active:scale-95 transition-transform duration-150"
          style={{ background: `linear-gradient(135deg, ${T.coral}, ${T.coralDeep})` }}>
          {hasChat ? "Продолжить разговор" : "Начать разговор"}
        </button>
      </div>
    </div>
  );
}

/* ---------------- CHATS LIST ---------------- */
function ChatsScreen({ chatsState, onOpenChat }) {
  const entries = Object.keys(chatsState).map(Number)
    .map((id) => ({ id, match: MATCHES.find((m) => m.id === id), chat: chatsState[id] }))
    .filter((e) => e.match);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 text-center">
        <MessageCircle size={28} color={T.muted} className="mb-3" />
        <p className="text-sm" style={{ color: T.muted }}>Пока пусто. Открой карту во вкладке «Матчи» и начни разговор.</p>
      </div>
    );
  }
  return (
    <div className="px-4 pt-4 space-y-2.5 pb-4">
      {entries.map(({ id, match, chat }) => {
        const last = chat.messages[chat.messages.length - 1];
        const preview = last.from === "scratch" ? "Фото ждёт открытия…" : last.text;
        return (
          <button key={id} onClick={() => onOpenChat(id)}
            className="w-full flex items-center gap-3 rounded-2xl p-3 active:scale-95 transition-transform duration-150 text-left"
            style={{ background: T.surface, border: `1px solid ${T.line}` }}>
            <Avatar grad={match.grad} size={48} revealed={chat.revealed} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: T.ink }}>{match.name}</p>
              <p className="text-xs truncate" style={{ color: T.muted }}>{preview}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- CHAT ---------------- */
function ChatScreen({ match, chat, onUpdate }) {
  const [text, setText] = useState("");
  const replyIdx = useRef(0);
  const { messages, sentCount, revealed } = chat;

  function send(value) {
    const v = value.trim();
    if (!v) return;
    setText("");
    const nextCount = sentCount + 1;
    onUpdate((c) => ({ ...c, messages: [...c.messages, { from: "me", text: v }], sentCount: nextCount }));
    setTimeout(() => {
      const reply = AUTO_REPLIES[replyIdx.current % AUTO_REPLIES.length];
      replyIdx.current += 1;
      onUpdate((c) => ({ ...c, messages: [...c.messages, { from: "them", text: reply }] }));
    }, 550);
    if (nextCount >= REVEAL_THRESHOLD && !revealed) {
      setTimeout(() => {
        onUpdate((c) => (c.unlocking || c.revealed ? c : { ...c, unlocking: true, messages: [...c.messages, { from: "scratch" }] }));
      }, 500);
    }
  }

  function handleScratchDone() {
    onUpdate((c) => ({ ...c, revealed: true, messages: [...c.messages, { from: "system", text: "Фото открыто ✨" }] }));
  }

  const remaining = Math.max(0, REVEAL_THRESHOLD - sentCount);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 flex items-center gap-3">
        <Avatar grad={match.grad} size={44} revealed={revealed} />
        <div>
          <p className="font-semibold text-sm" style={{ color: T.ink }}>{match.name}</p>
          <p className="text-xs" style={{ color: revealed ? T.gold : T.muted }}>{revealed ? "Фото открыто" : `Ещё ${remaining} сообщ. до фото`}</p>
        </div>
      </div>
      <div className="px-4 pt-3">
        <div className="flex gap-1">
          {Array.from({ length: REVEAL_THRESHOLD }).map((_, i) => (
            <div key={i} className="h-1 flex-1 rounded-full transition-colors duration-300" style={{ background: i < sentCount ? T.coral : T.line }} />
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.map((m, i) => {
          if (m.from === "scratch") {
            return <div key={i} className="py-4 flex flex-col items-center gap-3"><ScratchPhoto grad={match.grad} onDone={handleScratchDone} /></div>;
          }
          if (m.from === "system") {
            return <div key={i} className="flex justify-center py-1"><span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: T.goldSoft, color: "#2A3B8F" }}>{m.text}</span></div>;
          }
          return (
            <div key={i} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
              <div className="rounded-2xl px-3.5 py-2 text-sm" style={{
                background: m.from === "me" ? `linear-gradient(135deg, ${T.coral}, ${T.coralDeep})` : T.surface,
                color: m.from === "me" ? "#FFFFFF" : T.ink,
                border: m.from === "me" ? "none" : `1px solid ${T.line}`,
                maxWidth: "75%",
              }}>{m.text}</div>
            </div>
          );
        })}
      </div>
      {!revealed && (
        <div className="px-4 pb-2 flex gap-2 overflow-x-auto">
          {REPLIES.map((r) => (
            <button key={r} onClick={() => send(r)} className="whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full active:scale-95 transition-transform duration-150 flex-shrink-0"
              style={{ background: T.surfaceSoft, color: T.coralDeep, border: `1px solid ${T.line}` }}>{r}</button>
          ))}
        </div>
      )}
      <div className="px-4 pb-5 pt-1 flex items-center gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send(text)}
          placeholder="Написать..." className="flex-1 rounded-full px-4 py-2.5 text-sm outline-none"
          style={{ background: T.surfaceSoft, color: T.ink, border: `1px solid ${T.line}` }} />
        <button onClick={() => send(text)} className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform duration-150"
          style={{ background: `linear-gradient(135deg, ${T.coral}, ${T.coralDeep})` }}><Send size={16} color="#FFFFFF" /></button>
      </div>
    </div>
  );
}

/* ---------------- PROFILE ---------------- */
function ProfileScreen({ testDone, onGoTest }) {
  return (
    <div className="flex flex-col items-center px-6 pt-8 pb-4">
      <div className="w-20 h-20 rounded-full mb-3" style={{ background: `linear-gradient(135deg, ${T.coral}, ${T.gold})` }} />
      <h2 className="font-display font-semibold text-lg" style={{ color: T.ink }}>Твой профиль</h2>
      <p className="text-xs mb-6" style={{ color: T.muted }}>Без фото — только ответы на тест</p>
      {testDone ? (
        <div className="w-full flex flex-wrap gap-2 justify-center">
          {["Плед и сериал", "Спонтанный трип", "Сначала остыть", "Природа", "Добрый юмор"].map((t) => (<Pill key={t}>{t}</Pill>))}
        </div>
      ) : (
        <button onClick={onGoTest} className="w-full rounded-full py-3.5 font-semibold text-sm text-white active:scale-95 transition-transform duration-150"
          style={{ background: `linear-gradient(135deg, ${T.coral}, ${T.coralDeep})` }}>Пройти тест</button>
      )}
    </div>
  );
}

function TabBar({ tab, setTab }) {
  const tabs = [
    { id: "home", label: "Дом", icon: Home },
    { id: "test", label: "Тест", icon: Sparkles },
    { id: "discover", label: "Матчи", icon: LayoutGrid },
    { id: "chats", label: "Чаты", icon: MessageCircle },
    { id: "profile", label: "Профиль", icon: User },
  ];
  return (
    <div className="flex" style={{ background: T.surface, borderTop: `1px solid ${T.line}` }}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = tab === t.id;
        return (
          <button key={t.id} onClick={() => setTab(t.id)} className="flex-1 flex flex-col items-center gap-1 py-2.5 active:scale-95 transition-transform duration-150">
            <Icon size={17} color={active ? T.coral : T.muted} />
            <span className="whitespace-nowrap font-medium" style={{ color: active ? T.coral : T.muted, fontSize: 10 }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("home");
  const [testDone, setTestDone] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [liveExpanded, setLiveExpanded] = useState(false);
  const [viewingMatchId, setViewingMatchId] = useState(null);
  const [activeChatId, setActiveChatId] = useState(null);
  const [chatsState, setChatsState] = useState({});
  const [scratchedIds, setScratchedIds] = useState({});

  function markScratched(id) { setScratchedIds((s) => ({ ...s, [id]: true })); }
  function updateChat(matchId, updater) { setChatsState((prev) => ({ ...prev, [matchId]: updater(prev[matchId]) })); }
  function startChat(matchId) {
    setChatsState((prev) => {
      if (prev[matchId]) return prev;
      const match = MATCHES.find((m) => m.id === matchId);
      return { ...prev, [matchId]: { messages: [{ from: "them", text: match.opener }], sentCount: 0, revealed: false, unlocking: false } };
    });
    setViewingMatchId(null);
    setActiveChatId(matchId);
  }

  const unscratchedCount = MATCHES.length - Object.keys(scratchedIds).length;

  let title = "Treffit";
  let body = null;
  let onBack = null;

  if (activeChatId) {
    const match = MATCHES.find((m) => m.id === activeChatId);
    title = match.name;
    onBack = () => { setActiveChatId(null); setTab("chats"); };
    body = <ChatScreen match={match} chat={chatsState[activeChatId]} onUpdate={(u) => updateChat(activeChatId, u)} />;
  } else if (viewingMatchId) {
    const match = MATCHES.find((m) => m.id === viewingMatchId);
    title = "Профиль";
    onBack = () => setViewingMatchId(null);
    body = <MatchDetailScreen match={match} hasChat={!!chatsState[viewingMatchId]} onStartChat={() => startChat(viewingMatchId)} />;
  } else if (tab === "home") {
    title = "Treffit";
    body = <HomeScreen testDone={testDone} unscratchedCount={unscratchedCount} onGoTest={() => setTab("test")} onGoDiscover={() => setTab("discover")} onToggleLive={() => setLiveExpanded((v) => !v)} liveExpanded={liveExpanded} />;
  } else if (tab === "test" && showResult) {
    title = "Готово";
    body = <ResultScreen onContinue={() => { setShowResult(false); setTab("discover"); }} />;
  } else if (tab === "test") {
    title = "Мини-тест";
    body = <TestScreen onFinish={() => { setTestDone(true); setShowResult(true); }} />;
  } else if (tab === "discover") {
    title = "Матчи";
    body = <DiscoverScreen scratchedIds={scratchedIds} onReveal={markScratched} onOpenMatch={setViewingMatchId} />;
  } else if (tab === "chats") {
    title = "Чаты";
    body = <ChatsScreen chatsState={chatsState} onOpenChat={setActiveChatId} />;
  } else if (tab === "profile") {
    title = "Профиль";
    body = <ProfileScreen testDone={testDone} onGoTest={() => setTab("test")} />;
  }

  const showFooter = !activeChatId && !viewingMatchId;

  return (
    <div className="w-full flex flex-col items-center justify-center px-4 relative overflow-hidden" style={{ height: 900, background: "linear-gradient(160deg, #F5F7FF 0%, #EAF0FE 50%, #DCE6FC 100%)" }}>
      <GlobalStyle />
      <div className="absolute rounded-full blur-3xl pointer-events-none" style={{ width: 260, height: 260, background: T.coral, opacity: 0.16, top: 40, left: -80 }} />
      <div className="absolute rounded-full blur-3xl pointer-events-none" style={{ width: 240, height: 240, background: T.gold, opacity: 0.18, bottom: 40, right: -80 }} />
      <div className="relative z-10">
        <PhoneChrome title={title} onBack={onBack} footer={showFooter ? <TabBar tab={tab} setTab={setTab} /> : null}>
          <div key={`${tab}-${viewingMatchId}-${activeChatId}-${showResult}`} className="rise-in h-full">{body}</div>
        </PhoneChrome>
      </div>
      <p className="text-xs mt-5 text-center max-w-xs relative z-10 font-ui" style={{ color: "#7A85A6" }}>
        Матчи — потри карту, чтобы узнать, кто там. Чат — 3 сообщения открывают скретч-карту с фото
      </p>
    </div>
  );
}
