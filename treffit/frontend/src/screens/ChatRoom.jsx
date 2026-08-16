import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Flag, ImagePlus, MapPin, Pencil, Send, Shield, X } from "lucide-react";

import { endpoints, mediaUrl } from "../api/client";
import { CompatRing } from "../components/CompatRing";
import { MessageList } from "../components/MessageList";
import { ScratchPhoto } from "../components/Scratch";
import { Avatar, Button, Loading, Pill, Sheet } from "../components/ui";
import { partnerStatus } from "../lib/chatStatus";
import { realtime } from "../lib/realtime";
import { haptic, showConfirm } from "../lib/telegram";
import { FALLBACK_GRADIENT, T, gradient } from "../theme";

// Сколько сообщений отдаёт сервер за раз — им же меряем, есть ли ещё.
const PAGE = 50;
// На сколько можно отойти от низа и всё ещё считаться «внизу».
const BOTTOM_SLACK = 80;
// На каком расстоянии до верха начинать догрузку.
const LOAD_OLDER_AT = 160;

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
  const [profileOpen, setProfileOpen] = useState(false);
  const [zoomed, setZoomed] = useState(null);
  // На что отвечаем и что правим. Одновременно не бывает: правка своего
  // сообщения и ответ на чужое — разные намерения.
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimer = useRef(null);
  const scrollRef = useRef(null);
  // Пролистан ли разговор до низа. От этого зависит, дёргать ли его вниз
  // на новое сообщение: человека, читающего старое, дёргать нельзя.
  const atBottom = useRef(true);
  const fetchingOlder = useRef(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const load = useCallback(async () => {
    try {
      const [chatData, history] = await Promise.all([
        endpoints.chat(chatId),
        endpoints.messages(chatId),
      ]);
      setChat(chatData);
      setMessages(history);
      // Полная страница значит, что выше почти наверняка есть ещё.
      setHasOlder(history.length >= PAGE);
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
      if (event.type === "message_reaction") {
        setMessages((current) =>
          current.map((message) => (message.id === event.message.id ? event.message : message))
        );
      }
      if (event.type === "message_edited") {
        setMessages((current) =>
          current.map((message) => (message.id === event.message.id ? event.message : message))
        );
      }
      if (event.type === "message_deleted") {
        setMessages((current) =>
          current.map((message) =>
            message.id === event.message_id
              ? { ...message, deleted: true, body: "", photo_url: null }
              : message
          )
        );
      }
      if (event.type === "typing") {
        setTyping(event.state);
        clearTimeout(typingTimer.current);
        if (event.state) typingTimer.current = setTimeout(() => setTyping(false), 4000);
      }
    });
  }, [chatId]);

  useEffect(() => {
    if (atBottom.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, typing]);

  /** Догрузить страницу переписки выше текущей.
   *
   *  Сервер умел отдавать её с самого начала, а клиент брал только
   *  последние пятьдесят сообщений и на этом останавливался: длинная
   *  переписка просто обрывалась вверху без всякого признака, что там
   *  что-то было.
   */
  async function loadOlder() {
    const box = scrollRef.current;
    if (!box || fetchingOlder.current || !hasOlder || !messages.length) return;
    fetchingOlder.current = true;
    setLoadingOlder(true);
    const heightBefore = box.scrollHeight;
    try {
      const older = await endpoints.messages(chatId, messages[0].id);
      if (older.length < PAGE) setHasOlder(false);
      if (older.length) {
        setMessages((current) => [...older, ...current]);
        // Вставка сверху сдвигает содержимое вниз. Возвращаем прокрутку на
        // ту же строку, иначе разговор прыгает под пальцем.
        requestAnimationFrame(() => {
          box.scrollTop += box.scrollHeight - heightBefore;
        });
      }
    } catch {
      // Молча: это догрузка на прокрутке, а не действие человека.
    } finally {
      fetchingOlder.current = false;
      setLoadingOlder(false);
    }
  }

  function handleScroll() {
    const box = scrollRef.current;
    if (!box) return;
    atBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < BOTTOM_SLACK;
    if (box.scrollTop < LOAD_OLDER_AT) loadOlder();
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;

    if (editing) {
      const target = editing;
      setSending(true);
      setText("");
      setEditing(null);
      try {
        const saved = await endpoints.editMessage(chatId, target.id, body);
        setMessages((current) => current.map((m) => (m.id === saved.id ? saved : m)));
      } catch (error) {
        setText(body);
        setEditing(target);
        onError(error.detail || error.message);
      } finally {
        setSending(false);
      }
      return;
    }

    setSending(true);
    setText("");
    const quoted = replyTo;
    setReplyTo(null);
    // Своё сообщение всегда показываем: если человек читал старое, отправка
    // — это явное намерение вернуться к концу разговора.
    atBottom.current = true;
    try {
      const result = await endpoints.sendMessage(chatId, body, quoted?.id ?? null);
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
        // Флаг выше — только для шапки. Сама анкета собеседника пришла ещё
        // закрытой: без фотографий и с photos_locked. Если её не перечитать,
        // чат говорит «фото открыто», а в анкете остаётся замок — до тех пор,
        // пока экран не откроют заново.
        load();
      }
    } catch (error) {
      setText(body);
      setReplyTo(quoted);
      onError(error.detail || error.message);
    } finally {
      setSending(false);
    }
  }

  async function sendPhoto(file) {
    if (!file || sending) return;
    setSending(true);
    const quoted = replyTo;
    setReplyTo(null);
    atBottom.current = true;
    try {
      const result = await endpoints.sendChatPhoto(chatId, file, text.trim(), quoted?.id ?? null);
      setText("");
      setMessages((current) => [...current, result.message]);
      haptic.light();
    } catch (error) {
      setReplyTo(quoted);
      onError(error.detail || error.message);
    } finally {
      setSending(false);
    }
  }

  async function removeMessage(message) {
    if (!(await showConfirm("Удалить сообщение? Оно исчезнет у обоих."))) return;
    try {
      const gone = await endpoints.deleteMessage(chatId, message.id);
      setMessages((current) => current.map((m) => (m.id === gone.id ? gone : m)));
    } catch (error) {
      onError(error.detail || error.message);
    }
  }

  async function react(message, emoji) {
    try {
      const updated = await endpoints.reactToMessage(chatId, message.id, emoji);
      setMessages((current) => current.map((m) => (m.id === updated.id ? updated : m)));
    } catch (error) {
      onError(error.detail || error.message);
    }
  }

  function startEditing(message) {
    setReplyTo(null);
    setEditing(message);
    setText(message.body);
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
  const status = partnerStatus({
    typing,
    blindMode: config.blind_mode,
    revealed: chat.revealed,
    remaining: chat.remaining_to_reveal,
    online: chat.other.is_online,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 flex items-center gap-3" style={{ background: T.surface, borderBottom: `1px solid ${T.line}` }}>
        {/* Вся шапка — вход в анкету: это единственное место, откуда до неё
            можно дойти из чата. */}
        <button
          onClick={() => {
            haptic.light();
            setProfileOpen(true);
          }}
          className="flex items-center gap-3 flex-1 min-w-0 text-left active:opacity-70 transition-opacity"
        >
          <Avatar
            src={photoSrc}
            grad={photo?.gradient || FALLBACK_GRADIENT}
            size={44}
            // Галочка во всём приложении означает подтверждённую анкету.
            // Здесь она стояла по `revealed`, и с выключенным слепым
            // режимом её получал каждый собеседник — приложение молча
            // утверждало о человеке то, чего не проверяло.
            verified={chat.other.is_verified}
            online={chat.other.is_online}
          />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate" style={{ color: T.ink }}>
              {chat.other.first_name}
              {chat.other.age ? `, ${chat.other.age}` : ""}
            </p>
            <p
              className="text-xs truncate"
              style={{
                color:
                  status.tone === "typing"
                    ? T.coral
                    : status.tone === "precious"
                    ? T.gold
                    : T.muted,
              }}
            >
              {status.text}
            </p>
          </div>
          <ChevronRight size={16} color={T.muted} className="flex-shrink-0" />
        </button>
        <button
          onClick={() => setSafetyOpen(true)}
          aria-label="Пожаловаться или заблокировать"
          className="p-2 rounded-full active:scale-90 transition-transform flex-shrink-0"
        >
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

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto no-scrollbar px-4 py-3"
      >
        {loadingOlder && (
          <p className="text-center text-xs py-2" style={{ color: T.muted }}>
            Загружаем…
          </p>
        )}
        <MessageList
          messages={messages}
          onReply={(message) => {
            setEditing(null);
            setReplyTo(message);
            haptic.light();
          }}
          onEdit={startEditing}
          onDelete={removeMessage}
          onReact={react}
          onOpenPhoto={setZoomed}
        >

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
        </MessageList>
        <div ref={bottomRef} />
      </div>

      <div style={{ background: T.surface, borderTop: `1px solid ${T.line}` }}>
        {(replyTo || editing) && (
          <div className="flex items-center gap-2 px-3 pt-2">
            <div
              className="flex-1 min-w-0 pl-2 py-1 rounded"
              style={{ borderLeft: `2px solid ${T.coral}`, background: T.surfaceSoft }}
            >
              <p className="text-xs font-semibold" style={{ color: T.coralDeep }}>
                {editing ? "Изменение" : `Ответ ${replyTo.mine ? "себе" : "собеседнику"}`}
              </p>
              <p className="text-xs truncate" style={{ color: T.muted }}>
                {(editing || replyTo).body || "фотография"}
              </p>
            </div>
            <button
              onClick={() => {
                setReplyTo(null);
                if (editing) setText("");
                setEditing(null);
              }}
              aria-label="Отменить"
              className="p-1.5 rounded-full active:scale-90 transition-transform flex-shrink-0"
              style={{ background: T.surfaceSoft }}
            >
              <X size={14} color={T.muted} />
            </button>
          </div>
        )}

        <div className="px-3 py-2.5 flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            sendPhoto(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {!editing && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={sending}
            aria-label="Отправить фото"
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform disabled:opacity-40"
            style={{ background: T.surfaceSoft }}
          >
            <ImagePlus size={18} color={T.muted} />
          </button>
        )}
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
          {editing ? <Pencil size={16} color="#fff" /> : <Send size={17} color="#fff" />}
        </button>
        </div>
      </div>

      <Sheet
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        title={chat.other.first_name}
      >
        <PartnerProfile
          partner={chat.other}
          remaining={config.blind_mode && !chat.revealed ? chat.remaining_to_reveal : 0}
          onZoom={setZoomed}
        />
      </Sheet>

      {zoomed && <PhotoViewer src={zoomed} onClose={() => setZoomed(null)} />}

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

/** Анкета собеседника, как её видно из чата.
 *
 *  Всё нужное уже лежит в `chat.other` — сервер отдаёт ту же анкету, что и в
 *  поиске, и сам решает, вкладывать ли ссылки на фото. Если фото ещё не
 *  открыты, в `url` приходит null, и показывать тут нечего, кроме градиента.
 */
function PartnerProfile({ partner, remaining, onZoom }) {
  const photos = (partner.photos || []).filter((item) => item.url);
  // Скрыто и не добавлено — разные вещи: во втором случае ждать нечего.
  const locked = partner.photos_locked;
  const empty = !locked && photos.length === 0;

  return (
    <div className="px-5 pt-4 pb-6">
      {locked || empty ? (
        <div
          className="rounded-2xl flex flex-col items-center justify-center text-center px-6"
          style={{
            height: 200,
            background: partner.photos?.[0]?.gradient || FALLBACK_GRADIENT,
          }}
        >
          <span className="text-xs font-bold tracking-widest text-white/90">
            {empty ? "БЕЗ ФОТО" : "ФОТО СКРЫТО"}
          </span>
          <span className="text-xs mt-2 text-white/75">
            {empty
              ? "Собеседник ещё не добавил фотографий"
              : remaining > 0
              ? `Откроется после ${remaining} ваших сообщений`
              : "Откроется, когда разговор начнётся"}
          </span>
        </div>
      ) : (
        // Больше одного фото листается вбок; одно занимает всю ширину.
        <div className={`flex gap-2 ${photos.length > 1 ? "overflow-x-auto no-scrollbar -mx-1 px-1" : ""}`}>
          {photos.map((item) => (
            <button
              key={item.url}
              onClick={() => onZoom(mediaUrl(item.url))}
              className="rounded-2xl overflow-hidden flex-shrink-0 active:scale-95 transition-transform"
              style={{
                width: photos.length > 1 ? "72%" : "100%",
                height: 260,
                background: item.gradient || FALLBACK_GRADIENT,
              }}
            >
              <img src={mediaUrl(item.url)} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-4">
        <h2 className="font-display text-xl" style={{ color: T.ink }}>
          {partner.first_name}
          {partner.age ? `, ${partner.age}` : ""}
        </h2>
        {partner.is_verified && <Pill tone="success">проверен</Pill>}
        {partner.is_online && <Pill tone="muted">онлайн</Pill>}
      </div>

      {partner.city && (
        <div className="flex items-center gap-1.5 mt-1">
          <MapPin size={13} color={T.muted} />
          <span className="text-sm" style={{ color: T.muted }}>{partner.city}</span>
        </div>
      )}

      {partner.bio && (
        <p className="text-sm mt-3 whitespace-pre-wrap" style={{ color: T.ink }}>{partner.bio}</p>
      )}

      {(partner.interests || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {partner.interests.map((interest) => (
            <Pill key={interest} tone="muted">{interest}</Pill>
          ))}
        </div>
      )}

      <div className="flex flex-col items-center mt-5">
        <CompatRing percent={partner.compatibility_pct} size={104} />
        <span className="text-xs mt-2" style={{ color: T.muted }}>совпадение по тесту</span>
      </div>

      {(partner.shared_flags || []).length > 0 && (
        <div className="mt-4 space-y-2">
          {partner.shared_flags.map((flag) => (
            <div
              key={flag}
              className="flex items-center gap-2.5 rounded-2xl p-3"
              style={{ background: T.bg, border: `1px solid ${T.line}` }}
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: T.goldSoft }}
              >
                <Flag size={13} color={T.gold} />
              </span>
              <span className="text-sm" style={{ color: T.ink }}>{flag}</span>
            </div>
          ))}
        </div>
      )}

      {partner.event && (
        <div
          className="flex items-center gap-2.5 rounded-2xl p-3 mt-2"
          style={{ background: "#E1EBFF", border: `1px solid ${T.line}` }}
        >
          <span className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#FFFFFF" }}>
            <MapPin size={13} color={T.coral} />
          </span>
          <span className="text-sm" style={{ color: T.ink }}>{partner.event.title}</span>
        </div>
      )}
    </div>
  );
}

/** Фото на весь экран. Закрывается касанием в любом месте. */
function PhotoViewer({ src, onClose }) {
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      // Выше попапа матча (z-70): фото открывают намеренно, оно главное.
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: "rgba(10,14,30,0.94)" }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Закрыть"
        className="absolute top-4 right-4 p-2 rounded-full active:scale-90 transition-transform"
        style={{ background: "rgba(255,255,255,0.14)" }}
      >
        <X size={20} color="#fff" />
      </button>
      <img src={src} alt="" className="max-w-full max-h-full object-contain rounded-2xl" />
    </div>
  );
}

