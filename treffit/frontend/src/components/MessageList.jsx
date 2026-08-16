import React, { useEffect, useRef, useState } from "react";
import { Check, CheckCheck, Copy, CornerUpLeft, Pencil, Trash2 } from "lucide-react";

import { mediaUrl } from "../api/client";
import { haptic } from "../lib/telegram";
import { T } from "../theme";

/* Сколько тянуть, чтобы жест засчитался за ответ, и докуда пускать палец. */
const REPLY_TRIGGER = 48;
const REPLY_LIMIT = 76;
const LONG_PRESS_MS = 420;
/* Набор реакций. Тот же, что даёт Telegram без Premium: больше — это уже
   выбор из выбора, а в переписке двоих он ни к чему. */
export const REACTIONS = ["👍", "❤️", "🔥", "😂", "😮", "😢", "🙏"];
/* Быстрая реакция по двойному касанию — как сердце в Telegram. */
const QUICK = "❤️";

/* Внутри этого промежутка подряд идущие сообщения — одна группа. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

const DAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

function dayLabel(date) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(date, today)) return "сегодня";
  if (same(date, yesterday)) return "вчера";
  if (today - date < 6 * 86400000) return DAYS[date.getDay()];
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

const time = (value) =>
  new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

/**
 * Разбить ленту на дни и группы.
 *
 * Группа — это подряд идущие сообщения одного человека в пределах пяти
 * минут. Внутри группы промежутки меньше, а хвостик у пузыря только у
 * последнего: без этого стена реплик выглядит как список карточек, а не
 * как разговор.
 */
function layout(messages) {
  const days = [];
  let day = null;
  let group = null;

  for (const message of messages) {
    const sentAt = new Date(message.sent_at);
    const key = sentAt.toDateString();
    if (!day || day.key !== key) {
      day = { key, label: dayLabel(sentAt), groups: [] };
      days.push(day);
      group = null;
    }
    if (message.type === "system") {
      day.groups.push({ system: true, message });
      group = null;
      continue;
    }
    const continues =
      group &&
      group.sender === message.sender_id &&
      sentAt - new Date(group.last) < GROUP_WINDOW_MS;
    if (!continues) {
      group = { sender: message.sender_id, mine: message.mine, items: [], last: message.sent_at };
      day.groups.push(group);
    }
    group.items.push(message);
    group.last = message.sent_at;
  }
  return days;
}

export function MessageList({ messages, onReply, onEdit, onDelete, onReact, onOpenPhoto, children }) {
  const [menu, setMenu] = useState(null);

  return (
    <>
      {layout(messages).map((day) => (
        <div key={day.key}>
          <div className="flex justify-center py-2">
            <span
              className="text-xs font-semibold rounded-full px-2.5 py-1"
              style={{ background: "rgba(16,16,20,0.06)", color: T.muted }}
            >
              {day.label}
            </span>
          </div>

          {day.groups.map((group, index) =>
            group.system ? (
              <p
                key={group.message.id}
                className="text-xs text-center py-2 px-6"
                style={{ color: T.muted }}
              >
                {group.message.body}
              </p>
            ) : (
              <div key={`${day.key}-${index}`} className="space-y-0.5 mb-2">
                {group.items.map((message, position) => (
                  <Bubble
                    key={message.id}
                    message={message}
                    last={position === group.items.length - 1}
                    onReply={() => onReply(message)}
                    onMenu={() => setMenu(message)}
                    onReact={onReact}
                    onOpenPhoto={onOpenPhoto}
                  />
                ))}
              </div>
            )
          )}
        </div>
      ))}

      {children}

      {menu && (
        <MessageMenu
          message={menu}
          onReact={(emoji) => {
            onReact(menu, emoji);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
          onReply={() => {
            onReply(menu);
            setMenu(null);
          }}
          onEdit={() => {
            onEdit(menu);
            setMenu(null);
          }}
          onDelete={() => {
            onDelete(menu);
            setMenu(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Пузырь сообщения.
 *
 * Тянется за пальцем вправо — это ответ. После порога палец идёт туго:
 * резинка вместо упора говорит, что дальше некуда, но жест ещё жив. Долгое
 * нажатие открывает меню.
 */
function Bubble({ message, last, onReply, onMenu, onReact, onOpenPhoto }) {
  const [shift, setShift] = useState(0);
  const start = useRef(null);
  const armed = useRef(false);
  const timer = useRef(null);
  // Ось решается один раз и больше не пересматривается. Без этого жест
  // жил во время прокрутки: палец уходил вниз, взвод оставался, и на
  // отпускании прилетал ответ случайному сообщению.
  const axis = useRef(null);
  const mine = message.mine;

  function cancelPress() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function begin(event) {
    if (message.deleted) return;
    // Захват указателя обязателен. Без него pointermove уходит тому
    // элементу, над которым палец сейчас, а не тому, где начался жест:
    // за пальцем едет вся лента, а ответ прилетает соседнему сообщению.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    start.current = { x: event.clientX, y: event.clientY };
    armed.current = false;
    axis.current = null;
    timer.current = setTimeout(() => {
      timer.current = null;
      haptic.medium();
      onMenu();
    }, LONG_PRESS_MS);
  }

  function move(event) {
    if (!start.current) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;

    if (axis.current === null) {
      // Пока палец не прошёл порог, направление неизвестно: ждём.
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      cancelPress();
      if (axis.current === "y") {
        // Это прокрутка. Жест закончен — и закончен насовсем, иначе
        // отпускание после долгой прокрутки сработает как ответ.
        start.current = null;
        armed.current = false;
        setShift(0);
        return;
      }
    }

    // Тянуть можно в любую сторону: Telegram на iOS отвечает свайпом
    // влево, на Android — вправо, и заставлять человека переучиваться
    // ради нашей догадки о его привычке незачем.
    const distance = Math.abs(dx);
    const direction = Math.sign(dx);
    const pulled =
      distance > REPLY_TRIGGER ? REPLY_TRIGGER + (distance - REPLY_TRIGGER) * 0.35 : distance;
    const next = Math.min(pulled, REPLY_LIMIT);
    if (next >= REPLY_TRIGGER && !armed.current) {
      armed.current = true;
      haptic.light();
    }
    if (next < REPLY_TRIGGER) armed.current = false;
    setShift(next * direction);
  }

  const lastTap = useRef(0);

  function end(event) {
    cancelPress();
    event?.currentTarget?.releasePointerCapture?.(event.pointerId);
    const fire = armed.current;
    start.current = null;
    armed.current = false;
    setShift(0);
    if (fire) {
      onReply();
      return;
    }
    // Двойное касание ставит быструю реакцию — как сердце в Telegram.
    if (axis.current === null && !message.deleted) {
      const now = Date.now();
      if (now - lastTap.current < 320) {
        lastTap.current = 0;
        haptic.light();
        onReact?.(message, QUICK);
      } else {
        lastTap.current = now;
      }
    }
  }

  const photo = message.photo_url ? mediaUrl(message.photo_url) : null;

  return (
    <div
      className={`flex ${mine ? "justify-end" : "justify-start"} relative`}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      style={{ touchAction: "pan-y" }}
    >
      {/* Стрелка проявляется по мере натяжения — видно, что будет дальше. */}
      <span
        className="absolute top-1/2 flex items-center justify-center rounded-full"
        style={{
          [shift < 0 ? "right" : "left"]: 0,
          width: 28,
          height: 28,
          marginTop: -14,
          background: T.surfaceSoft,
          opacity: Math.min(1, Math.abs(shift) / REPLY_TRIGGER),
          transform: `scale(${0.6 + Math.min(1, Math.abs(shift) / REPLY_TRIGGER) * 0.4})`,
          pointerEvents: "none",
        }}
      >
        <CornerUpLeft size={14} color={T.muted} />
      </span>

      <div
        className="max-w-[78%] select-none"
        style={{
          transform: `translateX(${shift}px)`,
          transition: shift ? "none" : "transform 260ms cubic-bezier(0.18,0.89,0.32,1.28)",
        }}
      >
        <div
          className="px-3 py-2"
          style={{
            background: mine ? T.coral : T.surface,
            color: mine ? "#fff" : T.ink,
            border: mine ? "none" : `1px solid ${T.line}`,
            // Скруглённый угол «схлопывается» только у последнего в группе:
            // так видно, где реплика кончилась.
            borderRadius: 18,
            borderBottomRightRadius: mine && last ? 5 : 18,
            borderBottomLeftRadius: !mine && last ? 5 : 18,
          }}
        >
          {message.reply_to && (
            <div
              className="mb-1.5 pl-2 py-0.5 rounded"
              style={{
                borderLeft: `2px solid ${mine ? "rgba(255,255,255,0.7)" : T.coral}`,
                background: mine ? "rgba(255,255,255,0.14)" : T.surfaceSoft,
              }}
            >
              <p
                className="text-xs font-semibold truncate"
                style={{ color: mine ? "#fff" : T.coralDeep }}
              >
                {message.reply_to.author}
              </p>
              <p
                className="text-xs truncate"
                style={{ color: mine ? "rgba(255,255,255,0.85)" : T.muted }}
              >
                {message.reply_to.preview}
              </p>
            </div>
          )}

          {photo && (
            <button
              onClick={() => onOpenPhoto(photo)}
              className="block mb-1 overflow-hidden rounded-xl"
              style={{ background: message.gradient || T.surfaceSoft }}
            >
              <img src={photo} alt="" className="max-h-64 w-full object-cover" draggable={false} />
            </button>
          )}

          {message.deleted ? (
            <p className="text-sm italic" style={{ color: mine ? "rgba(255,255,255,0.75)" : T.muted }}>
              сообщение удалено
            </p>
          ) : (
            message.body && (
              <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p>
            )
          )}

          {message.reactions?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {message.reactions.map((reaction) => (
                <button
                  key={reaction.emoji}
                  // Событие останавливаем уже на нажатии: иначе пузырь
                  // считает это началом своего жеста и перехватывает клик.
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onReact?.(message, reaction.emoji);
                  }}
                  className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs active:scale-95 transition-transform"
                  style={{
                    background: reaction.mine
                      ? mine
                        ? "rgba(255,255,255,0.28)"
                        : T.coral
                      : mine
                      ? "rgba(255,255,255,0.14)"
                      : T.surfaceSoft,
                    color: reaction.mine && !mine ? "#fff" : mine ? "#fff" : T.ink,
                  }}
                >
                  <span>{reaction.emoji}</span>
                  {reaction.count > 1 && <span className="font-semibold">{reaction.count}</span>}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-1 mt-0.5">
            {message.edited && (
              <span
                className="text-[10px]"
                style={{ color: mine ? "rgba(255,255,255,0.7)" : T.muted }}
              >
                изменено
              </span>
            )}
            <span
              className="text-[10px]"
              style={{ color: mine ? "rgba(255,255,255,0.8)" : T.muted }}
            >
              {time(message.sent_at)}
            </span>
            {mine &&
              !message.deleted &&
              (message.read_at ? (
                <CheckCheck size={13} color="rgba(255,255,255,0.95)" />
              ) : (
                <Check size={13} color="rgba(255,255,255,0.7)" />
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Меню по долгому нажатию. Своё сообщение можно ещё поправить и убрать. */
function MessageMenu({ message, onClose, onReply, onEdit, onDelete, onReact }) {
  const items = [[CornerUpLeft, "Ответить", onReply]];
  if (message.body) {
    items.push([
      Copy,
      "Копировать",
      () => {
        navigator.clipboard?.writeText(message.body);
        haptic.success();
        onClose();
      },
    ]);
  }
  if (message.mine && !message.deleted) {
    if (message.type === "text") items.push([Pencil, "Изменить", onEdit]);
    items.push([Trash2, "Удалить", onDelete, true]);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center"
      style={{ background: "rgba(20,28,56,0.45)" }}
      onClick={onClose}
    >
      <div
        className="slide-up w-full max-w-md rounded-t-3xl overflow-hidden p-2"
        style={{ background: T.surface }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Реакции — над списком, как в Telegram: это самое частое
            действие, и до него не должно быть пути через меню. */}
        <div className="flex justify-between gap-1 px-2 pt-1 pb-2">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => onReact(emoji)}
              className="w-10 h-10 rounded-full flex items-center justify-center text-xl active:scale-90 transition-transform"
              style={{
                background:
                  message.reactions?.some((r) => r.emoji === emoji && r.mine) ? T.surfaceSoft : "transparent",
              }}
            >
              {emoji}
            </button>
          ))}
        </div>

        {items.map(([Icon, label, action, danger]) => (
          <button
            key={label}
            onClick={action}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left active:scale-95 transition-transform"
          >
            <Icon size={17} color={danger ? T.danger : T.ink} />
            <span className="text-sm font-medium" style={{ color: danger ? T.danger : T.ink }}>
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
