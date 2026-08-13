import React, { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

import { endpoints } from "../api/client";
import { SwipeCard, SwipeControls } from "../components/SwipeCard";
import { Button, EmptyState, Loading } from "../components/ui";
import { haptic } from "../lib/telegram";
import { T } from "../theme";

const REFILL_AT = 2;

/** Twinby-style swipe deck: drag or tap the controls. */
export function Deck({ config, onMatch, onError }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [likesLeft, setLikesLeft] = useState(null);
  // Ids already acted on. A refill can outrun the swipe request, and the
  // server only filters people it has recorded a swipe for — without this
  // the same profile comes back a second time.
  const decided = useRef(new Set());

  const load = useCallback(
    async (append = false) => {
      try {
        const fresh = (await endpoints.discover(10)).filter((card) => !decided.current.has(card.id));
        setCards((current) => {
          if (!append) return fresh;
          const known = new Set(current.map((card) => card.id));
          return [...current, ...fresh.filter((card) => !known.has(card.id))];
        });
      } catch (error) {
        onError(error.detail || error.message);
      } finally {
        setLoading(false);
      }
    },
    [onError]
  );

  useEffect(() => {
    load();
  }, [load]);

  async function decide(candidate, action) {
    if (busy) return;
    setBusy(true);
    decided.current.add(candidate.id);
    setCards((current) => current.filter((card) => card.id !== candidate.id));
    try {
      const result = await endpoints.swipe(candidate.id, action);
      if (typeof result.likes_left === "number") setLikesLeft(result.likes_left);
      if (result.matched) {
        haptic.success();
        onMatch({ ...result, candidate: result.candidate || candidate });
      }
    } catch (error) {
      // Put the card back so a failed swipe is not silently lost.
      decided.current.delete(candidate.id);
      setCards((current) => [candidate, ...current]);
      onError(error.detail || error.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // Wait for the in-flight swipe to land before asking for more, so the
    // server has already recorded it.
    if (!loading && !busy && cards.length <= REFILL_AT) load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length, loading, busy]);

  if (loading) return <Loading label="Ищем совпадения…" />;

  if (!cards.length) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Пока никого нового"
        hint="Загляните позже или измените фильтры в профиле."
        action={
          <div className="w-full max-w-xs">
            <Button variant="secondary" onClick={() => load()}>Обновить</Button>
          </div>
        }
      />
    );
  }

  const visible = cards.slice(0, 3);
  const top = visible[0];

  return (
    <div className="flex flex-col h-full px-4 pt-3 pb-2">
      {likesLeft !== null && likesLeft <= 5 && (
        <p className="text-xs text-center mb-2" style={{ color: T.muted }}>
          Осталось лайков сегодня: {likesLeft}
        </p>
      )}

      <div className="relative flex-1" style={{ minHeight: 380 }}>
        {/* DOM order matches visual order: the top card is first. Stacking
            comes from the explicit z-index on each card, not from paint
            order, so no reversing is needed. */}
        {visible.map((candidate, index) => (
          <SwipeCard
            key={candidate.id}
            candidate={candidate}
            depth={index}
            interactive={index === 0}
            blindMode={config.blind_mode}
            onDecide={(action) => decide(candidate, action)}
          />
        ))}
      </div>

      <SwipeControls
        disabled={busy}
        onPass={() => decide(top, "pass")}
        onSuperlike={() => decide(top, "superlike")}
        onLike={() => decide(top, "like")}
      />
    </div>
  );
}
