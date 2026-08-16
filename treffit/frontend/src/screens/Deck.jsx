import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Heart, Sparkles } from "lucide-react";

import { endpoints } from "../api/client";
import { SwipeCard, SwipeControls } from "../components/SwipeCard";
import { Button, DeckSkeleton, EmptyState } from "../components/ui";
import { haptic } from "../lib/telegram";
import { T } from "../theme";

const REFILL_AT = 2;

/** Twinby-style swipe deck: drag or tap the controls. */
export function Deck({ config, homeCity, onMatch, onOpenLikes, onOpenCandidate, onError }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [likesLeft, setLikesLeft] = useState(null);
  // Сколько людей уже лайкнуло. Число открыто и без Premium — иначе идти
  // на платный экран не за чем.
  const [likedMe, setLikedMe] = useState(0);
  // Ids already acted on. A refill can outrun the swipe request, and the
  // server only filters people it has recorded a swipe for — without this
  // the same profile comes back a second time.
  // Чей свайп прямо сейчас в пути. Дозагрузка может обогнать запрос, а
  // сервер фильтрует только то, что успел записать, — без этого человек
  // приходит вторым экземпляром.
  //
  // Именно «в пути», а не «решённые навсегда»: колода намеренно повторяет
  // ранее пропущенных, и вечное множество вычёркивало бы их вместе с
  // повторами — список снова кончался бы.
  const pending = useRef(new Set());

  const load = useCallback(
    async (append = false) => {
      try {
        const fresh = (await endpoints.discover(10)).filter((card) => !pending.current.has(card.id));
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

  useEffect(() => {
    // Молча: пустая плашка лучше, чем тост об ошибке ради счётчика.
    endpoints.incomingLikesCount().then((data) => setLikedMe(data.count)).catch(() => {});
  }, []);

  /** Кого вернёт отмена. Держим у себя, чтобы кнопка не была живой там,
   *  где отменять нечего: свайпов в этой сессии не было, или последний уже
   *  отменён, или он обернулся совпадением — такое не разбирается. */
  const [undoable, setUndoable] = useState(null);

  async function undo() {
    if (busy || !undoable) return;
    setBusy(true);
    try {
      const { candidate, likes_left: left } = await endpoints.undoSwipe();
      if (typeof left === "number") setLikesLeft(left);
      setCards((current) =>
        current.some((card) => card.id === candidate.id) ? current : [candidate, ...current]
      );
      haptic.light();
    } catch (error) {
      onError(error.detail || error.message);
    } finally {
      // В любом исходе отменять больше нечего: либо получилось, либо сервер
      // объяснил, почему нельзя, и повтор ответит тем же.
      setUndoable(null);
      setBusy(false);
    }
  }

  async function decide(candidate, action) {
    if (busy) return;
    setBusy(true);
    pending.current.add(candidate.id);
    setCards((current) => current.filter((card) => card.id !== candidate.id));
    try {
      const result = await endpoints.swipe(candidate.id, action);
      if (typeof result.likes_left === "number") setLikesLeft(result.likes_left);
      // Совпадение отменить нельзя: чат уже открыт у обоих.
      setUndoable(result.matched ? null : candidate);
      if (result.matched) {
        haptic.success();
        onMatch({ ...result, candidate: result.candidate || candidate });
      }
    } catch (error) {
      // Put the card back so a failed swipe is not silently lost.
      setCards((current) => [candidate, ...current]);
      onError(error.detail || error.message);
    } finally {
      // Сервер уже знает про свайп — дальше он сам решает, показывать ли
      // этого человека снова.
      pending.current.delete(candidate.id);
      setBusy(false);
    }
  }

  useEffect(() => {
    // Wait for the in-flight swipe to land before asking for more, so the
    // server has already recorded it.
    if (!loading && !busy && cards.length <= REFILL_AT) load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length, loading, busy]);

  // Заготовка карточки, а не спиннер: место под колоду занято сразу, и
  // экран не дёргается, когда анкеты доедут.
  if (loading) return <DeckSkeleton />;

  if (!cards.length) {
    return (
      <EmptyState
        icon={Sparkles}
        // Колода не выходит за город, так что пусто здесь означает ровно
        // одно: в городе больше некого показать. Так и говорим, а не
        // отправляем крутить фильтры наугад.
        title={homeCity ? `В городе ${homeCity} пока никого` : "Пока никого нового"}
        hint="Лайкнутые анкеты обратно не возвращаются, а новые появляются каждый день — загляните позже или расширьте возраст поиска в профиле."
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
    <div className="flex flex-col flex-1 min-h-0 px-4 pt-7 pb-2">
      {likedMe > 0 && (
        <button
          onClick={onOpenLikes}
          className="w-full flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 mb-2.5 active:scale-95 transition-transform"
          style={{ background: T.surface, border: `1px solid ${T.line}` }}
        >
          <span
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: T.coral }}
          >
            <Heart size={15} color="#fff" fill="#fff" />
          </span>
          <span className="flex-1 text-left text-sm font-semibold" style={{ color: T.ink }}>
            Вас лайкнули: {likedMe}
          </span>
          <ChevronRight size={16} color={T.muted} />
        </button>
      )}

      {likesLeft !== null && likesLeft <= 5 && (
        <p className="text-xs text-center mb-2" style={{ color: T.muted }}>
          Осталось лайков сегодня: {likesLeft}
        </p>
      )}

      {/* Карточка занимает всё, что осталось после плашек и кнопок:
          снизу иначе повисает пустая половина экрана. */}
      <div className="relative flex-1" style={{ minHeight: 320 }}>
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
            homeCity={homeCity}
            onDecide={(action) => decide(candidate, action)}
            onOpen={onOpenCandidate}
          />
        ))}
      </div>

      <SwipeControls
        compatibility={visible[0]?.compatibility_pct}
        disabled={busy}
        canUndo={Boolean(undoable)}
        onUndo={undo}
        onOpen={() => onOpenCandidate(top)}
        onPass={() => decide(top, "pass")}
        onSuperlike={() => decide(top, "superlike")}
        onLike={() => decide(top, "like")}
      />
    </div>
  );
}
