import React, { useEffect, useState } from "react";
import { Calendar, LayoutGrid, MapPin, Radio, Sparkles } from "lucide-react";

import { endpoints } from "../api/client";
import { Pill, Spinner } from "../components/ui";
import { haptic, requestLocation } from "../lib/telegram";
import { T, gradient } from "../theme";

function whenLabel(iso) {
  const date = new Date(iso);
  const now = new Date();
  const hours = (date - now) / 36e5;
  if (hours < 0) return "идёт сейчас";
  if (hours < 24) return `сегодня в ${date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function Home({ me, config, onGoDeck, onGoPack, onGoTest, onError }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(null);
  const [neighbours, setNeighbours] = useState({});

  useEffect(() => {
    endpoints
      .events()
      .then(setEvents)
      .catch((error) => onError(error.detail || error.message))
      .finally(() => setLoading(false));
  }, [onError]);

  async function toggleAttend(event) {
    try {
      const updated = event.attending
        ? await endpoints.unattend(event.id)
        : await endpoints.attend(event.id);
      setEvents((current) => current.map((item) => (item.id === event.id ? updated : item)));
      haptic.select();
    } catch (error) {
      onError(error.detail || error.message);
    }
  }

  async function checkin(event) {
    setCheckingIn(event.id);
    try {
      const coords = await requestLocation();
      await endpoints.checkin(event.id, coords);
      const nearby = await endpoints.liveNearby(event.id);
      setNeighbours((current) => ({ ...current, [event.id]: nearby }));
      haptic.success();
    } catch (error) {
      onError(error.detail || error.message);
    } finally {
      setCheckingIn(null);
    }
  }

  const testDone = Boolean(me.test_completed_at);

  return (
    <div className="px-4 pt-4 pb-4 space-y-3">
      <button
        onClick={onGoDeck}
        className="relative w-full flex items-center gap-3 rounded-2xl p-4 active:scale-95 transition-transform duration-150 overflow-hidden"
        style={{ background: gradient.action }}
      >
        <span className="relative flex-shrink-0" style={{ width: 44, height: 44 }}>
          <span className="absolute rounded-xl" style={{ width: 34, height: 40, background: "rgba(255,255,255,0.35)", left: 6, top: 2, transform: "rotate(-8deg)" }} />
          <span className="absolute rounded-xl" style={{ width: 34, height: 40, background: "#fff", left: 5, top: 0, transform: "rotate(4deg)" }} />
        </span>
        <span className="flex-1 text-left">
          <span className="block text-sm font-bold text-white">Колода</span>
          <span className="block text-xs" style={{ color: "rgba(255,255,255,0.85)" }}>
            Свайп вправо — нравится, влево — мимо
          </span>
        </span>
      </button>

      <button
        onClick={onGoPack}
        className="w-full flex items-center gap-3 rounded-2xl p-4 active:scale-95 transition-transform text-left"
        style={{ background: T.gold }}
      >
        <span className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.15)" }}>
          <LayoutGrid size={17} color="#fff" />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-bold text-white">Пачка скретч-карт</span>
          <span className="block text-xs" style={{ color: "rgba(255,255,255,0.78)" }}>
            Потрите карту, чтобы узнать, кто там
          </span>
        </span>
      </button>

      {!testDone && (
        <button
          onClick={onGoTest}
          className="w-full flex items-center gap-3 rounded-2xl p-4 active:scale-95 transition-transform text-left"
          style={{ background: T.surface, border: `1px solid ${T.line}` }}
        >
          <span className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: T.goldSoft }}>
            <Sparkles size={18} color={T.gold} />
          </span>
          <span className="flex-1">
            <span className="block text-sm font-semibold" style={{ color: T.ink }}>Пройдите мини-тест</span>
            <span className="block text-xs" style={{ color: T.muted }}>6 вопросов — совпадения станут точнее</span>
          </span>
        </button>
      )}

      <div className="pt-2">
        <div className="flex items-center gap-2 mb-2.5 px-1">
          <Calendar size={15} color={T.muted} />
          <span className="text-sm font-semibold" style={{ color: T.ink }}>События в городе</span>
        </div>

        {loading && (
          <div className="flex justify-center py-6"><Spinner /></div>
        )}

        {!loading && !events.length && (
          <p className="text-sm px-1" style={{ color: T.muted }}>
            Событий пока нет. Они подтягиваются из бота KudaGo.
          </p>
        )}

        <div className="space-y-2.5">
          {events.map((event) => (
            <div key={event.id} className="rounded-2xl p-3.5" style={{ background: T.surface, border: `1px solid ${T.line}` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: T.ink }}>{event.title}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <MapPin size={11} color={T.muted} />
                    <span className="text-xs truncate" style={{ color: T.muted }}>
                      {event.venue} · {whenLabel(event.starts_at)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => toggleAttend(event)}
                  className="flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-bold active:scale-95 transition-transform"
                  style={
                    event.attending
                      ? { background: T.coral, color: "#fff" }
                      : { background: T.surfaceSoft, color: T.coralDeep }
                  }
                >
                  {event.attending ? "Иду" : "Пойду"}
                </button>
              </div>

              {event.attending && (
                <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${T.line}` }}>
                  <button
                    onClick={() => checkin(event)}
                    disabled={checkingIn === event.id}
                    className="flex items-center gap-2 text-xs font-semibold active:scale-95 transition-transform"
                    style={{ color: T.coral }}
                  >
                    {checkingIn === event.id ? <Spinner size={13} /> : <Radio size={13} />}
                    Я на месте — включить Live
                  </button>

                  {neighbours[event.id]?.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      {neighbours[event.id].map((person) => (
                        <span
                          key={person.user_id}
                          className="flex items-center gap-2 rounded-full px-2.5 py-1.5"
                          style={{ background: T.bg }}
                        >
                          <span className="w-6 h-6 rounded-full" style={{ background: person.gradient }} />
                          <span className="text-xs font-medium" style={{ color: T.ink }}>
                            {person.first_name} · {person.distance_m} м
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                  {neighbours[event.id]?.length === 0 && (
                    <p className="text-xs mt-2" style={{ color: T.muted }}>
                      Пока никто больше не отметился здесь
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {config.blind_mode && (
        <div className="rounded-2xl p-3.5 flex items-start gap-2.5" style={{ background: T.surfaceSoft }}>
          <Pill tone="gold">режим</Pill>
          <p className="text-xs flex-1" style={{ color: T.ink }}>
            Сначала разговор: фото открывается после {config.reveal_threshold} ваших сообщений в чате.
          </p>
        </div>
      )}
    </div>
  );
}
