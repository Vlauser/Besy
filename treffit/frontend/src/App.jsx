import React, { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  Heart,
  Home as HomeIcon,
  LayoutGrid,
  MessageCircle,
  User as UserIcon,
} from "lucide-react";

import { endpoints, mediaUrl, onUnauthorized, setToken } from "./api/client";
import { CandidateDetail, Pack } from "./screens/Pack";
import { ChatList } from "./screens/Chats";
import { ChatRoom } from "./screens/ChatRoom";
import { Deck } from "./screens/Deck";
import { DevLogin } from "./screens/DevLogin";
import { Home } from "./screens/Home";
import { Onboarding } from "./screens/Onboarding";
import { Profile } from "./screens/Profile";
import { Test } from "./screens/Test";
import { Avatar, Button, GlobalStyle, Loading, Sheet, Toast } from "./components/ui";
import { realtime } from "./lib/realtime";
import {
  getViewportHeight,
  haptic,
  initTelegram,
  isTelegram,
  onViewportChange,
  setBackButton,
} from "./lib/telegram";
import { FALLBACK_GRADIENT, T, gradient } from "./theme";

const TABS = [
  { key: "home", label: "Дом", icon: HomeIcon },
  { key: "deck", label: "Колода", icon: Heart },
  { key: "pack", label: "Пачка", icon: LayoutGrid },
  { key: "chats", label: "Чаты", icon: MessageCircle },
  { key: "profile", label: "Профиль", icon: UserIcon },
];

const TAB_TITLES = {
  home: "Treffit",
  deck: "Колода",
  pack: "Пачка карт",
  chats: "Чаты",
  profile: "Профиль",
  test: "Мини-тест",
};

export default function App() {
  const [booting, setBooting] = useState(true);
  const [fatal, setFatal] = useState(null);
  const [needsDevLogin, setNeedsDevLogin] = useState(false);
  const [config, setConfig] = useState(null);
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState("home");
  const [activeChatId, setActiveChatId] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [matchPopup, setMatchPopup] = useState(null);
  const [toast, setToast] = useState(null);
  const [height, setHeight] = useState(getViewportHeight);

  const notify = useCallback((message) => setToast(message), []);

  /* ---------------- boot: config + session ---------------- */

  const boot = useCallback(async () => {
    try {
      const productConfig = await endpoints.config();
      setConfig(productConfig);

      let profile = null;
      try {
        profile = await endpoints.me();
      } catch {
        if (!isTelegram) {
          // Browser session with no token: offer the dev sign-in instead of
          // failing, so the app is usable during development.
          setNeedsDevLogin(true);
          return;
        }
        // Exchange initData for a fresh token.
        const auth = await endpoints.login();
        setToken(auth.access_token);
        profile = auth.user;
      }
      setNeedsDevLogin(false);
      setMe(profile);
      realtime.connect();
    } catch (error) {
      setFatal(error.detail || error.message);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    initTelegram();
    boot();
    return () => realtime.disconnect();
  }, [boot]);

  useEffect(() => onViewportChange(() => setHeight(getViewportHeight())), []);

  // Re-authenticate only when a session we were actually using got rejected.
  const signedIn = Boolean(me);
  useEffect(() => {
    if (!signedIn) return undefined;
    return onUnauthorized(() => {
      setMe(null);
      boot();
    });
  }, [boot, signedIn]);

  /* ---------------- realtime notifications ---------------- */

  useEffect(
    () =>
      realtime.subscribe((event) => {
        if (event.type === "match") {
          haptic.success();
          setMatchPopup({
            chat_id: event.chat_id,
            candidate: { first_name: event.user.first_name, id: event.user.id, photos: [] },
          });
        }
        if (event.type === "superlike") notify("Кто-то отправил вам суперлайк ⭐");
      }),
    [notify]
  );

  /* ---------------- native back button ---------------- */

  const overlayOpen = Boolean(activeChatId || candidate);
  useEffect(() => {
    const goBack = () => {
      setActiveChatId(null);
      setCandidate(null);
    };
    return setBackButton(overlayOpen ? goBack : null);
  }, [overlayOpen]);

  /* ---------------- render states ---------------- */

  if (booting) {
    return (
      <Shell height={height} title="Treffit">
        <GlobalStyle />
        <Loading label="Подключаемся…" />
      </Shell>
    );
  }

  if (needsDevLogin) {
    return (
      <Shell height={height} title="Treffit">
        <GlobalStyle />
        <DevLogin onAuthenticated={boot} onError={notify} />
        <Toast message={toast} onDone={() => setToast(null)} />
      </Shell>
    );
  }

  if (fatal) {
    return (
      <Shell height={height} title="Treffit">
        <GlobalStyle />
        <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-4">
          <p className="font-display text-lg" style={{ color: T.ink }}>Не удалось запустить</p>
          <p className="text-sm" style={{ color: T.muted }}>{fatal}</p>
          <div className="w-full max-w-xs">
            <Button variant="secondary" onClick={() => window.location.reload()}>Повторить</Button>
          </div>
        </div>
      </Shell>
    );
  }

  if (!me.is_onboarded && tab !== "test") {
    const needsTest = me.consent_pdn_at && me.birth_date && me.gender && !me.test_completed_at;
    return (
      <Shell height={height} title="Знакомство">
        <GlobalStyle />
        {needsTest ? (
          <Test
            cards={config.test_cards}
            initialAnswers={me.test_answers}
            onSaved={setMe}
            onError={notify}
          />
        ) : (
          <Onboarding me={me} config={config} onError={notify} onDone={async () => setMe(await endpoints.me())} />
        )}
        <Toast message={toast} onDone={() => setToast(null)} />
      </Shell>
    );
  }

  /* ---------------- main app ---------------- */

  let body = null;
  if (tab === "home") {
    body = (
      <Home
        me={me}
        config={config}
        onGoDeck={() => setTab("deck")}
        onGoPack={() => setTab("pack")}
        onGoTest={() => setTab("test")}
        onError={notify}
      />
    );
  } else if (tab === "deck") {
    body = <Deck config={config} onMatch={setMatchPopup} onError={notify} />;
  } else if (tab === "pack") {
    body = <Pack onOpenCandidate={setCandidate} onError={notify} />;
  } else if (tab === "chats") {
    body = <ChatList onOpenChat={setActiveChatId} onError={notify} />;
  } else if (tab === "profile") {
    body = (
      <Profile
        me={me}
        config={config}
        testCards={config.test_cards}
        onUpdated={setMe}
        onGoTest={() => setTab("test")}
        onError={notify}
      />
    );
  } else if (tab === "test") {
    body = (
      <Test
        cards={config.test_cards}
        initialAnswers={me.test_answers}
        onSaved={(updated) => {
          setMe(updated);
          setTimeout(() => setTab("home"), 900);
        }}
        onError={notify}
      />
    );
  }

  if (activeChatId) {
    return (
      <Shell height={height} title="" onBack={() => setActiveChatId(null)} bare>
        <GlobalStyle />
        <ChatRoom
          chatId={activeChatId}
          config={config}
          onLeave={() => setActiveChatId(null)}
          onError={notify}
        />
        <Toast message={toast} onDone={() => setToast(null)} />
      </Shell>
    );
  }

  return (
    <Shell
      height={height}
      title={TAB_TITLES[tab]}
      onBack={tab === "test" ? () => setTab("profile") : null}
      footer={<TabBar tab={tab} onChange={setTab} />}
    >
      <GlobalStyle />
      <div key={tab} className="rise-in min-h-full">{body}</div>

      <Sheet open={Boolean(candidate)} onClose={() => setCandidate(null)} title="Совпадение">
        {candidate && (
          <div style={{ height: "70vh" }}>
            <CandidateDetail
              candidate={candidate}
              onPass={async () => {
                await endpoints.swipe(candidate.id, "pass").catch(() => {});
                setCandidate(null);
              }}
              onLike={async () => {
                try {
                  const result = await endpoints.swipe(candidate.id, "like");
                  setCandidate(null);
                  if (result.matched) setMatchPopup({ ...result, candidate });
                  else notify("Лайк отправлен");
                } catch (error) {
                  notify(error.detail || error.message);
                }
              }}
            />
          </div>
        )}
      </Sheet>

      <MatchPopup
        match={matchPopup}
        onClose={() => setMatchPopup(null)}
        onOpenChat={(chatId) => {
          setMatchPopup(null);
          setActiveChatId(chatId);
        }}
      />

      <Toast message={toast} onDone={() => setToast(null)} />
    </Shell>
  );
}

/**
 * App shell. Fills the Telegram viewport; in a desktop browser it renders as
 * a centred phone frame so the layout stays honest during development.
 */
function Shell({ height, title, onBack, footer, bare, children }) {
  const inner = (
    <div
      className="relative w-full flex flex-col overflow-hidden font-ui"
      style={{
        height: isTelegram ? height : Math.min(height - 40, 780),
        background: T.bg,
        ...(isTelegram
          ? {}
          : {
              maxWidth: 420,
              borderRadius: 28,
              boxShadow: "0 30px 70px -22px rgba(30,40,90,0.4), 0 0 0 1px rgba(61,107,255,0.12)",
            }),
      }}
    >
      {!bare && (
        <div
          className="flex items-center gap-2 px-4 py-3.5 flex-shrink-0"
          style={{ background: T.surface, borderBottom: `1px solid ${T.line}` }}
        >
          {onBack ? (
            <button onClick={onBack} className="p-1 -ml-1 rounded-full active:scale-90 transition-transform">
              <ChevronLeft size={20} color={T.ink} />
            </button>
          ) : (
            <span className="font-ui font-extrabold text-xs tracking-widest" style={{ color: T.coral }}>
              TREFFIT
            </span>
          )}
          <span className="font-display text-base" style={{ color: T.ink }}>{title}</span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto no-scrollbar relative">{children}</div>
      {footer}
    </div>
  );

  if (isTelegram) return inner;
  return (
    <div className="w-full min-h-screen flex items-center justify-center px-4" style={{ background: gradient.page }}>
      {inner}
    </div>
  );
}

function TabBar({ tab, onChange }) {
  return (
    <div
      className="flex items-stretch flex-shrink-0"
      style={{ background: T.surface, borderTop: `1px solid ${T.line}`, paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map(({ key, label, icon: Icon }) => {
        const active = tab === key;
        return (
          <button
            key={key}
            onClick={() => {
              haptic.select();
              onChange(key);
            }}
            className="flex-1 flex flex-col items-center gap-0.5 py-2.5 active:scale-95 transition-transform"
          >
            <Icon size={19} color={active ? T.coral : T.muted} strokeWidth={active ? 2.4 : 2} />
            <span className="text-[10px] font-semibold" style={{ color: active ? T.coral : T.muted }}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function MatchPopup({ match, onClose, onOpenChat }) {
  if (!match) return null;
  const candidate = match.candidate || {};
  const photo = candidate.photos?.[0];
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-8" style={{ background: "rgba(16,24,52,0.72)" }}>
      <div className="pop-in w-full max-w-xs rounded-3xl p-6 text-center" style={{ background: T.surface }}>
        <div className="flex justify-center mb-4">
          <Avatar
            src={photo?.url ? mediaUrl(photo.url) : null}
            grad={photo?.gradient || FALLBACK_GRADIENT}
            size={84}
          />
        </div>
        <h2 className="font-display text-2xl" style={{ color: T.ink }}>Взаимно!</h2>
        <p className="text-sm mt-1.5 mb-5" style={{ color: T.muted }}>
          Вы и {candidate.first_name} понравились друг другу
        </p>
        <div className="space-y-2">
          <Button onClick={() => onOpenChat(match.chat_id)}>Написать</Button>
          <Button variant="ghost" onClick={onClose}>Позже</Button>
        </div>
      </div>
    </div>
  );
}
