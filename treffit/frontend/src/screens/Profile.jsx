import React, { useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  Camera,
  ChevronRight,
  Pencil,
  Settings,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";

import { endpoints, mediaUrl, setToken } from "../api/client";
import { Button, Pill, Sheet } from "../components/ui";
import { Verification } from "./Verification";
import { haptic, openInvoice, showConfirm } from "../lib/telegram";
import { FALLBACK_GRADIENT, T, gradient } from "../theme";

/** Насколько анкета заполнена — то, что подталкивает её дозаполнить. */
function completeness(me) {
  const checks = [
    Boolean(me.photos?.length),
    (me.photos?.length || 0) >= 3,
    Boolean(me.bio?.trim()),
    Boolean(me.interests?.length),
    Boolean(me.test_completed_at),
    Boolean(me.is_verified),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function AvatarRing({ src, grad, percent, size = 116 }) {
  const stroke = 4;
  const radius = size / 2 - stroke;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={T.line} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={T.coral}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (percent / 100) * circumference}
          style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div
        className="absolute rounded-full overflow-hidden"
        style={{ inset: stroke + 3, background: grad }}
      >
        {src && <img src={src} alt="" className="w-full h-full object-cover" />}
      </div>
      {percent < 100 && (
        <span
          className="absolute left-1/2 -translate-x-1/2 text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ bottom: -10, background: T.coral, color: "#fff" }}
        >
          {percent}%
        </span>
      )}
    </div>
  );
}

function RoundAction({ icon: Icon, label, onClick, accent }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform">
      <span
        className="w-14 h-14 rounded-full flex items-center justify-center"
        style={{
          background: accent ? gradient.action : T.surface,
          border: accent ? "none" : `1px solid ${T.line}`,
          boxShadow: "0 8px 18px -12px rgba(30,40,90,0.45)",
        }}
      >
        <Icon size={21} color={accent ? "#fff" : T.ink} />
      </span>
      <span className="text-xs font-medium" style={{ color: T.muted }}>{label}</span>
    </button>
  );
}

function Row({ icon: Icon, title, value, tone = "default", onClick }) {
  const color = tone === "danger" ? T.danger : T.ink;
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 active:opacity-60 transition-opacity text-left"
    >
      <Icon size={18} color={tone === "danger" ? T.danger : T.coral} />
      <span className="flex-1 text-sm font-medium" style={{ color }}>{title}</span>
      {value && <span className="text-xs" style={{ color: T.muted }}>{value}</span>}
      <ChevronRight size={16} color={T.line} />
    </button>
  );
}

export function Profile({ me, config, onUpdated, onGoTest, onError }) {
  const [products, setProducts] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [busy, setBusy] = useState(false);

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

  const refresh = async () => onUpdated(await endpoints.me());

  async function buy(product) {
    await guard(async () => {
      const invoice = await endpoints.invoice(product);
      if (!invoice.invoice_link) {
        onError("Платежи временно недоступны");
        return;
      }
      if ((await openInvoice(invoice.invoice_link)) === "paid") {
        setSheet(null);
        await refresh();
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
  const percent = completeness(me);

  return (
    <div className="pb-6">
      <div className="flex flex-col items-center pt-6 pb-5">
        <AvatarRing
          src={primary?.url ? mediaUrl(primary.url) : null}
          grad={primary?.gradient || FALLBACK_GRADIENT}
          percent={percent}
        />
        <div className="flex items-center gap-1.5 mt-5">
          <h2 className="font-display text-2xl" style={{ color: T.ink }}>
            {me.first_name}
            {me.age ? `, ${me.age}` : ""}
          </h2>
          {me.is_verified && <BadgeCheck size={20} color={T.coral} />}
        </div>
        <p className="text-sm mt-0.5" style={{ color: T.muted }}>{me.city}</p>
        {me.is_premium && (
          <div className="mt-2"><Pill tone="gold">Premium</Pill></div>
        )}
      </div>

      <div className="flex justify-center gap-8 pb-6">
        <RoundAction icon={Settings} label="Настройки" onClick={() => setSheet("filters")} />
        <RoundAction icon={Pencil} label="Изменить" accent onClick={() => setSheet("edit")} />
        <RoundAction icon={Camera} label="Фото" onClick={() => setSheet("photos")} />
      </div>

      {!me.is_premium && (
        <div className="px-4 pb-3">
          <button
            onClick={() => setSheet("premium")}
            className="w-full flex items-center gap-3 rounded-2xl p-4 active:scale-95 transition-transform text-left"
            style={{ background: gradient.action }}
          >
            <span
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.22)" }}
            >
              <Star size={18} color="#fff" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-bold text-white">Treffit Premium</span>
              <span className="block text-xs" style={{ color: "rgba(255,255,255,0.85)" }}>
                Кто вас лайкнул и безлимит лайков
              </span>
            </span>
          </button>
        </div>
      )}

      <div className="px-4">
        <div className="rounded-2xl overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.line}` }}>
          <Row
            icon={BadgeCheck}
            title={me.is_verified ? "Анкета подтверждена" : "Подтвердить анкету"}
            value={me.is_verified ? "✓" : null}
            onClick={() => setSheet("verify")}
          />
          <div style={{ height: 1, background: T.line, marginLeft: 46 }} />
          <Row icon={Sparkles} title="Пройти тест заново" onClick={onGoTest} />
          <div style={{ height: 1, background: T.line, marginLeft: 46 }} />
          <Row icon={Trash2} title="Удалить профиль" tone="danger" onClick={deleteAccount} />
        </div>
      </div>

      <Sheet open={sheet === "photos"} onClose={() => setSheet(null)} title="Фото">
        <PhotoManager me={me} maxPhotos={config.max_photos} guard={guard} refresh={refresh} busy={busy} />
      </Sheet>

      <Sheet open={sheet === "edit"} onClose={() => setSheet(null)} title="О себе">
        <EditProfile
          me={me}
          busy={busy}
          onSave={(patch) =>
            guard(async () => {
              onUpdated(await endpoints.updateMe(patch));
              setSheet(null);
              haptic.success();
            })
          }
        />
      </Sheet>

      <Sheet open={sheet === "filters"} onClose={() => setSheet(null)} title="Кого показывать">
        <Filters
          me={me}
          busy={busy}
          onSave={(patch) =>
            guard(async () => {
              onUpdated(await endpoints.updateMe(patch));
              setSheet(null);
              haptic.success();
            })
          }
        />
      </Sheet>

      <Sheet open={sheet === "verify"} onClose={() => setSheet(null)} title="Верификация">
        <Verification isVerified={me.is_verified} onError={onError} onDone={refresh} />
      </Sheet>

      <Sheet open={sheet === "premium"} onClose={() => setSheet(null)} title="Treffit Premium">
        <div className="p-4 space-y-2.5">
          {products.map((product) => (
            <button
              key={product.key}
              onClick={() => buy(product.key)}
              disabled={busy}
              className="w-full flex items-center justify-between gap-3 rounded-2xl p-4 text-left active:scale-95 transition-transform"
              style={{ background: T.bg, border: `1px solid ${T.line}` }}
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold" style={{ color: T.ink }}>{product.title}</span>
                <span className="block text-xs" style={{ color: T.muted }}>{product.description}</span>
              </span>
              <Pill tone="gold">{product.amount} ⭐</Pill>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

/* ---------------- photos ---------------- */

function PhotoManager({ me, maxPhotos, guard, refresh, busy }) {
  const inputRef = useRef(null);
  const photos = me.photos || [];

  function add(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    guard(async () => {
      await endpoints.uploadPhoto(file);
      await refresh();
      haptic.success();
    });
  }

  return (
    <div className="p-4">
      <div className="grid grid-cols-3 gap-2.5">
        {photos.map((photo, index) => (
          <div
            key={photo.id}
            className="relative rounded-2xl overflow-hidden"
            style={{ aspectRatio: "3/4", background: photo.gradient }}
          >
            {photo.url && <img src={mediaUrl(photo.url)} alt="" className="w-full h-full object-cover" />}
            <button
              onClick={() => guard(async () => {
                await endpoints.deletePhoto(photo.id);
                await refresh();
              })}
              className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background: "rgba(12,18,42,0.6)" }}
            >
              <Trash2 size={12} color="#fff" />
            </button>
            {index === 0 ? (
              <span
                className="absolute bottom-1.5 left-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: T.coral, color: "#fff" }}
              >
                Главное
              </span>
            ) : (
              <button
                onClick={() => guard(async () => {
                  await endpoints.makePrimary(photo.id);
                  await refresh();
                })}
                className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: "rgba(255,255,255,0.92)", color: T.ink }}
              >
                Сделать главным
              </button>
            )}
          </div>
        ))}

        {photos.length < maxPhotos && (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="rounded-2xl flex items-center justify-center active:scale-95 transition-transform"
            style={{ aspectRatio: "3/4", background: T.bg, border: `1px dashed ${T.coral}` }}
          >
            <Camera size={20} color={T.coral} />
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" onChange={add} className="hidden" />
      <p className="text-xs mt-3" style={{ color: T.muted }}>
        Первое фото видят в колоде. Можно добавить до {maxPhotos}.
      </p>
    </div>
  );
}

/* ---------------- edit ---------------- */

const inputStyle = { background: T.bg, border: `1px solid ${T.line}`, color: T.ink };

const INTEREST_OPTIONS = [
  "музыка", "кино", "книги", "спорт", "бег", "горы", "путешествия",
  "кофе", "готовка", "искусство", "театр", "фото", "танцы", "игры",
];

function EditProfile({ me, onSave, busy }) {
  const [bio, setBio] = useState(me.bio || "");
  const [city, setCity] = useState(me.city || "");
  const [interests, setInterests] = useState(me.interests || []);

  function toggle(tag) {
    haptic.select();
    setInterests((current) =>
      current.includes(tag) ? current.filter((i) => i !== tag) : [...current, tag].slice(0, 10)
    );
  }

  return (
    <div className="p-4 space-y-4">
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.muted }}>О себе</span>
        <textarea
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          maxLength={500}
          rows={4}
          placeholder="Пара фраз, которые скажут больше фотографии"
          className="w-full mt-1.5 rounded-2xl px-4 py-3 text-sm outline-none resize-none"
          style={inputStyle}
        />
      </label>

      <div>
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.muted }}>Интересы</span>
        <div className="flex flex-wrap gap-2 mt-2">
          {INTEREST_OPTIONS.map((tag) => {
            const active = interests.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => toggle(tag)}
                className="px-3 py-1.5 rounded-full text-sm active:scale-95 transition-transform"
                style={
                  active
                    ? { background: T.coral, color: "#fff" }
                    : { background: T.bg, border: `1px solid ${T.line}`, color: T.ink }
                }
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.muted }}>Город</span>
        <input
          value={city}
          onChange={(event) => setCity(event.target.value)}
          className="w-full mt-1.5 rounded-2xl px-4 py-3 text-sm outline-none"
          style={inputStyle}
        />
      </label>

      <Button
        loading={busy}
        onClick={() => onSave({ bio: bio.trim() || null, city: city.trim(), interests })}
      >
        Сохранить
      </Button>
    </div>
  );
}

/* ---------------- filters ---------------- */

function Filters({ me, onSave, busy }) {
  const [seeking, setSeeking] = useState(me.seeking_gender);
  const [ageMin, setAgeMin] = useState(me.seeking_age_min);
  const [ageMax, setAgeMax] = useState(me.seeking_age_max);

  return (
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
        <input
          type="range"
          min={18}
          max={80}
          value={ageMin}
          style={{ accentColor: T.coral }}
          onChange={(event) => setAgeMin(Math.min(Number(event.target.value), ageMax))}
          className="w-full"
        />
        <input
          type="range"
          min={18}
          max={80}
          value={ageMax}
          style={{ accentColor: T.coral }}
          onChange={(event) => setAgeMax(Math.max(Number(event.target.value), ageMin))}
          className="w-full"
        />
      </div>

      <Button
        loading={busy}
        onClick={() =>
          onSave({
            seeking_gender: seeking,
            seeking_age_min: Number(ageMin),
            seeking_age_max: Number(ageMax),
          })
        }
      >
        Сохранить
      </Button>
    </div>
  );
}
