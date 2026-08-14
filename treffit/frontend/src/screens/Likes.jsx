import React, { useEffect, useState } from "react";
import { Heart, Lock, Star } from "lucide-react";

import { endpoints, mediaUrl } from "../api/client";
import { Button, EmptyState, Loading, Pill } from "../components/ui";
import { haptic, openInvoice } from "../lib/telegram";
import { FALLBACK_GRADIENT, T, gradient } from "../theme";

/** Плитка лайка. Без Premium — только градиент и никаких данных.
 *
 *  Замок здесь честный: сервер на список отвечает 402 и не присылает ни
 *  имени, ни фотографии. Скрывать уже полученное на клиенте было бы
 *  показухой — данные лежали бы в ответе, и достать их мог бы кто угодно.
 */
function LikeTile({ candidate, onOpen }) {
  const photo = candidate?.photos?.[0];
  const locked = !candidate;

  return (
    <button
      onClick={() => candidate && onOpen(candidate)}
      disabled={locked}
      className="relative rounded-2xl overflow-hidden active:scale-95 transition-transform"
      style={{
        aspectRatio: "3 / 4",
        background: photo?.gradient || FALLBACK_GRADIENT,
      }}
    >
      {photo?.url && (
        <img src={mediaUrl(photo.url)} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}

      {locked ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Lock size={22} color="rgba(255,255,255,0.9)" />
        </span>
      ) : (
        <span
          className="absolute left-0 right-0 bottom-0 px-2.5 py-2 text-left"
          style={{ background: "linear-gradient(transparent, rgba(16,24,52,0.78))" }}
        >
          <span className="block text-sm font-semibold text-white truncate">
            {candidate.first_name}
            {candidate.age ? `, ${candidate.age}` : ""}
          </span>
          <span className="block text-xs" style={{ color: "rgba(255,255,255,0.8)" }}>
            {candidate.compatibility_pct}% совпадение
          </span>
        </span>
      )}
    </button>
  );
}

/**
 * Кто вас лайкнул.
 *
 * Список платный, число — нет: иначе баннер Premium зовёт вслепую, и
 * человек не знает, что именно ему предлагают купить.
 */
export function Likes({ me, onOpenCandidate, onUpdated, onError }) {
  const [count, setCount] = useState(null);
  const [people, setPeople] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    endpoints.incomingLikesCount().then((data) => setCount(data.count)).catch(() => setCount(0));
    if (!me.is_premium) return;
    endpoints
      .incomingLikes()
      .then(setPeople)
      .catch((error) => onError(error.detail || error.message));
  }, [me.is_premium, onError]);

  async function buy() {
    setBusy(true);
    try {
      const invoice = await endpoints.invoice("premium_1m");
      if (!invoice.invoice_link) {
        onError("Платежи временно недоступны");
        return;
      }
      if ((await openInvoice(invoice.invoice_link)) === "paid") {
        haptic.success();
        onUpdated(await endpoints.me());
      }
    } catch (error) {
      onError(error.detail || error.message);
    } finally {
      setBusy(false);
    }
  }

  if (count === null) return <Loading />;

  if (count === 0) {
    return (
      <EmptyState
        icon={Heart}
        title="Пока никто"
        hint="Здесь появятся те, кому вы понравились. Свайпайте — так вас увидят больше людей."
      />
    );
  }

  if (!me.is_premium) {
    // Заглушек ровно столько, сколько лайков: число честное, лица закрыты.
    const tiles = Array.from({ length: Math.min(count, 9) });
    return (
      <div className="px-4 pt-4 pb-6">
        <div className="grid grid-cols-3 gap-2.5">
          {tiles.map((_, index) => (
            <LikeTile key={index} candidate={null} />
          ))}
        </div>

        <div className="rounded-2xl p-4 mt-5 text-center" style={{ background: gradient.action }}>
          <span
            className="w-11 h-11 rounded-full flex items-center justify-center mx-auto"
            style={{ background: "rgba(255,255,255,0.22)" }}
          >
            <Star size={20} color="#fff" />
          </span>
          <p className="font-display text-lg text-white mt-3">
            {count === 1 ? "Вас лайкнул 1 человек" : `Вас лайкнули: ${count}`}
          </p>
          <p className="text-sm mt-1 mb-4" style={{ color: "rgba(255,255,255,0.85)" }}>
            С Premium видно, кто именно, — и можно ответить, не дожидаясь встречного свайпа.
          </p>
          <Button variant="secondary" onClick={buy} loading={busy}>
            Открыть за Premium
          </Button>
        </div>
      </div>
    );
  }

  if (people === null) return <Loading />;

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="flex items-center gap-2 mb-3">
        <Pill tone="coral">{people.length}</Pill>
        <span className="text-sm" style={{ color: T.muted }}>
          {people.length === 1 ? "человек ждёт ответа" : "человек ждут ответа"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {people.map((candidate) => (
          <LikeTile key={candidate.id} candidate={candidate} onOpen={onOpenCandidate} />
        ))}
      </div>
    </div>
  );
}
