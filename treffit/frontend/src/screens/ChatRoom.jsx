import React, { useCallback, useEffect, useRef, useState } from "react";
import { Flag, Send, Shield } from "lucide-react";

import { endpoints, mediaUrl } from "../api/client";
import { ScratchPhoto } from "../components/Scratch";
import { Avatar, Button, Loading, Sheet } from "../components/ui";
import { realtime } from "../lib/realtime";
import { haptic, showConfirm } from "../lib/telegram";
import { FALLBACK_GRADIENT, T, gradient } from "../theme";

const REPORT_REASONS = [
  ["spam", "Спам или реклама"],
  ["fake", "Фейковая анкета"],
  ["harassment", "Оскорбления, домогательства"],
  ["nudity", "Непристойный контент"],
  ["underage", "Несовершеннолетний"],
  ["scam", "Мошенничество"],
];

export function ChatRoom({ chatId, config, onLeave, onError }) {
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [revealPhoto, setRevealPhoto] = useState(null);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const bottomRef = useRef(null);
  const typingTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      const [chatData, history] = await Promise.all([
        endpoints.chat(chatId),
        endpoints.messages(chatId),
      ]);
      setChat(chatData);
      setMessages(history);
      await endpoints.markRead(chatId);
    } catch (error) {
      onError(error.detail || error.message);
    }
  }, [chatId, onError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return realtime.subscribe((event) => {
      if (event.chat_id !== chatId) return;
      if (event.type === "message") {
        setMessages((current) =>
          current.some((message) => message.id === event.message.id) ? current : [...current, event.message]
        );
        endpoints.markRead(chatId).catch(() => {});
      }
      if (event.type === "typing") {
        setTyping(event.state);
        clearTimeout(typingTimer.current);
        if (event.state) typingTimer.current = setTimeout(() => setTyping(false), 4000);
      }
    });
  }, [chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, typing]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText("");
    try {
      const result = await endpoints.sendMessage(chatId, body);
      setMessages((current) => [
        ...current,
        result.message,
        ...(result.system_message ? [result.system_message] : []),
      ]);
      setChat((current) =>
        current
          ? { ...current, remaining_to_reveal: result.remaining_to_reveal, revealed: result.reveal_unlocked || current.revealed }
          : current
      );
      if (result.reveal_unlocked) {
        haptic.success();
        // The URL only exists now — the server refused it a message ago.
        const photo = await endpoints.chatPhoto(chatId).catch(() => null);
        if (photo) setRevealPhoto(photo);
      }
    } catch (error) {
      setText(body);
      onError(error.detail || error.message);
    } finally {
      setSending(false);
    }
  }

  function handleTyping(value) {
    setText(value);
    realtime.typing(chatId, value.length > 0);
  }

  async function block() {
    if (!(await showConfirm("Заблокировать? Вы исчезнете друг у друга из ленты и чатов."))) return;
    try {
      await endpoints.block(chat.other.id);
      onLeave();
    } catch (error) {
      onError(error.detail || error.message);
    }
  }

  async function report(reason) {
    try {
      await endpoints.report(chat.other.id, reason);
      setSafetyOpen(false);
      onLeave();
    } catch (error) {
      onError(error.detail || error.message);
    }
  }

  if (!chat) return <Loading />;

  const photo = chat.other.photos?.[0];
  const photoSrc = photo?.url ? mediaUrl(photo.url) : null;
  const remaining = chat.remaining_to_reveal;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 flex items-center gap-3" style={{ background: T.surface, borderBottom: `1px solid ${T.line}` }}>
        <Avatar
          src={photoSrc}
          grad={photo?.gradient || FALLBACK_GRADIENT}
          size={44}
          verified={chat.revealed}
          online={chat.other.is_online}
        />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate" style={{ color: T.ink }}>
            {chat.other.first_name}
            {chat.other.age ? `, ${chat.other.age}` : ""}
          </p>
          <p className="text-xs" style={{ color: typing ? T.coral : chat.revealed ? T.gold : T.muted }}>
            {typing
              ? "печатает…"
              : chat.revealed
              ? "фото открыто"
              : config.blind_mode
              ? `ещё ${remaining} сообщ. до фото`
              : chat.other.is_online
              ? "онлайн"
              : "не в сети"}
          </p>
        </div>
        <button onClick={() => setSafetyOpen(true)} className="p-2 rounded-full active:scale-90 transition-transform">
          <Shield size={18} color={T.muted} />
        </button>
      </div>

      {config.blind_mode && !chat.revealed && (
        <div className="px-4 pt-3">
          <div className="flex gap-1">
            {Array.from({ length: config.reveal_threshold }).map((_, index) => (
              <div
                key={index}
                className="h-1 flex-1 rounded-full transition-colors duration-300"
                style={{ background: index < chat.sent_count ? T.coral : T.line }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-3 space-y-2">
        {messages.map((message) => (
          <Bubble key={message.id} message={message} />
        ))}

        {revealPhoto && (
          <div className="py-4 pop-in">
            <p className="text-xs text-center mb-3" style={{ color: T.gold }}>
              Вы открыли фото — потрите, чтобы увидеть
            </p>
            <ScratchPhoto
              size={150}
              src={mediaUrl(revealPhoto.url)}
              grad={revealPhoto.gradient}
              onDone={() => {
                haptic.success();
                load();
              }}
            />
          </div>
        )}

        {typing && (
          <div className="flex gap-1 px-3 py-2 rounded-2xl w-fit" style={{ background: T.surface }}>
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="w-1.5 h-1.5 rounded-full pulse-soft"
                style={{ background: T.muted, animationDelay: `${dot * 160}ms` }}
              />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-3 py-2.5 flex items-end gap-2" style={{ background: T.surface, borderTop: `1px solid ${T.line}` }}>
        <textarea
          value={text}
          onChange={(event) => handleTyping(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Сообщение"
          maxLength={2000}
          className="flex-1 rounded-2xl px-4 py-2.5 text-sm outline-none resize-none max-h-24"
          style={{ background: T.bg, border: `1px solid ${T.line}`, color: T.ink }}
        />
        <button
          onClick={send}
          disabled={!text.trim() || sending}
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform disabled:opacity-40"
          style={{ background: gradient.action }}
        >
          <Send size={17} color="#fff" />
        </button>
      </div>

      <Sheet open={safetyOpen} onClose={() => setSafetyOpen(false)} title="Безопасность">
        <div className="p-4 space-y-2">
          {REPORT_REASONS.map(([value, label]) => (
            <button
              key={value}
              onClick={() => report(value)}
              className="w-full flex items-center gap-3 rounded-2xl p-3.5 text-left active:scale-95 transition-transform"
              style={{ background: T.bg, border: `1px solid ${T.line}` }}
            >
              <Flag size={15} color={T.danger} />
              <span className="text-sm" style={{ color: T.ink }}>{label}</span>
            </button>
          ))}
          <div className="pt-2">
            <Button variant="danger" onClick={block}>Заблокировать</Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function Bubble({ message }) {
  if (message.type === "system") {
    return (
      <p className="text-xs text-center py-2 px-6" style={{ color: T.muted }}>
        {message.body}
      </p>
    );
  }
  const mine = message.mine;
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[78%] rounded-2xl px-3.5 py-2 text-sm"
        style={
          mine
            ? { background: gradient.action, color: "#fff", borderBottomRightRadius: 6 }
            : { background: T.surface, color: T.ink, border: `1px solid ${T.line}`, borderBottomLeftRadius: 6 }
        }
      >
        {message.body}
      </div>
    </div>
  );
}
