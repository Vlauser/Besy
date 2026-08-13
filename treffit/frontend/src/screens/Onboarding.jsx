import React, { useState } from "react";
import { Camera, Check, Shield, Trash2 } from "lucide-react";

import { endpoints, mediaUrl } from "../api/client";
import { Button, Pill, ProgressDots } from "../components/ui";
import { haptic } from "../lib/telegram";
import { T, gradient } from "../theme";

const GENDERS = [
  { value: "female", label: "Женский" },
  { value: "male", label: "Мужской" },
  { value: "other", label: "Другой" },
];
const SEEKING = [
  { value: "male", label: "Мужчин" },
  { value: "female", label: "Женщин" },
  { value: "any", label: "Всех" },
];

const STEPS = ["consent", "about", "looking", "photo"];

export function Onboarding({ me, config, onDone, onError }) {
  const [step, setStep] = useState(() => (me.consent_pdn_at ? 1 : 0));
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: me.first_name || "",
    birth_date: me.birth_date || "",
    gender: me.gender || "",
    seeking_gender: me.seeking_gender || "any",
    seeking_age_min: me.seeking_age_min ?? 18,
    seeking_age_max: me.seeking_age_max ?? 45,
    city: me.city || "Екатеринбург",
    bio: me.bio || "",
  });
  const [photos, setPhotos] = useState(me.photos || []);

  function update(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  async function guard(action) {
    setSaving(true);
    try {
      await action();
      haptic.success();
    } catch (error) {
      haptic.error();
      onError(error.detail || error.message);
    } finally {
      setSaving(false);
    }
  }

  const stepName = STEPS[step];

  return (
    <div className="flex flex-col h-full px-5 pt-4 pb-5">
      <ProgressDots total={STEPS.length} index={step} />

      {stepName === "consent" && (
        <ConsentStep
          saving={saving}
          onAccept={() =>
            guard(async () => {
              await endpoints.consent({ pdn: true, photo: true });
              setStep(1);
            })
          }
        />
      )}

      {stepName === "about" && (
        <AboutStep
          form={form}
          config={config}
          update={update}
          saving={saving}
          frozenBirthDate={Boolean(me.birth_date)}
          onNext={() =>
            guard(async () => {
              const patch = {
                first_name: form.first_name.trim(),
                gender: form.gender,
                city: form.city.trim(),
                bio: form.bio.trim() || null,
              };
              if (!me.birth_date) patch.birth_date = form.birth_date;
              await endpoints.updateMe(patch);
              setStep(2);
            })
          }
        />
      )}

      {stepName === "looking" && (
        <LookingStep
          form={form}
          update={update}
          saving={saving}
          onNext={() =>
            guard(async () => {
              await endpoints.updateMe({
                seeking_gender: form.seeking_gender,
                seeking_age_min: Number(form.seeking_age_min),
                seeking_age_max: Number(form.seeking_age_max),
              });
              setStep(3);
            })
          }
        />
      )}

      {stepName === "photo" && (
        <PhotoStep
          photos={photos}
          setPhotos={setPhotos}
          blindMode={config.blind_mode}
          maxPhotos={config.max_photos}
          saving={saving}
          guard={guard}
          onDone={onDone}
        />
      )}
    </div>
  );
}

function StepHeading({ title, hint }) {
  return (
    <div className="mt-7 mb-6">
      <h2 className="font-display text-2xl leading-tight" style={{ color: T.ink }}>{title}</h2>
      {hint && <p className="text-sm mt-1.5" style={{ color: T.muted }}>{hint}</p>}
    </div>
  );
}

function ConsentStep({ onAccept, saving }) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="flex flex-col h-full">
      <StepHeading
        title="Согласие на обработку данных"
        hint="Treffit хранит ответы теста, фото и — если включите Live — координаты."
      />
      <div className="rounded-2xl p-4 space-y-3" style={{ background: T.surface, border: `1px solid ${T.line}` }}>
        {[
          "Анкета и ответы теста — чтобы считать совпадения",
          "Фото — приватно, открывается собеседнику только после разговора",
          "Геолокация — только в момент чек-ина на событии, по вашему нажатию",
          "Удалить профиль и данные можно в любой момент в «Профиле»",
        ].map((line) => (
          <div key={line} className="flex gap-2.5">
            <Shield size={16} color={T.coral} className="flex-shrink-0 mt-0.5" />
            <span className="text-sm" style={{ color: T.ink }}>{line}</span>
          </div>
        ))}
      </div>

      <button
        onClick={() => setChecked((value) => !value)}
        className="flex items-start gap-3 mt-5 text-left active:scale-[0.98] transition-transform"
      >
        <span
          className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ background: checked ? T.coral : T.surface, border: `1px solid ${checked ? T.coral : T.line}` }}
        >
          {checked && <Check size={13} color="#fff" strokeWidth={3} />}
        </span>
        <span className="text-sm" style={{ color: T.ink }}>
          Мне есть 18 лет, я согласен(на) на обработку персональных данных, включая фото
          и геолокацию, в соответствии с 152-ФЗ
        </span>
      </button>

      <div className="flex-1" />
      <Button onClick={onAccept} disabled={!checked} loading={saving}>Продолжить</Button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.muted }}>{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputStyle = {
  background: T.surface,
  border: `1px solid ${T.line}`,
  color: T.ink,
};

function AboutStep({ form, update, onNext, saving, frozenBirthDate, config }) {
  const ready = form.first_name.trim() && form.gender && (frozenBirthDate || form.birth_date);
  return (
    <div className="flex flex-col h-full overflow-y-auto no-scrollbar">
      <StepHeading title="Расскажите о себе" hint="Это увидят другие — кроме даты рождения, показывается только возраст." />
      <div className="space-y-4">
        <Field label="Имя">
          <input
            value={form.first_name}
            onChange={(event) => update({ first_name: event.target.value })}
            maxLength={32}
            className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
            style={inputStyle}
            placeholder="Как вас зовут"
          />
        </Field>

        <Field label={`Дата рождения${frozenBirthDate ? " (изменить нельзя)" : ""}`}>
          <input
            type="date"
            value={form.birth_date}
            disabled={frozenBirthDate}
            onChange={(event) => update({ birth_date: event.target.value })}
            className="w-full rounded-2xl px-4 py-3 text-sm outline-none disabled:opacity-60"
            style={inputStyle}
          />
          <p className="text-xs mt-1" style={{ color: T.muted }}>Регистрация с {config.min_age} лет</p>
        </Field>

        <Field label="Пол">
          <div className="grid grid-cols-3 gap-2">
            {GENDERS.map((option) => (
              <button
                key={option.value}
                onClick={() => update({ gender: option.value })}
                className="rounded-2xl py-3 text-sm font-semibold active:scale-95 transition-transform"
                style={
                  form.gender === option.value
                    ? { background: gradient.action, color: "#fff" }
                    : inputStyle
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Город">
          <input
            value={form.city}
            onChange={(event) => update({ city: event.target.value })}
            className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
            style={inputStyle}
          />
        </Field>

        <Field label="О себе">
          <textarea
            value={form.bio}
            onChange={(event) => update({ bio: event.target.value })}
            maxLength={500}
            rows={3}
            className="w-full rounded-2xl px-4 py-3 text-sm outline-none resize-none"
            style={inputStyle}
            placeholder="Пара фраз — их видно до фото"
          />
        </Field>
      </div>

      <div className="pt-6 pb-1">
        <Button onClick={onNext} disabled={!ready} loading={saving}>Дальше</Button>
      </div>
    </div>
  );
}

function LookingStep({ form, update, onNext, saving }) {
  return (
    <div className="flex flex-col h-full">
      <StepHeading title="Кого ищете" hint="Фильтр можно поменять в любой момент в профиле." />
      <div className="space-y-5">
        <Field label="Показывать">
          <div className="grid grid-cols-3 gap-2">
            {SEEKING.map((option) => (
              <button
                key={option.value}
                onClick={() => update({ seeking_gender: option.value })}
                className="rounded-2xl py-3 text-sm font-semibold active:scale-95 transition-transform"
                style={
                  form.seeking_gender === option.value
                    ? { background: gradient.action, color: "#fff" }
                    : inputStyle
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label={`Возраст: ${form.seeking_age_min}–${form.seeking_age_max}`}>
          <div className="space-y-3 rounded-2xl p-4" style={inputStyle}>
            <div>
              <span className="text-xs" style={{ color: T.muted }}>от {form.seeking_age_min}</span>
              <input
                type="range"
                min={18}
                max={80}
                value={form.seeking_age_min}
                onChange={(event) =>
                  update({
                    seeking_age_min: Math.min(Number(event.target.value), form.seeking_age_max),
                  })
                }
                className="w-full"
                style={{ accentColor: T.coral }}
              />
            </div>
            <div>
              <span className="text-xs" style={{ color: T.muted }}>до {form.seeking_age_max}</span>
              <input
                type="range"
                min={18}
                max={80}
                value={form.seeking_age_max}
                onChange={(event) =>
                  update({
                    seeking_age_max: Math.max(Number(event.target.value), form.seeking_age_min),
                  })
                }
                className="w-full"
                style={{ accentColor: T.coral }}
              />
            </div>
          </div>
        </Field>
      </div>
      <div className="flex-1" />
      <Button onClick={onNext} loading={saving}>Дальше</Button>
    </div>
  );
}

function PhotoStep({ photos, setPhotos, blindMode, maxPhotos, saving, guard, onDone }) {
  const inputRef = React.useRef(null);

  function pick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    guard(async () => {
      const photo = await endpoints.uploadPhoto(file);
      setPhotos((current) => [...current, photo]);
    });
  }

  function remove(id) {
    guard(async () => {
      await endpoints.deletePhoto(id);
      setPhotos((current) => current.filter((photo) => photo.id !== id));
    });
  }

  return (
    <div className="flex flex-col h-full">
      <StepHeading
        title="Фото"
        hint={
          blindMode
            ? "В колоде его не покажут: фото откроется в чате, после трёх ваших сообщений."
            : "Первое фото — главное, его видят в колоде."
        }
      />

      <div className="grid grid-cols-3 gap-2.5">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="relative rounded-2xl overflow-hidden"
            style={{ aspectRatio: "3/4", background: photo.gradient }}
          >
            {photo.url && <img src={mediaUrl(photo.url)} alt="" className="w-full h-full object-cover" />}
            <button
              onClick={() => remove(photo.id)}
              className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background: "rgba(12,18,42,0.6)" }}
            >
              <Trash2 size={13} color="#fff" />
            </button>
            {photo.moderation_status === "pending" && (
              <div className="absolute bottom-1.5 left-1.5">
                <Pill tone="muted">на модерации</Pill>
              </div>
            )}
          </div>
        ))}

        {photos.length < maxPhotos && (
          <button
            onClick={() => inputRef.current?.click()}
            className="rounded-2xl flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-transform"
            style={{ aspectRatio: "3/4", background: T.surface, border: `1px dashed ${T.coral}` }}
          >
            <Camera size={20} color={T.coral} />
            <span className="text-xs font-semibold" style={{ color: T.coral }}>Добавить</span>
          </button>
        )}
      </div>

      <input ref={inputRef} type="file" accept="image/*" onChange={pick} className="hidden" />

      <p className="text-xs mt-4" style={{ color: T.muted }}>
        Фото проверяется перед публикацией.
      </p>

      <div className="flex-1" />
      <Button onClick={onDone} loading={saving}>
        {photos.length ? "Перейти к тесту" : "Пропустить, добавлю позже"}
      </Button>
    </div>
  );
}
