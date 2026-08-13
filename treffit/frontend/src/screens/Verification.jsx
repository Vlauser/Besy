import React, { useEffect, useRef, useState } from "react";
import { BadgeCheck, Camera, Clock, ShieldCheck } from "lucide-react";

import { endpoints } from "../api/client";
import { Button, Loading, Pill } from "../components/ui";
import { haptic } from "../lib/telegram";
import { T, gradient } from "../theme";

/**
 * Selfie-with-gesture verification.
 *
 * The gesture is assigned by the server and cannot be re-rolled — that is
 * what makes it proof of liveness rather than proof of owning a photo.
 */
export function Verification({ isVerified, onDone, onError }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    endpoints
      .verification()
      .then(setState)
      .catch((error) => onError(error.detail || error.message));
  }, [onError]);

  async function guard(action) {
    setBusy(true);
    try {
      setState(await action());
      haptic.success();
    } catch (error) {
      haptic.error();
      onError(error.detail || error.message);
    } finally {
      setBusy(false);
    }
  }

  function pick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    guard(async () => {
      const next = await endpoints.submitVerification(file);
      onDone?.();
      return next;
    });
  }

  if (isVerified) {
    return (
      <div className="flex flex-col items-center text-center px-6 py-10 gap-3">
        <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: gradient.precious }}>
          <BadgeCheck size={28} color="#fff" />
        </div>
        <p className="font-display text-xl" style={{ color: T.ink }}>Анкета подтверждена</p>
        <p className="text-sm" style={{ color: T.muted }}>
          Галочка видна всем в колоде — таким анкетам доверяют больше.
        </p>
      </div>
    );
  }

  if (!state) return <Loading />;

  if (state.status === "submitted") {
    return (
      <div className="flex flex-col items-center text-center px-6 py-10 gap-3">
        <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: T.surfaceSoft }}>
          <Clock size={26} color={T.coral} />
        </div>
        <p className="font-display text-xl" style={{ color: T.ink }}>Селфи на проверке</p>
        <p className="text-sm" style={{ color: T.muted }}>
          Обычно занимает несколько часов. Придёт уведомление в Telegram.
        </p>
      </div>
    );
  }

  const started = state.status === "requested";

  return (
    <div className="px-5 py-5 space-y-4">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: T.goldSoft }}>
          <ShieldCheck size={18} color={T.gold} />
        </span>
        <div>
          <p className="font-display text-lg" style={{ color: T.ink }}>Подтвердите анкету</p>
          <p className="text-sm mt-0.5" style={{ color: T.muted }}>
            Сделайте селфи с жестом, который мы назначим.
          </p>
        </div>
      </div>

      {state.status === "rejected" && state.reason && (
        <div className="rounded-2xl p-3 text-sm" style={{ background: "#FDECEF", color: T.danger }}>
          Прошлая попытка отклонена: {state.reason}
        </div>
      )}

      {started ? (
        <>
          <div className="rounded-2xl p-4 text-center" style={{ background: T.surface, border: `1px solid ${T.line}` }}>
            <Pill tone="gold">ваш жест</Pill>
            <p className="font-display text-xl mt-2" style={{ color: T.ink }}>{state.instruction}</p>
            <p className="text-xs mt-2" style={{ color: T.muted }}>
              Жест назначается случайно и не меняется.
            </p>
          </div>

          <Button onClick={() => inputRef.current?.click()} loading={busy}>
            <Camera size={16} /> Сделать селфи
          </Button>
          <input ref={inputRef} type="file" accept="image/*" capture="user" onChange={pick} className="hidden" />
        </>
      ) : (
        <Button onClick={() => guard(endpoints.startVerification)} loading={busy}>
          Получить жест
        </Button>
      )}

      <p className="text-xs" style={{ color: T.muted }}>
        Селфи видит только модератор, и оно удаляется сразу после проверки.
      </p>
    </div>
  );
}
