import React, { useEffect, useState } from "react";
import { Flag, LayoutGrid, MapPin } from "lucide-react";

import { endpoints, mediaUrl } from "../api/client";
import { CompatRing } from "../components/CompatRing";
import { ScratchCover } from "../components/Scratch";
import { Avatar, Button, EmptyState, Loading, Pill } from "../components/ui";
import { haptic } from "../lib/telegram";
import { FALLBACK_GRADIENT, T } from "../theme";

/**
 * The scratch pack — Treffit's own discovery mode.
 *
 * An unscratched card carries no candidate data at all; scratching calls
 * the server, which is what actually hands over the profile.
 */
export function Pack({ onOpenCandidate, onError }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    endpoints
      .deck()
      .then(setCards)
      .catch((error) => onError(error.detail || error.message))
      .finally(() => setLoading(false));
  }, [onError]);

  async function reveal(cardId) {
    try {
      const revealed = await endpoints.scratch(cardId);
      setCards((current) => current.map((card) => (card.id === cardId ? revealed : card)));
    } catch (error) {
      onError(error.detail || error.message);
    }
  }

  if (loading) return <Loading label="Собираем пачку…" />;

  if (!cards.length) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title="Пачка пуста"
        hint="Новые карты появятся, когда подойдут новые люди."
      />
    );
  }

  return (
    <div className="px-4 pt-4 pb-4">
      <p className="text-xs mb-3" style={{ color: T.muted }}>
        Проведите пальцем по карте, чтобы открыть
      </p>
      <div className="grid grid-cols-2 gap-3">
        {cards.map((card) => (
          <PackCard key={card.id} card={card} onReveal={reveal} onOpen={onOpenCandidate} />
        ))}
      </div>
    </div>
  );
}

function PackCard({ card, onReveal, onOpen }) {
  const candidate = card.candidate;
  const photo = candidate?.photos?.[0];

  const face = (
    <button
      onClick={() => candidate && onOpen(candidate)}
      disabled={!candidate}
      className="w-full flex flex-col items-center text-center p-3.5 active:scale-95 transition-transform duration-150"
      style={{ background: T.surface, border: `1px solid ${T.line}`, minHeight: 178 }}
    >
      <Avatar
        src={photo?.url ? mediaUrl(photo.url) : null}
        grad={photo?.gradient || FALLBACK_GRADIENT}
        size={64}
        verified={candidate?.is_verified}
      />
      <span className="text-sm font-semibold mt-2 truncate w-full" style={{ color: T.ink }}>
        {candidate ? `${candidate.first_name}${candidate.age ? `, ${candidate.age}` : ""}` : "…"}
      </span>
      {candidate && <Pill>{candidate.compatibility_pct}% совпадение</Pill>}
      {candidate?.event && (
        <div className="flex items-center gap-1 mt-2 w-full justify-center">
          <MapPin size={10} color={T.gold} />
          <span className="text-xs truncate" style={{ color: T.muted }}>{candidate.event.title}</span>
        </div>
      )}
    </button>
  );

  if (card.scratched) {
    return <div className="rounded-2xl overflow-hidden" style={{ boxShadow: "0 8px 20px -14px rgba(30,40,90,0.28)" }}>{face}</div>;
  }

  return (
    <ScratchCover
      lines={["ПОТРИ", "КАРТУ"]}
      threshold={0.5}
      onDone={() => {
        haptic.success();
        onReveal(card.id);
      }}
    >
      {face}
    </ScratchCover>
  );
}

/** Detail sheet for a scratched card: ring, flags, event. */
export function CandidateDetail({ candidate, onLike, onPass, busy }) {
  const photo = candidate.photos?.[0];
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pt-6 pb-3">
        <div className="flex flex-col items-center">
          <Avatar
            src={photo?.url ? mediaUrl(photo.url) : null}
            grad={photo?.gradient || FALLBACK_GRADIENT}
            size={88}
            verified={candidate.is_verified}
          />
          <h2 className="font-display text-xl mt-3" style={{ color: T.ink }}>
            {candidate.first_name}
            {candidate.age ? `, ${candidate.age}` : ""}
          </h2>
          {candidate.bio && (
            <p className="text-sm text-center mt-1.5" style={{ color: T.muted }}>{candidate.bio}</p>
          )}
          <div className="mt-3">
            <CompatRing percent={candidate.compatibility_pct} />
          </div>
        </div>

        <div className="mt-4 space-y-2.5">
          {(candidate.shared_flags || []).map((flag) => (
            <div
              key={flag}
              className="flex items-center gap-2.5 rounded-2xl p-3"
              style={{ background: T.surface, border: `1px solid ${T.line}` }}
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

          {candidate.event && (
            <div className="flex items-center gap-2.5 rounded-2xl p-3" style={{ background: "#E1EBFF", border: `1px solid ${T.line}` }}>
              <span className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#FFFFFF" }}>
                <MapPin size={13} color={T.coral} />
              </span>
              <span className="text-sm" style={{ color: T.ink }}>{candidate.event.title}</span>
            </div>
          )}

          {candidate.photos_locked && (
            <p className="text-xs text-center pt-1" style={{ color: T.muted }}>
              Фото откроется после трёх ваших сообщений в чате
            </p>
          )}
        </div>
      </div>

      <div className="px-5 pb-5 pt-3 flex gap-3" style={{ borderTop: `1px solid ${T.line}` }}>
        <Button variant="secondary" onClick={onPass} disabled={busy}>Пропустить</Button>
        <Button onClick={onLike} loading={busy}>Лайк</Button>
      </div>
    </div>
  );
}
