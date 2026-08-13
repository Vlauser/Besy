/**
 * Design tokens. Blue palette per docs/concept.md: primary blue for every
 * action, deep indigo reserved for "precious" moments (revealed photo
 * frame, compatibility ring, scratch foil).
 */

export const T = {
  bg: "#F3F6FD",
  surface: "#FFFFFF",
  surfaceSoft: "#EAF0FE",
  ink: "#1B2340",
  muted: "#8992A8",
  gold: "#2A3B8F",
  goldSoft: "#D7E1FA",
  coral: "#3D6BFF",
  coralDeep: "#2748D9",
  lavender: "#6E85E8",
  line: "#E1E7FA",
  danger: "#E2445C",
  success: "#20A67A",
};

export const gradient = {
  action: `linear-gradient(135deg, ${T.coral}, ${T.coralDeep})`,
  precious: `linear-gradient(135deg, ${T.coral}, ${T.gold})`,
  page: "linear-gradient(160deg, #F5F7FF 0%, #EAF0FE 50%, #DCE6FC 100%)",
};

export const FALLBACK_GRADIENT = "linear-gradient(135deg,#B9C6FF,#6E85E8)";
