import React, { useEffect, useRef, useState } from "react";
import { BadgeCheck, Camera, LogOut, Sparkles, Star, Trash2 } from "lucide-react";

import { endpoints, mediaUrl, setToken } from "../api/client";
import { Avatar, Button, Pill, Sheet } from "../components/ui";
import { Verification } from "./Verification";
import { haptic, openInvoice, showConfirm } from "../lib/telegram";
import { FALLBACK_GRADIENT, T, gradient } from "../theme";

export function Profile({ me, config, testCards, onUpdated, onGoTest, onError }) {
  const [products, setProducts] = useState([]);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    endpoints.products().then((data) => setProducts(data.items)).catch(() => {});
  }, []);

  async function guard(action) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      onError(error.detail || error.message);
    } finally {
      setBusy(false);
    }
  }

  function addPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    guard(async () => {
      await endpoints.uploadPhoto(file);
      onUpdated(await endpoints.me());
      haptic.success();
    });
  }

  function removePhoto(id) {
    guard(async () => {
      await endpoints.deletePhoto(id);
      onUpdated(await endpoints.me());
    });
  }

  async function buy(product) {
    await guard(async () => {
      const invoice = await endpoints.invoice(product);
      if (!invoice.invoice_link) {
        onError("Платежи не настроены: не задан токен бота");
        return;
      }
      const status = await openInvoice(invoice.invoice_link);
      if (status === "paid") {
        setPremiumOpen(false);
        onUpdated(await endpoints.me());
      }
    });
  }

  async function deleteAccount() {
    if (!(await showConfirm("Удалить профиль? Анкета исчезнет из поиска, чаты закроются."))) return;
    await guard(async () => {
      await endpoints.deactivate();
      setToken(null);
      window.location.reload();
    });
  }

  const primary = me.photos?.[0];
  const answered = Object.keys(me.test_answers || {}).length;

  return (
    <div className="px-4 pt-4 pb-6 space-y-3">
      <div className="rounded-2xl p-4 flex items-center gap-4" style={{ background: T.surface, border: `1px solid ${T.line}` }}>
        <Avatar
          src={primary?.url ? mediaUrl(primary.url) : null}
          grad={primary?.gradient || FALLBACK_GRADIENT}
          size={64}
          verified={me.is_verified}
        />
        <div className="min-w-0">
          <p className="font-display text-lg truncate" style={{ color: T.ink }}>
            {me.first_name}
            {me.age ? `, ${me.age}` : ""}
          </p>
          <p className="text-xs" style={{ color: T.muted }}>{me.city}</p>
          <div className="flex gap-1.5 mt-1.5">
            {me.is_premium && <Pill tone="gold">Premium</Pill>}
            {me.is_verified && <Pill tone="success">Проверен</Pill>}
          </div>
        </div>
      </div>

      <section className="rounded-2xl p-4" style={{ background: T.surface, border: `1px solid ${T.line}` }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold" style={{ color: T.ink }}>Фото</span>
          <span className="text-xs" style={{ color: T.muted }}>{me.photos.length}/{config.max_photos}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {me.photos.map((photo) => (
            <div key={photo.id} className="relative rounded-xl overflow-hidden" style={{ aspectRatio: "3/4", background: photo.gradient }}>
              {photo.url && <img src={mediaUrl(photo.url)} alt="" className="w-full h-full object-cover" />}
              <button
                onClick={() => removePhoto(photo.id)}
                className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center"
                style={{ background: "rgba(12,18,42,0.6)" }}
              >
                <Trash2 size={11} color="#fff" />
              </button>
              {photo.moderation_status === "pending" && (
                <span className="absolute bottom-1 left-1 text-[10px] px-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.9)", color: T.muted }}>
                  модерация
                </span>
              )}
            </div>
          ))}
          {me.photos.length < config.max_photos && (
            <button
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="rounded-xl flex items-center justify-center active:scale-95 transition-transform"
              style={{ aspectRatio: "3/4", background: T.bg, border: `1px dashed ${T.coral}` }}
            >
              <Camera size={18} color={T.coral} />
            </button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" onChange={addPhoto} className="hidden" />
        {config.blind_mode && (
          <p className="text-xs mt-3" style={{ color: T.muted }}>
            Фото скрыто до трёх сообщений — так работает Treffit.
          </p>
        )}
      </section>

      <button
        onClick={onGoTest}
        className="w-full flex items-center gap-3 rounded-2xl p-4 active:scale-95 transition-transform text-left"
        style={{ background: T.surface, border: `1px solid ${T.line}` }}
      >
        <span className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: T.goldSoft }}>
          <Sparkles size={18} color={T.gold} />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold" style={{ color: T.ink }}>
            {answered ? "Пройти тест заново" : "Пройти мини-тест"}
          </p>
          <p className="text-xs" style={{ color: T.muted }}>
            {answered ? `${answered} из ${testCards.length} ответов сохранено` : "6 вопросов — от них зависят совпадения"}
          </p>
        </div>
      </button>

      <button
        onClick={() => setVerifyOpen(true)}
        className="w-full flex items-center gap-3 rounded-2xl p-4 active:scale-95 transition-transform text-left"
        style={{ background: T.surface, border: `1px solid ${T.line}` }}
      >
        <span className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: T.surfaceSoft }}>
          <BadgeCheck size={18} color={me.is_verified ? T.success : T.coral} />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold" style={{ color: T.ink }}>
            {me.is_verified ? "Анкета подтверждена" : "Подтвердить анкету"}
          </p>
          <p className="text-xs" style={{ color: T.muted }}>
            {me.is_verified ? "Галочка видна в колоде" : "Селфи с жестом — чтобы вам доверяли"}
          </p>
        </div>
      </button>

      {!me.is_premium && (
        <button
          onClick={() => setPremiumOpen(true)}
          className="w-full flex items-center gap-3 rounded-2xl p-4 active:scale-95 transition-transform text-left"
          style={{ background: gradient.action }}
        >
          <span className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.22)" }}>
            <Star size={18} color="#fff" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-bold text-white">Treffit Premium</p>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.85)" }}>Кто вас лайкнул, безлимит лайков, буст</p>
          </div>
        </button>
      )}

      <Button variant="secondary" onClick={() => setFiltersOpen(true)}>Фильтры поиска</Button>
      <Button variant="danger" onClick={deleteAccount} disabled={busy}>
        <LogOut size={15} /> Удалить профиль
      </Button>

      <Sheet open={premiumOpen} onClose={() => setPremiumOpen(false)} title="Treffit Premium">
        <div className="p-4 space-y-2.5">
          {products.map((product) => (
            <button
              key={product.key}
              onClick={() => buy(product.key)}
              disabled={busy}
              className="w-full flex items-center justify-between gap-3 rounded-2xl p-4 text-left active:scale-95 transition-transform"
              style={{ background: T.bg, border: `1px solid ${T.line}` }}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: T.ink }}>{product.title}</p>
                <p className="text-xs" style={{ color: T.muted }}>{product.description}</p>
              </div>
              <Pill tone="gold">{product.amount} ⭐</Pill>
            </button>
          ))}
          <p className="text-xs pt-1" style={{ color: T.muted }}>
            Оплата в Telegram Stars — так требуют правила магазинов для цифровых покупок.
          </p>
        </div>
      </Sheet>

      <Sheet open={verifyOpen} onClose={() => setVerifyOpen(false)} title="Верификация">
        <Verification
          isVerified={me.is_verified}
          onError={onError}
          onDone={async () => onUpdated(await endpoints.me())}
        />
      </Sheet>

      <FiltersSheet
        open={filtersOpen}
        me={me}
        onClose={() => setFiltersOpen(false)}
        onSave={(patch) =>
          guard(async () => {
            onUpdated(await endpoints.updateMe(patch));
            setFiltersOpen(false);
          })
        }
      />
    </div>
  );
}

function FiltersSheet({ open, me, onClose, onSave }) {
  const [seeking, setSeeking] = useState(me.seeking_gender);
  const [ageMin, setAgeMin] = useState(me.seeking_age_min);
  const [ageMax, setAgeMax] = useState(me.seeking_age_max);
  const [city, setCity] = useState(me.city);

  return (
    <Sheet open={open} onClose={onClose} title="Фильтры поиска">
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {[
            ["male", "Мужчин"],
            ["female", "Женщин"],
            ["any", "Всех"],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setSeeking(value)}
              className="rounded-2xl py-3 text-sm font-semibold active:scale-95 transition-transform"
              style={
                seeking === value
                  ? { background: gradient.action, color: "#fff" }
                  : { background: T.bg, border: `1px solid ${T.line}`, color: T.ink }
              }
            >
              {label}
            </button>
          ))}
        </div>

        <div className="rounded-2xl p-4" style={{ background: T.bg, border: `1px solid ${T.line}` }}>
          <p className="text-sm mb-2" style={{ color: T.ink }}>Возраст: {ageMin}–{ageMax}</p>
          <input type="range" min={18} max={80} value={ageMin} style={{ accentColor: T.coral }}
            onChange={(event) => setAgeMin(Math.min(Number(event.target.value), ageMax))} className="w-full" />
          <input type="range" min={18} max={80} value={ageMax} style={{ accentColor: T.coral }}
            onChange={(event) => setAgeMax(Math.max(Number(event.target.value), ageMin))} className="w-full" />
        </div>

        <input
          value={city}
          onChange={(event) => setCity(event.target.value)}
          className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
          style={{ background: T.bg, border: `1px solid ${T.line}`, color: T.ink }}
          placeholder="Город"
        />

        <Button
          onClick={() =>
            onSave({
              seeking_gender: seeking,
              seeking_age_min: Number(ageMin),
              seeking_age_max: Number(ageMax),
              city: city.trim(),
            })
          }
        >
          Сохранить
        </Button>
      </div>
    </Sheet>
  );
}
