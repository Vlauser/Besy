import React, { useState } from "react";
import { Heart, Sparkles, X } from "lucide-react";

import { endpoints } from "../api/client";
import { Button, ProgressDots } from "../components/ui";
import { haptic } from "../lib/telegram";
import { T, gradient } from "../theme";

/** Six either/or cards. Tap, not swipe — the swipe gesture belongs to the deck. */
export function Test({ cards, initialAnswers, onSaved, onError }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState(initialAnswers || {});
  const [phase, setPhase] = useState("idle");
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState(false);

  const card = cards[index];

  function choose(side) {
    if (phase !== "idle") return;
    haptic.select();
    const next = { ...answers, [card.id]: side };
    setAnswers(next);
    setPhase("leaving");
    setTimeout(() => {
      if (index + 1 >= cards.length) save(next);
      else {
        setIndex((value) => value + 1);
        setPhase("idle");
      }
    }, 200);
  }

  async function save(finalAnswers) {
    setSaving(true);
    try {
      const me = await endpoints.saveTest(finalAnswers);
      haptic.success();
      setFinished(true);
      onSaved(me);
    } catch (error) {
      onError(error.detail || error.message);
      setPhase("idle");
    } finally {
      setSaving(false);
    }
  }

  if (finished) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mb-5"
          style={{ background: gradient.precious }}
        >
          <Sparkles size={26} color="#FFFFFF" />
        </div>
        <h2 className="font-display text-2xl mb-2" style={{ color: T.ink }}>Профиль собран</h2>
        <p className="text-sm mb-7" style={{ color: T.muted }}>
          Совпадения уже посчитаны по вашим ответам
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full px-5 pt-5 pb-4">
      <ProgressDots total={cards.length} index={index} />
      <p className="text-center text-xs mt-5 mb-6 tracking-wide uppercase" style={{ color: T.muted }}>
        Вопрос {index + 1} из {cards.length}
      </p>

      <div
        className={`transition-all duration-200 ${
          phase === "leaving" ? "opacity-0 -translate-y-2" : "opacity-100 translate-y-0"
        }`}
      >
        <p className="font-display text-3xl text-center leading-tight mb-8" style={{ color: T.ink }}>
          {card.q}
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => choose("left")}
            disabled={saving}
            className="w-full flex items-center gap-3 rounded-2xl p-4 text-left active:scale-95 transition-transform duration-150"
            style={{ background: T.surface, border: `1px solid ${T.line}`, boxShadow: "0 8px 20px -14px rgba(30,40,90,0.3)" }}
          >
            <span
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: T.surfaceSoft }}
            >
              <X size={15} color={T.muted} />
            </span>
            <span className="font-semibold text-sm" style={{ color: T.ink }}>{card.left}</span>
          </button>

          <button
            onClick={() => choose("right")}
            disabled={saving}
            className="w-full flex items-center gap-3 rounded-2xl p-4 text-left active:scale-95 transition-transform duration-150"
            style={{ background: gradient.action, boxShadow: "0 10px 24px -12px rgba(39,72,217,0.5)" }}
          >
            <span
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.3)" }}
            >
              <Heart size={15} color="#FFFFFF" />
            </span>
            <span className="font-semibold text-sm text-white">{card.right}</span>
          </button>
        </div>
      </div>

      <div className="flex-1" />
      {index > 0 && (
        <Button variant="ghost" onClick={() => setIndex((value) => value - 1)} disabled={saving}>
          Назад
        </Button>
      )}
    </div>
  );
}
