import React, { useRef, useState } from "react";
import { Check, Heart, MapPin, RotateCcw, Star, X } from "lucide-react";

import { mediaUrl } from "../api/client";
import { haptic } from "../lib/telegram";
import { FALLBACK_GRADIENT, T, gradient } from "../theme";

// Насколько палец может сместиться, чтобы это всё ещё считалось касанием.
const TAP_SLOP = 8;
const SWIPE_DISTANCE = 110;
const MAX_ROTATION = 14;
// Пикселей в миллисекунду. Быстрый короткий флик — это тоже решение, и
// требовать от него полного размаха незачем: именно из-за этого карточка
// возвращалась на место, хотя человек её уверенно бросил.
const FLICK_SPEED = 0.45;
// Пружина: карточка возвращается с перелётом, а не приезжает по прямой.
const SPRING = "cubic-bezier(0.18, 0.89, 0.32, 1.28)";
const THROW = "cubic-bezier(0.32, 0, 0.67, 0)";

/**
 * A draggable profile card.
 *
 * Only the top card listens for pointer events; the ones behind are static
 * so the stack cannot be dragged by accident.
 */
export function SwipeCard({ candidate, onDecide, onOpen, interactive = true, depth = 0, blindMode, homeCity }) {
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const last = useRef({ x: 0, t: 0 });
  const speed = useRef(0);
  const [leaving, setLeaving] = useState(null);
  const origin = useRef(null);
  const passedThreshold = useRef(false);

  // Листаем фотографии касанием по краям карточки, как в любом дейтинге:
  // одно фото о человеке говорит мало, а свайп занят решением.
  const [shot, setShot] = useState(0);
  const gallery = (candidate.photos || []).filter((item) => item.url);
  const photo = gallery[Math.min(shot, gallery.length - 1)] || candidate.photos?.[0];
  const photoSrc = photo?.url ? mediaUrl(photo.url) : null;

  /** Касание без перетаскивания: слева — назад, справа — вперёд, по центру
   *  открывается анкета. Порог в 8 пикселей отделяет тап от свайпа. */
  function tap(event) {
    if (!interactive) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    if (gallery.length > 1 && x < 0.3) {
      setShot((current) => Math.max(0, current - 1));
    } else if (gallery.length > 1 && x > 0.7) {
      setShot((current) => Math.min(gallery.length - 1, current + 1));
    } else {
      onOpen?.(candidate);
    }
  }
  const grad = photo?.gradient || FALLBACK_GRADIENT;

  function begin(event) {
    if (!interactive || leaving) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = { x: event.clientX, y: event.clientY };
    // Замеряем скорость по последнему отрезку, а не по всему жесту: важно,
    // как палец двигался перед отрывом, а не как он вёл себя вначале.
    last.current = { x: event.clientX, t: event.timeStamp };
    speed.current = 0;
  }

  function move(event) {
    if (!origin.current) return;
    const x = event.clientX - origin.current.x;
    const y = event.clientY - origin.current.y;

    const dt = event.timeStamp - last.current.t;
    if (dt > 0) {
      const instant = (event.clientX - last.current.x) / dt;
      // Сглаживаем, но первое измерение берём как есть: разгон от нуля
      // занижал короткие быстрые жесты — то есть именно флики, ради
      // которых всё и затевалось.
      speed.current = speed.current === 0 ? instant : speed.current * 0.6 + instant * 0.4;
      last.current = { x: event.clientX, t: event.timeStamp };
    }
    setDrag({ x, y });
    const crossed = Math.abs(x) > SWIPE_DISTANCE;
    if (crossed !== passedThreshold.current) {
      passedThreshold.current = crossed;
      if (crossed) haptic.light();
    }
  }

  function end(event) {
    if (!origin.current) return;
    const moved = Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y);
    origin.current = null;
    passedThreshold.current = false;
    const thrown = Math.abs(speed.current) > FLICK_SPEED;
    // Бросок засчитываем по направлению скорости, а не смещения: в конце
    // жеста палец мог качнуться обратно.
    if (Math.abs(drag.x) > SWIPE_DISTANCE || (thrown && Math.abs(drag.x) > TAP_SLOP * 3)) {
      const direction = thrown ? speed.current : drag.x;
      fly(direction > 0 ? "like" : "pass");
    } else {
      setDrag({ x: 0, y: 0 });
      // Палец почти не сдвинулся — значит это касание, а не свайп.
      if (moved < TAP_SLOP) tap(event);
    }
  }

  function fly(action) {
    setLeaving(action);
    haptic.medium();
    // Родитель убирает карточку только после того, как улёт доигран:
    // раньше он срезал последние шестьдесят миллисекунд, и карточка
    // пропадала рывком.
    setTimeout(() => onDecide(action), 300);
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
      // Метка для проверок: цепляться за классы оформления нельзя, они
      // меняются при каждой правке вида.
      data-card=""
      className="absolute inset-0 overflow-hidden select-none"
      style={{
        touchAction: "none",
        background: T.surface,
        borderRadius: 28,
        boxShadow: "0 24px 50px -20px rgba(16,16,20,0.4)",
        // Карточки за верхней прижаты к её верхнему краю: при обычном
        // центре уменьшение съедало сверху ровно столько, сколько давал
        // сдвиг, и стопка выглядела одной карточкой. С origin по верху
        // сжимается только низ, и над верхней остаётся видимая полоска —
        // сразу понятно, что за ней есть ещё.
        transformOrigin: depth ? "top center" : "center",
        transform:
          exitTransform ||
          (depth
            ? `translateY(${-depth * 10}px) scale(${1 - depth * 0.045})`
            : `translate(${drag.x}px, ${drag.y * 0.35}px) rotate(${rotation}deg)`),
        // Пока палец на экране — никакой анимации, карточка обязана идти
        // за ним ровно. Улетает быстро и с разгоном, возвращается пружиной
        // с лёгким перелётом: так она ощущается предметом, а не картинкой.
        transition: origin.current
          ? "none"
          : leaving
          ? `transform 300ms ${THROW}, opacity 300ms linear`
          : `transform 420ms ${SPRING}`,
        opacity: leaving ? 0 : 1,
        zIndex: 10 - depth,
        willChange: "transform",
        cursor: interactive ? "grab" : "default",
      }}
    >
      <div className="relative w-full h-full" style={{ background: grad }}>
        {photoSrc && <img src={photoSrc} alt="" className="w-full h-full object-cover" draggable={false} />}

        {/* Полоски сверху — какое фото из скольких. Одна фотография в
            счётчике не нуждается. */}
        {gallery.length > 1 && (
          <div className="absolute top-2.5 inset-x-2.5 flex gap-1">
            {gallery.map((item, index) => (
              <span
                key={item.url}
                className="h-1 flex-1 rounded-full"
                style={{
                  background: index === shot ? "#fff" : "rgba(255,255,255,0.4)",
                  transition: "background 200ms ease",
                }}
              />
            ))}
          </div>
        )}

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
          style={{ background: "linear-gradient(to top, rgba(8,8,12,0.92) 12%, rgba(8,8,12,0.55) 55%, rgba(8,8,12,0))" }}
        >
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="font-display text-3xl text-white truncate">
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
              {/* Обычно город у всех один и подписывать его — шум. Но у
                  анкет, заполненных до того, как город стал обязательным,
                  его может не быть, и тогда колода отдаёт кого угодно:
                  пусть хотя бы будет видно, откуда человек. */}
              {candidate.city && homeCity && candidate.city !== homeCity && (
                <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.75)" }}>
                  {candidate.city}
                </p>
              )}
              {candidate.is_online && (
                <p className="text-xs mt-0.5" style={{ color: "#8BE8C4" }}>сейчас онлайн</p>
              )}
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
                  // Без иконки флажка: она делала метку похожей на отладочную
                  // подпись, а не на общий ответ двух людей.
                  className="rounded-full px-2.5 py-1 text-xs font-medium backdrop-blur-sm"
                  style={{ background: "rgba(255,255,255,0.22)", color: "#fff" }}
                >
                  {flag}
                </span>
              ))}
            </div>
          )}

          {/* Интересы приходили с сервера и не показывались нигде: именно
              их люди и разглядывают, решая. Показываем те, что не повторяют
              уже написанное в общих ответах. */}
          {(() => {
            const shared = new Set((candidate.shared_flags || []).map((f) => f.toLowerCase()));
            const tags = (candidate.interests || []).filter((t) => !shared.has(t.toLowerCase()));
            if (!tags.length) return null;
            return (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full px-2.5 py-1 text-xs"
                    style={{
                      background: "rgba(255,255,255,0.12)",
                      color: "rgba(255,255,255,0.92)",
                      border: "1px solid rgba(255,255,255,0.22)",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            );
          })()}

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

/**
 * Кнопки под колодой.
 *
 * Центральная крупнее и со свечением: суперлайк — редкое действие, и
 * равноправный третий кружок его не выделял никак. Процент совпадения
 * висит здесь же, а не в углу карточки: это главное, что мы знаем о
 * человеке до знакомства, и прятать его мелким шрифтом в тени фотографии
 * значит выбрасывать собственную же работу.
 */
// Размер боковой кнопки. Он же — ширина пустого места напротив неё.
const SIDE = 48;

export function SwipeControls({ onPass, onSuperlike, onLike, onUndo, canUndo, compatibility, disabled }) {
  return (
    // Две вещи держат этот ряд ровным.
    //
    // Первая — общая линия по центрам кружков, а не по нижнему краю: у
    // кнопок разный размер, и по низу они вставали на четырёх разных
    // уровнях.
    //
    // Вторая — пустое место справа, ровно под ширину отмены. Без него
    // звезда, самый крупный и яркий элемент, оказывалась третьей из
    // четырёх, то есть правее середины экрана, и весь ряд читался
    // съехавшим. Симметрию ломает не размер кнопок, а нечётность.
    <div className="flex items-center justify-center gap-4 pt-3 pb-6">
      {/* Отмена с краю и меньше остальных: нужна редко, и промахнуться по
          ней вместо «пропустить» было бы издевательством над тем, ради
          чего она сделана. Кнопка не исчезает, когда отменять нечего, —
          прыгающий ряд хуже, чем гашёная кнопка. */}
      <RoundButton
        onClick={onUndo}
        disabled={disabled || !canUndo}
        size={SIDE}
        label="Вернуть предыдущую"
      >
        <RotateCcw size={20} color={T.muted} strokeWidth={2.4} />
      </RoundButton>

      <RoundButton onClick={onPass} disabled={disabled} size={62} label="Пропустить">
        <X size={26} color={T.danger} strokeWidth={2.6} />
      </RoundButton>

      {/* Процент вынесен из потока: пока он был обычным элементом колонки,
          он занимал место снизу и сдвигал саму звезду вверх. */}
      <div className="relative flex-shrink-0">
        <RoundButton
          onClick={onSuperlike}
          disabled={disabled}
          size={74}
          label="Суперлайк"
          accent
        >
          <Star size={30} color="#fff" fill="#fff" />
        </RoundButton>
        {typeof compatibility === "number" && (
          <span
            className="absolute rounded-full px-2.5 py-0.5 text-xs font-bold text-white whitespace-nowrap"
            style={{
              background: gradient.action,
              left: "50%",
              bottom: -9,
              transform: "translateX(-50%)",
              border: `2px solid ${T.bg}`,
              boxShadow: "0 6px 14px -6px rgba(61,107,255,0.7)",
            }}
          >
            {compatibility}%
          </span>
        )}
      </div>

      <RoundButton onClick={onLike} disabled={disabled} size={62} label="Лайк">
        <Heart size={26} color={T.coral} fill={T.coral} />
      </RoundButton>

      {/* Противовес отмене. Ничего не делает и не показывает — только
          возвращает звезду в середину экрана. */}
      <span aria-hidden className="flex-shrink-0" style={{ width: SIDE }} />
    </div>
  );
}

function RoundButton({ children, onClick, disabled, size, label, accent }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded-full flex items-center justify-center flex-shrink-0 transition-transform duration-150 disabled:opacity-40"
      style={{
        width: size,
        height: size,
        background: accent ? gradient.action : T.surface,
        border: accent ? "none" : `1px solid ${T.line}`,
        // Цветное свечение у акцентной, обычная тень у остальных: иначе
        // три кружка читаются как один ряд одинаковых.
        boxShadow: accent
          ? "0 12px 26px -8px rgba(61,107,255,0.75), 0 0 0 6px rgba(61,107,255,0.10)"
          : "0 10px 22px -12px rgba(30,40,90,0.5)",
        transform: "scale(1)",
      }}
      onPointerDown={(event) => {
        event.currentTarget.style.transform = "scale(0.88)";
      }}
      onPointerUp={(event) => {
        event.currentTarget.style.transform = "scale(1)";
      }}
      onPointerLeave={(event) => {
        event.currentTarget.style.transform = "scale(1)";
      }}
    >
      {children}
    </button>
  );
}
