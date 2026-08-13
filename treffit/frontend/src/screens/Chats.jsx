import React, { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";

import { endpoints, mediaUrl } from "../api/client";
import { Avatar, EmptyState, Loading } from "../components/ui";
import { realtime } from "../lib/realtime";
import { FALLBACK_GRADIENT, T } from "../theme";

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

export function ChatList({ onOpenChat, onError }) {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);

  function load() {
    endpoints
      .chats()
      .then(setChats)
      .catch((error) => onError(error.detail || error.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // Any inbound event can change ordering or unread counts.
    return realtime.subscribe((event) => {
      if (["message", "read", "match", "reveal"].includes(event.type)) load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <Loading />;

  if (!chats.length) {
    return (
      <EmptyState
        icon={MessageCircle}
        title="Пока пусто"
        hint="Чат появится, когда симпатия окажется взаимной."
      />
    );
  }

  return (
    <div className="px-4 pt-4 space-y-2.5 pb-4">
      {chats.map((chat) => {
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
              verified={chat.revealed}
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
  );
}
