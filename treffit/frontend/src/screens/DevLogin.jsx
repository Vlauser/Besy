import React, { useState } from "react";
import { TerminalSquare } from "lucide-react";

import { endpoints, setToken } from "../api/client";
import { Button } from "../components/ui";
import { T } from "../theme";

// Ids created by backend/scripts/seed.py.
const SEEDED = [
  [900000, "Аня, 29"],
  [900001, "Соня, 26"],
  [900002, "Лера, 31"],
  [900003, "Игорь, 32"],
  [900004, "Дима, 34"],
  [900005, "Марк, 28"],
];

/**
 * Browser-only sign-in. Outside Telegram there is no `initData`, so this
 * hits the dev auth path, which the server only honours when
 * TREFFIT_ALLOW_DEV_AUTH=true.
 */
export function DevLogin({ onAuthenticated, onError }) {
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState("");

  async function login(telegramId, firstName) {
    setBusy(true);
    try {
      const auth = await endpoints.devLogin(Number(telegramId), firstName);
      setToken(auth.access_token);
      onAuthenticated();
    } catch (error) {
      onError(error.detail || error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full px-6 pt-8 pb-6">
      <div className="flex items-center gap-2 mb-1">
        <TerminalSquare size={18} color={T.coral} />
        <span className="text-xs font-bold tracking-widest" style={{ color: T.coral }}>DEV LOGIN</span>
      </div>
      <h2 className="font-display text-2xl mb-1.5" style={{ color: T.ink }}>Вход вне Telegram</h2>
      <p className="text-sm mb-6" style={{ color: T.muted }}>
        В браузере нет <code>initData</code>. Выберите демо-профиль из сида или введите свой telegram_id.
      </p>

      <div className="space-y-2">
        {SEEDED.map(([id, label]) => (
          <button
            key={id}
            onClick={() => login(id)}
            disabled={busy}
            className="w-full flex items-center justify-between rounded-2xl p-3.5 active:scale-95 transition-transform"
            style={{ background: T.surface, border: `1px solid ${T.line}` }}
          >
            <span className="text-sm font-semibold" style={{ color: T.ink }}>{label}</span>
            <span className="text-xs" style={{ color: T.muted }}>{id}</span>
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <div className="flex gap-2 pt-4">
        <input
          value={custom}
          onChange={(event) => setCustom(event.target.value.replace(/\D/g, ""))}
          placeholder="telegram_id"
          className="flex-1 rounded-2xl px-4 py-3 text-sm outline-none"
          style={{ background: T.surface, border: `1px solid ${T.line}`, color: T.ink }}
        />
        <div style={{ width: 120 }}>
          <Button onClick={() => login(custom, `Гость ${custom}`)} disabled={!custom} loading={busy}>
            Войти
          </Button>
        </div>
      </div>
      <p className="text-xs mt-3" style={{ color: T.muted }}>
        Работает только при TREFFIT_ALLOW_DEV_AUTH=true на бэкенде.
      </p>
    </div>
  );
}
