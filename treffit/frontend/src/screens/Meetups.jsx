import React, { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, Check, ChevronRight, MapPin, Plus, Trash2, Users, X } from "lucide-react";

import { endpoints, mediaUrl } from "../api/client";
import { Avatar, Button, Loading, Sheet, Spinner } from "../components/ui";
import { haptic, showConfirm } from "../lib/telegram";
import { T } from "../theme";

const PASS = "pass";
const INTERESTED = "interested";

/** Когда событие. Форматом совпадает с афишей, чтобы два раздела читались
 *  одинаково. */
export function whenLabel(startsAt) {
  const date = new Date(startsAt);
  const hours = (date - new Date()) / 36e5;
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (hours < 24 && date.getDate() === new Date().getDate()) return `сегодня в ${time}`;
  return `${date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} в ${time}`;
}

/**
 * Раздел «События»: то, что завели сами люди.
 *
 * Карточки листаются как анкеты, но решение здесь другое: «пойду» — это
 * отклик, а не совпадение. Переписку открывает автор, увидев, кто
 * откликнулся.
 */
const SECTIONS = [
  ["feed", "Лента"],
  ["going", "Я иду"],
  ["mine", "Мои"],
];

/**
 * Раздел «События»: то, что затевают сами люди.
 *
 * Три вкладки, и каждая отвечает на свой вопрос. «Лента» — на что можно
 * пойти. «Я иду» — куда я уже собрался: отклик убирает карточку из ленты,
 * решение принято, но само событие человеку по-прежнему нужно, иначе
 * отклик означал бы «забудь». «Мои» — что я завёл, как оно выглядит со
 * стороны и кто откликнулся.
 */
export function Meetups({ me, onError }) {
  const [section, setSection] = useState("feed");
  const [creating, setCreating] = useState(false);
  const [feed, setFeed] = useState(null);
  const [going, setGoing] = useState(null);
  const [mine, setMine] = useState(null);
  const [busy, setBusy] = useState(false);
  const answered = useRef(new Set());

  const load = useCallback(async () => {
    try {
      const [list, plans, own] = await Promise.all([
        endpoints.meetups(),
        endpoints.meetupsGoing(),
        endpoints.myMeetups(),
      ]);
      setFeed(list.filter((card) => !answered.current.has(card.id)));
      setGoing(plans);
      setMine(own);
    } catch (error) {
      onError(error.detail || error.message);
      setFeed((current) => current || []);
      setGoing((current) => current || []);
      setMine((current) => current || []);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(meetup, action) {
    if (busy) return;
    setBusy(true);
    answered.current.add(meetup.id);
    setFeed((current) => (current || []).filter((card) => card.id !== meetup.id));
    haptic.light();
    try {
      await endpoints.respondToMeetup(meetup.id, action);
      // Откликнулись — карточка переезжает в «Я иду», и её надо оттуда
      // забрать. «Не сейчас» просто исчезает.
      if (action === INTERESTED) setGoing(await endpoints.meetupsGoing());
    } catch (error) {
      answered.current.delete(meetup.id);
      setFeed((current) => [meetup, ...(current || [])]);
      onError(error.detail || error.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(meetup) {
    if (!(await showConfirm(`Снять «${meetup.topic}»?`))) return;
    try {
      await endpoints.cancelMeetup(meetup.id);
      load();
    } catch (error) {
      onError(error.detail || error.message);
    }
  }

  const waiting = (going || []).length;
  const responses = (mine || []).reduce((sum, item) => sum + (item.responses || 0), 0);
  const counts = { feed: 0, going: waiting, mine: responses };
  const lists = { feed, going, mine };
  const current = lists[section];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0"
        style={{ background: T.surface, borderBottom: `1px solid ${T.line}` }}
      >
        <div className="flex-1 p-1 rounded-full flex gap-1" style={{ background: T.surfaceSoft }}>
          {SECTIONS.map(([key, label]) => {
            const active = section === key;
            return (
              <button
                key={key}
                onClick={() => setSection(key)}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-full text-sm font-semibold transition-colors duration-200"
                style={{ background: active ? T.ink : "transparent", color: active ? "#fff" : T.muted }}
              >
                {label}
                {counts[key] > 0 && (
                  <span
                    className="text-xs font-bold rounded-full px-1.5"
                    style={{
                      background: active ? "rgba(255,255,255,0.22)" : T.line,
                      color: active ? "#fff" : T.muted,
                    }}
                  >
                    {counts[key]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setCreating(true)}
          aria-label="Создать событие"
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
          style={{ background: T.coral }}
        >
          <Plus size={19} color="#fff" strokeWidth={2.5} />
        </button>
      </div>

      {current === null ? (
        <Loading label="Смотрим, что затевают…" />
      ) : !current.length ? (
        <EmptyCard
          title={EMPTY[section].title(me?.city)}
          hint={EMPTY[section].hint}
          onCreate={section === "going" ? null : () => setCreating(true)}
        />
      ) : (
        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-3 space-y-3">
          {current.map((meetup) => (
            <MeetupCard
              key={meetup.id}
              meetup={meetup}
              footer={
                section === "feed" ? (
                  <div className="flex gap-2 mt-3.5">
                    <button
                      onClick={() => decide(meetup, PASS)}
                      disabled={busy}
                      className="flex-1 rounded-2xl py-2.5 text-sm font-semibold active:scale-95 transition-transform disabled:opacity-40"
                      style={{ background: T.surfaceSoft, color: T.muted }}
                    >
                      Не сейчас
                    </button>
                    <button
                      onClick={() => decide(meetup, INTERESTED)}
                      disabled={busy}
                      className="flex-1 rounded-2xl py-2.5 text-sm font-bold active:scale-95 transition-transform disabled:opacity-40"
                      style={{ background: T.coral, color: "#fff" }}
                    >
                      Пойду
                    </button>
                  </div>
                ) : section === "going" ? (
                  <GoingStatus meetup={meetup} />
                ) : (
                  <OwnFooter meetup={meetup} onCancel={() => cancel(meetup)} onError={onError} />
                )
              }
            />
          ))}
        </div>
      )}

      <CreateMeetup
        open={creating}
        city={me?.city}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setSection("mine");
          load();
        }}
        onError={onError}
      />
    </div>
  );
}

const EMPTY = {
  feed: {
    title: (city) => (city ? `В городе ${city} пока тихо` : "Пока тихо"),
    hint: "Здесь события, которые придумывают сами люди: сходить куда-то компанией, поиграть вечером, обсудить что-нибудь.",
  },
  going: {
    title: () => "Планов пока нет",
    hint: "Откликнитесь на событие в ленте — оно появится здесь, чтобы не потерялось.",
  },
  mine: {
    title: () => "Вы пока ничего не заводили",
    hint: "Своё событие видят люди из вашего города. Откликнувшихся вы увидите здесь.",
  },
};

/** Что стало с откликом: автор ещё думает или уже написал. */
function GoingStatus({ meetup }) {
  const accepted = meetup.response_status === "accepted";
  return (
    <div
      className="flex items-center gap-1.5 mt-3.5 pt-3"
      style={{ borderTop: `1px solid ${T.line}` }}
    >
      <Check size={14} color={accepted ? T.coralDeep : T.muted} strokeWidth={2.6} />
      <span className="text-sm font-semibold" style={{ color: accepted ? T.coralDeep : T.muted }}>
        {accepted ? "Автор написал вам" : "Вы откликнулись, ждём ответа автора"}
      </span>
    </div>
  );
}

/** Низ своей карточки: сколько откликов, кто именно, и как снять. */
function OwnFooter({ meetup, onCancel, onError }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3.5 pt-3" style={{ borderTop: `1px solid ${T.line}` }}>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((value) => !value)}
          disabled={!meetup.responses}
          className="flex-1 flex items-center justify-between text-sm font-semibold disabled:opacity-100"
          style={{ color: meetup.responses ? T.coralDeep : T.muted }}
        >
          {meetup.responses ? `Откликнулись: ${meetup.responses}` : "Откликов пока нет"}
          {meetup.responses > 0 && <ChevronRight size={15} color={T.muted} />}
        </button>
        <button
          onClick={onCancel}
          aria-label="Снять событие"
          className="p-1.5 rounded-full flex-shrink-0 active:scale-90 transition-transform"
          style={{ background: T.surfaceSoft }}
        >
          <Trash2 size={14} color={T.danger} />
        </button>
      </div>
      {open && meetup.responses > 0 && <Responders meetupId={meetup.id} onError={onError} />}
    </div>
  );
}

/**
 * Пусто — но не пустой экран.
 *
 * Общая заглушка центрируется по всей высоте, и на телефоне это полэкрана
 * ничего сверху и столько же снизу: раздел выглядит недоделанным, а не
 * пустым. Здесь карточка стоит там же, где стояла бы первая настоящая, —
 * сразу под панелью.
 */
function EmptyCard({ title, hint, onCreate }) {
  return (
    <div className="px-4 pt-3">
      <div
        className="rounded-3xl px-5 py-6 text-center"
        style={{ background: T.surface, border: `1px solid ${T.line}` }}
      >
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3.5"
          style={{ background: T.surfaceSoft }}
        >
          <Users size={24} color={T.coral} />
        </div>
        <p className="font-display text-lg" style={{ color: T.ink }}>{title}</p>
        <p className="text-sm mt-1.5 mb-5" style={{ color: T.muted }}>{hint}</p>
        {onCreate && <Button onClick={onCreate}>Создать событие</Button>}
      </div>
    </div>
  );
}

/** Карточка события. Низ у каждого раздела свой, всё остальное общее:
 *  автор должен видеть своё событие ровно таким, каким его видят люди. */
function MeetupCard({ meetup, footer }) {
  const cover = meetup.image_url ? mediaUrl(meetup.image_url) : null;
  return (
    <div
      className="rounded-3xl overflow-hidden"
      style={{ background: T.surface, border: `1px solid ${T.line}` }}
    >
      <div className="relative" style={{ background: meetup.gradient, aspectRatio: "16 / 10" }}>
        {cover && <img src={cover} alt="" className="w-full h-full object-cover" />}
        <div
          className="absolute inset-x-0 bottom-0 pt-10 pb-3 px-4"
          style={{ background: "linear-gradient(to top, rgba(8,8,12,0.9), rgba(8,8,12,0))" }}
        >
          <h3 className="font-display text-xl text-white leading-tight">{meetup.topic}</h3>
        </div>
      </div>

      <div className="p-3.5">
        <div className="flex items-center gap-2.5">
          <Avatar
            src={meetup.author.photo_url ? mediaUrl(meetup.author.photo_url) : null}
            grad={meetup.author.gradient}
            size={34}
            ring={false}
            verified={meetup.author.is_verified}
          />
          <span className="text-sm font-semibold" style={{ color: T.ink }}>
            {meetup.author.first_name}
            {meetup.author.age ? `, ${meetup.author.age}` : ""}
          </span>
        </div>

        <div className="flex items-center gap-1 mt-2.5">
          <CalendarClock size={12} color={T.muted} className="flex-shrink-0" />
          <span className="text-xs" style={{ color: T.muted }}>{whenLabel(meetup.starts_at)}</span>
        </div>
        <div className="flex items-start gap-1 mt-1">
          <MapPin size={12} color={T.muted} className="flex-shrink-0 mt-0.5" />
          <span className="text-xs" style={{ color: T.muted }}>{meetup.address}</span>
        </div>

        {meetup.description && (
          <p className="text-sm mt-2.5 whitespace-pre-line" style={{ color: T.ink }}>
            {meetup.description}
          </p>
        )}

        {footer}
      </div>
    </div>
  );
}

/** Форма своего события. Город подставлен из анкеты — менять его здесь
 *  можно, но чаще всего не нужно. */
function CreateMeetup({ open, city, onClose, onCreated, onError }) {
  const [form, setForm] = useState({ topic: "", address: "", date: "", time: "", description: "" });
  const [image, setImage] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ topic: "", address: "", date: "", time: "", description: "" });
      setImage(null);
    }
  }, [open]);

  const preview = image ? URL.createObjectURL(image) : null;
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const ready = form.topic.trim().length >= 3 && form.address.trim().length >= 3 && form.date && form.time;

  async function submit() {
    if (!ready || saving) return;
    setSaving(true);
    try {
      // Местное время пользователя переводим в момент времени: сервер
      // хранит всё в UTC, а «19:00» без часового пояса он прочитал бы как
      // UTC и сдвинул бы событие на пять часов.
      const startsAt = new Date(`${form.date}T${form.time}`).toISOString();
      await endpoints.createMeetup(
        {
          city,
          address: form.address.trim(),
          starts_at: startsAt,
          topic: form.topic.trim(),
          description: form.description.trim(),
        },
        image
      );
      haptic.success();
      onCreated();
    } catch (error) {
      onError(error.detail || error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Своё событие">
      <div className="p-4 space-y-3">
        <Field
          label="Тема"
          value={form.topic}
          onChange={(topic) => setForm((f) => ({ ...f, topic }))}
          placeholder="Настолки вечером, ищу компанию"
          maxLength={120}
        />
        <Field
          label={`Адрес${city ? ` · ${city}` : ""}`}
          value={form.address}
          onChange={(address) => setForm((f) => ({ ...f, address }))}
          placeholder="ул. Вайнера, 11"
          maxLength={255}
        />

        <WhenPicker
          date={form.date}
          time={form.time}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        />

        <Field
          label="Описание"
          value={form.description}
          onChange={(description) => setForm((f) => ({ ...f, description }))}
          placeholder="Что будет, кого ищете, чего ждёте"
          maxLength={2000}
          rows={3}
        />

        <div>
          <p className="text-xs mb-1.5" style={{ color: T.muted }}>Картинка — необязательно</p>
          <label
            className="flex items-center justify-center rounded-2xl overflow-hidden cursor-pointer"
            style={{
              background: preview ? "transparent" : T.surfaceSoft,
              border: `1px dashed ${T.line}`,
              height: 96,
            }}
          >
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => setImage(event.target.files?.[0] || null)}
            />
            {preview ? (
              <img src={preview} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-sm" style={{ color: T.muted }}>Выбрать картинку</span>
            )}
          </label>
          {image && (
            <button
              onClick={() => setImage(null)}
              className="flex items-center gap-1 mt-1.5 text-xs active:scale-95 transition-transform"
              style={{ color: T.muted }}
            >
              <X size={12} /> убрать
            </button>
          )}
        </div>

        <Button onClick={submit} disabled={!ready} loading={saving}>Опубликовать</Button>
      </div>
    </Sheet>
  );
}

/** Ближайшие дни и вечерние часы одним касанием.
 *
 *  Нативные поля даты и времени на телефоне — это выпадающий барабан на
 *  два экрана ради «сегодня в девять», и они же разъезжались вширь:
 *  собственная ширина у них больше колонки, и форму уводило вбок.
 *  Барабан остался под кнопкой «другое» — для дальних дат он удобнее.
 */
function WhenPicker({ date, time, onChange }) {
  const [custom, setCustom] = useState(false);

  const days = [0, 1, 2].map((shift) => {
    const day = new Date();
    day.setDate(day.getDate() + shift);
    const value = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(
      day.getDate()
    ).padStart(2, "0")}`;
    const label = shift === 0 ? "Сегодня" : shift === 1 ? "Завтра" : "Послезавтра";
    return [value, label];
  });
  const hours = ["18:00", "19:00", "20:00", "21:00", "22:00"];
  const known = days.some(([value]) => value === date) && (!time || hours.includes(time));

  return (
    <div className="space-y-2">
      <p className="text-xs" style={{ color: T.muted }}>Когда</p>

      {!custom && (
        <>
          <div className="flex gap-1.5">
            {days.map(([value, label]) => (
              <Chip key={value} active={date === value} onClick={() => onChange({ date: value })}>
                {label}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {hours.map((value) => (
              <Chip key={value} active={time === value} onClick={() => onChange({ time: value })}>
                {value}
              </Chip>
            ))}
          </div>
        </>
      )}

      {custom && (
        <div className="flex gap-2">
          <Field type="date" label="Дата" value={date} onChange={(value) => onChange({ date: value })} />
          <Field type="time" label="Время" value={time} onChange={(value) => onChange({ time: value })} />
        </div>
      )}

      <button
        onClick={() => setCustom((value) => !value)}
        className="text-xs font-semibold active:scale-95 transition-transform"
        style={{ color: T.coralDeep }}
      >
        {custom ? "← Ближайшие дни" : "Другая дата или время"}
      </button>

      {!custom && !known && (date || time) && (
        <p className="text-xs" style={{ color: T.muted }}>
          Выбрано: {date || "дата не выбрана"} {time || ""}
        </p>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-3 py-1.5 text-sm font-semibold active:scale-95 transition-transform"
      style={{
        background: active ? T.ink : T.surfaceSoft,
        color: active ? "#fff" : T.muted,
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, value, onChange, type = "text", rows, ...rest }) {
  const shared = {
    value,
    onChange: (event) => onChange(event.target.value),
    className: "w-full min-w-0 rounded-2xl px-3.5 py-2.5 outline-none",
    // 16px, иначе Safari на iOS увеличивает страницу при фокусе и вёрстка
    // разъезжается по горизонтали.
    style: { background: T.surfaceSoft, color: T.ink, border: `1px solid ${T.line}`, fontSize: 16 },
    ...rest,
  };
  return (
    <label className="block flex-1 min-w-0">
      <span className="block text-xs mb-1.5" style={{ color: T.muted }}>{label}</span>
      {rows ? <textarea rows={rows} {...shared} /> : <input type={type} {...shared} />}
    </label>
  );
}

/** Свои события и те, кто на них откликнулся. */
function Responders({ meetupId, onError }) {
  const [people, setPeople] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      setPeople(await endpoints.meetupResponses(meetupId));
    } catch (error) {
      onError(error.detail || error.message);
      setPeople([]);
    }
  }, [meetupId, onError]);

  useEffect(() => {
    load();
  }, [load]);

  async function accept(person) {
    setBusyId(person.user_id);
    try {
      await endpoints.acceptResponder(meetupId, person.user_id);
      haptic.success();
      load();
    } catch (error) {
      onError(error.detail || error.message);
    } finally {
      setBusyId(null);
    }
  }

  if (people === null) {
    return (
      <div className="flex justify-center py-3">
        <Spinner size={16} />
      </div>
    );
  }

  return (
    <div className="mt-2.5 space-y-2">
      {people.map((person) => (
        <div key={person.user_id} className="flex items-center gap-2.5">
          <Avatar
            src={person.photo_url ? mediaUrl(person.photo_url) : null}
            grad={person.gradient}
            size={34}
            ring={false}
            verified={person.is_verified}
          />
          <span className="flex-1 text-sm truncate" style={{ color: T.ink }}>
            {person.first_name}
            {person.age ? `, ${person.age}` : ""}
          </span>
          {person.chat_id ? (
            <span className="text-xs font-semibold" style={{ color: T.muted }}>чат открыт</span>
          ) : (
            <button
              onClick={() => accept(person)}
              disabled={busyId === person.user_id}
              className="rounded-full px-3 py-1.5 text-xs font-bold active:scale-95 transition-transform disabled:opacity-40"
              style={{ background: T.coral, color: "#fff" }}
            >
              Написать
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
