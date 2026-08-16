import React, { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";

import { endpoints, mediaUrl } from "../api/client";
import { Avatar, EmptyState, ListSkeleton } from "../components/ui";
import { realtime } from "../lib/realtime";
import { FALLBACK_GRADIENT, T } from "../theme";

// Пауза, за которую очередь входящих событий схлопывается в один запрос.
const RELOAD_DEBOUNCE_MS = 400;

function preview(chat) {
  const last = chat.last_message;
  if (!last) return "Начните разговор";
  if (last.type === "system") return last.body;
  return `${last.mine ? "Вы: " : ""}${last.body}`;
}

function timeLabel(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/** Матчи, в которых ещё не сказано ни слова.
 *
 *  Отдельным экраном их делать незачем: матч без разговора — это не
 *  достижение, а незакрытое дело, и место ему там же, где переписки. Внизу
 *  списка он бы затерялся среди старых чатов, поэтому идёт лентой сверху.
 */
function NewMatches({ chats, onOpenChat }) {
  if (!chats.length) return null;
  return (
    <div className="pt-4">
      <p className="px-4 text-xs font-semibold uppercase tracking-wide" style={{ color: T.muted }}>
        Новые совпадения · {chats.length}
      </p>
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pt-3 pb-1">
        {chats.map((chat) => {
          const photo = chat.other.photos?.[0];
          return (
            <button
              key={chat.id}
              onClick={() => onOpenChat(chat.id)}
              className="flex flex-col items-center gap-1.5 flex-shrink-0 active:scale-95 transition-transform"
              style={{ width: 66 }}
            >
              <Avatar
                src={photo?.url ? mediaUrl(photo.url) : null}
                grad={photo?.gradient || FALLBACK_GRADIENT}
                size={60}
                online={chat.other.is_online}
              />
              <span className="text-xs truncate w-full text-center" style={{ color: T.ink }}>
                {chat.other.first_name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Переключатель «Чаты / Запросы» с числами непрочитанного. */
function Segments({ value, onChange, chats, requests }) {
  const items = [
    ["chats", "Чаты", chats],
    ["requests", "Запросы", requests],
  ];
  return (
    <div className="mx-4 mt-4 p-1 rounded-full flex gap-1" style={{ background: T.surfaceSoft }}>
      {items.map(([key, label, count]) => {
        const active = value === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-full text-sm font-semibold transition-colors duration-200"
            style={{ background: active ? T.ink : "transparent", color: active ? "#fff" : T.muted }}
          >
            {label}
            {count > 0 && (
              <span
                className="text-xs font-bold rounded-full px-1.5 min-w-[20px]"
                style={{
                  background: active ? "rgba(255,255,255,0.22)" : T.line,
                  color: active ? "#fff" : T.muted,
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ChatList({ onOpenChat, requests, onError }) {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState("chats");
  const [likeCount, setLikeCount] = useState(0);

  const reloadTimer = useRef(null);

  function load() {
    endpoints
      .chats()
      .then(setChats)
      .catch((error) => onError(error.detail || error.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // Любое входящее событие меняет порядок или счётчики непрочитанного,
    // но перезапрашивать список на каждое — расточительно: переписка идёт
    // очередями, и десяток сообщений подряд давал десяток одинаковых
    // запросов. Схлопываем их в один.
    const schedule = () => {
      if (reloadTimer.current) return;
      reloadTimer.current = setTimeout(() => {
        reloadTimer.current = null;
        load();
      }, RELOAD_DEBOUNCE_MS);
    };
    const stop = realtime.subscribe((event) => {
      if (["message", "read", "match", "reveal"].includes(event.type)) schedule();
    });
    return () => {
      stop();
      clearTimeout(reloadTimer.current);
      reloadTimer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endpoints.incomingLikesCount().then((data) => setLikeCount(data.count)).catch(() => {});
  }, []);

  if (loading) return <ListSkeleton />;

  const fresh = chats.filter((chat) => !chat.has_conversation);
  const started = chats.filter((chat) => chat.has_conversation);

  const unread = chats.reduce((total, chat) => total + (chat.unread > 0 ? 1 : 0), 0);
  const segments = (
    <Segments value={segment} onChange={setSegment} chats={unread} requests={likeCount} />
  );

  if (segment === "requests") {
    return (
      <div className="pb-4">
        {segments}
        {requests}
      </div>
    );
  }

  if (!chats.length) {
    return (
      <div className="pb-4">
        {segments}
        <EmptyState
          icon={MessageCircle}
          title="Пока пусто"
          hint="Чат появится, когда симпатия окажется взаимной."
        />
      </div>
    );
  }

  return (
    <div className="pb-4">
      {segments}
      <NewMatches chats={fresh} onOpenChat={onOpenChat} />

      {started.length > 0 && fresh.length > 0 && (
        <p className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide" style={{ color: T.muted }}>
          Переписки
        </p>
      )}

      <div className="px-4 pt-3 space-y-2.5">
      {started.map((chat) => {
        const photo = chat.other.photos?.[0];
        return (
          <button
            key={chat.id}
            onClick={() => onOpenChat(chat.id)}
            className="w-full flex items-center gap-3 rounded-2xl p-3 active:scale-95 transition-transform duration-150 text-left"
            style={{ background: T.surface, border: `1px solid ${T.line}` }}
          >
            <Avatar
              src={photo?.url ? mediaUrl(photo.url) : null}
              grad={photo?.gradient || FALLBACK_GRADIENT}
              size={48}
              // Галочка везде означает подтверждённую анкету. Здесь она
              // стояла по `revealed`, а он при выключенном слепом режиме
              // всегда истина — значок доставался каждому.
              verified={chat.other.is_verified}
              online={chat.other.is_online}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold truncate" style={{ color: T.ink }}>
                  {chat.other.first_name}
                </p>
                <span className="text-xs flex-shrink-0" style={{ color: T.muted }}>
                  {timeLabel(chat.last_message_at)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <p className="text-xs truncate" style={{ color: T.muted }}>{preview(chat)}</p>
                {chat.unread > 0 && (
                  <span
                    className="text-xs font-bold rounded-full px-1.5 min-w-[20px] text-center flex-shrink-0"
                    style={{ background: T.coral, color: "#fff" }}
                  >
                    {chat.unread}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
      </div>

      {!started.length && (
        <p className="px-4 pt-6 text-sm text-center" style={{ color: T.muted }}>
          Напишите первым — разговор начинается с одного сообщения.
        </p>
      )}
    </div>
  );
}
