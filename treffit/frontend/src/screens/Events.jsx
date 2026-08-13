import React, { useEffect, useState } from "react";
import { Calendar, MapPin, Radio } from "lucide-react";

import { endpoints } from "../api/client";
import { EmptyState, Spinner } from "../components/ui";
import { haptic, requestLocation } from "../lib/telegram";
import { T } from "../theme";

function whenLabel(iso) {
  const date = new Date(iso);
  const now = new Date();
  const hours = (date - now) / 36e5;
  if (hours < 0) return "идёт сейчас";
  if (hours < 24) return `сегодня в ${date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function Events({ onError }) {
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

  return (
    <div className="px-4 pt-4 pb-4">
      <div>
        {loading && (
          <div className="flex justify-center py-6"><Spinner /></div>
        )}

        {!loading && !events.length && (
          <EmptyState
            icon={Calendar}
            title="Пока тихо"
            hint="Здесь появятся концерты, выставки и вечеринки — и те, кто на них идёт."
          />
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

    </div>
  );
}
