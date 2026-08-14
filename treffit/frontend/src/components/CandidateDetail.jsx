import React from "react";
import { Flag, MapPin } from "lucide-react";

import { mediaUrl } from "../api/client";
import { CompatRing } from "./CompatRing";
import { Avatar, Button } from "./ui";
import { FALLBACK_GRADIENT, T } from "../theme";

/** Анкета кандидата: фото, кольцо совпадения, общие ответы, событие. */
export function CandidateDetail({ candidate, onLike, onPass, busy }) {
  const photo = candidate.photos?.[0];
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pt-6 pb-3">
        <div className="flex flex-col items-center">
          <Avatar
            src={photo?.url ? mediaUrl(photo.url) : null}
            grad={photo?.gradient || FALLBACK_GRADIENT}
            size={88}
            verified={candidate.is_verified}
          />
          <h2 className="font-display text-xl mt-3" style={{ color: T.ink }}>
            {candidate.first_name}
            {candidate.age ? `, ${candidate.age}` : ""}
          </h2>
          {candidate.bio && (
            <p className="text-sm text-center mt-1.5" style={{ color: T.muted }}>{candidate.bio}</p>
          )}
          <div className="mt-3">
            <CompatRing percent={candidate.compatibility_pct} />
          </div>
        </div>

        <div className="mt-4 space-y-2.5">
          {(candidate.shared_flags || []).map((flag) => (
            <div
              key={flag}
              className="flex items-center gap-2.5 rounded-2xl p-3"
              style={{ background: T.surface, border: `1px solid ${T.line}` }}
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: T.goldSoft }}
              >
                <Flag size={13} color={T.gold} />
              </span>
              <span className="text-sm" style={{ color: T.ink }}>{flag}</span>
            </div>
          ))}

          {candidate.event && (
            <div className="flex items-center gap-2.5 rounded-2xl p-3" style={{ background: "#E1EBFF", border: `1px solid ${T.line}` }}>
              <span className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#FFFFFF" }}>
                <MapPin size={13} color={T.coral} />
              </span>
              <span className="text-sm" style={{ color: T.ink }}>{candidate.event.title}</span>
            </div>
          )}

          {candidate.photos_locked && (
            <p className="text-xs text-center pt-1" style={{ color: T.muted }}>
              Фото откроется в чате
            </p>
          )}
        </div>
      </div>

      <div className="px-5 pb-5 pt-3 flex gap-3" style={{ borderTop: `1px solid ${T.line}` }}>
        <Button variant="secondary" onClick={onPass} disabled={busy}>Пропустить</Button>
        <Button onClick={onLike} loading={busy}>Лайк</Button>
      </div>
    </div>
  );
}
