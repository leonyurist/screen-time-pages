// Pieces used by several screens: the "which child?" chips, finished activities (approvals and
// history), and the child's photos. Ported from ChildPicker.kt, ApprovalsScreen.kt and PhotoViews.kt.

import * as api from "./api.js";
import { el, openDialog, digitsInput, minutesBetween } from "./ui.js";

export const DEFAULT_AVATAR = "🙂";

// --- Which child ---

export async function loadChildRefs() {
  const rows = await api.select("children?select=id,name,avatar&order=created_at");
  return rows.map((c) => ({ id: c.id, name: c.name, avatar: c.avatar || DEFAULT_AVATAR }));
}

/** The selected child, or the first one if nothing (or a deleted child) is selected. */
export const pick = (children, selectedId) => children.find((c) => c.id === selectedId) || children[0] || null;

/** "Which child?" chips at the top of a screen. Hidden when there's only one child. */
export function childPicker(children, selected, onSelect) {
  if (children.length < 2) return "";
  return el("div", { class: "chips nowrap child-picker" },
    children.map((c) =>
      el("button", { type: "button", class: "chip", "aria-pressed": String(c.id === selected?.id), onclick: () => onSelect(c.id) },
        `${c.avatar} ${c.name}`)));
}

/** Shown on per-child screens before any child has been added. */
export const noChildrenYet = () => el("p", { class: "muted pad" }, "קודם מוסיפים ילד במסך \"ילדים\".");

// --- Finished activities ---

const SESSION_FIELDS =
  "id,subject,started_at,ended_at,status,approved_minutes,ratio,activities(emoji),children(name,avatar,rules(ratio)),session_photos(path,created_at),kind,exercises,correct_answers,hints,bonus_minutes,details";

export async function loadSessions(query) {
  const rows = await api.select(`study_sessions?select=${SESSION_FIELDS}&${query}`);
  return rows.map((s) => {
    const child = s.children;
    const childRules = Array.isArray(child?.rules) ? child.rules[0] : child?.rules;
    const learning = s.kind === "learning";
    const minutes = minutesBetween(s.started_at, s.ended_at);
    const ratio = s.ratio ?? childRules?.ratio ?? 1;
    return {
      id: s.id,
      subject: s.subject?.trim() ? s.subject : "שיעורי בית",
      emoji: learning ? "🎓" : s.activities?.emoji || "📚",
      start: s.started_at,
      end: s.ended_at,
      status: s.status,
      approvedMinutes: s.approved_minutes,
      ratio,
      minutes,
      /** Screen minutes the full session is worth (before the daily cap). */
      fullScreenMinutes: Math.floor(minutes * ratio),
      childName: child?.name || "",
      childAvatar: child?.avatar || DEFAULT_AVATAR,
      photos: (s.session_photos || []).slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).map((p) => p.path),
      learning: !learning ? null : {
        exercises: s.exercises || 0,
        correct: s.correct_answers || 0,
        hints: s.hints || 0,
        bonusMinutes: s.bonus_minutes || 0,
        mistakes: (s.details || []).map((d) => ({ q: d.q ?? "", answer: d.answer ?? "", given: d.given ?? "" })),
        get percent() { return this.exercises === 0 ? 0 : Math.floor((this.correct * 100) / this.exercises) },
      },
    };
  });
}

/** Approves (optionally with fewer minutes) or rejects a pending session. Returns the message to show. */
export async function reviewSession(s, approve, minutes = null) {
  await api.rpc("review_session", { p_session: s.id, p_approve: approve, p_minutes: minutes });
  return !approve ? "נדחה" : `אושר: ${minutes ?? s.fullScreenMinutes} דקות ל${s.childName}`;
}

/** Asks how many screen minutes to give for a shortened approval. */
export function shortenDialog(s, onConfirm) {
  let minutes = String(Math.floor(s.fullScreenMinutes / 2));
  const value = () => (minutes === "" ? null : Number(minutes));
  const ok = el("button", { class: "btn plain" }, "אישור");
  const check = () => { ok.disabled = value() == null || value() > s.fullScreenMinutes };
  const input = digitsInput(minutes, 3, (v) => { minutes = v; check() });
  check();
  openDialog((close) => {
    ok.onclick = () => { close(); onConfirm(value()) };
    return {
      title: "אישור מקוצר",
      body: [el("p", { class: "muted" }, `כמה דקות מסך לתת? (עד ${s.fullScreenMinutes})`), input],
      buttons: [el("button", { class: "btn plain", onclick: close }, "ביטול"), ok],
    };
  });
  input.focus();
}

/** The three choices for a pending session, as a dialog (used from the history screen). */
export function reviewDialog(s, onReview) {
  openDialog((close) => ({
    title: `${s.emoji} ${s.subject}`,
    body: [el("p", {}, `${s.minutes} דקות פעילות ← ${s.fullScreenMinutes} דקות מסך`), photoThumbs(s.photos)],
    buttons: el("div", { class: "stack-end" },
      el("button", { class: "btn", onclick: () => { close(); onReview(true, null) } }, `אישור (${s.fullScreenMinutes} דק׳)`),
      el("button", { class: "btn outline", onclick: () => { close(); shortenDialog(s, (m) => onReview(true, m)) } }, "מקוצר"),
      el("button", { class: "btn plain danger", onclick: () => { close(); onReview(false, null) } }, "דחייה")),
  }));
}

// --- Photos ---

/** Recently shown photos, so going back and forth doesn't download them again. */
const photoUrls = new Map();

async function photoUrl(path) {
  if (!photoUrls.has(path)) {
    photoUrls.set(path, api.downloadPhoto(path).then((blob) => URL.createObjectURL(blob)).catch((e) => { photoUrls.delete(path); throw e }));
  }
  return photoUrls.get(path);
}

/** Small photos the child took for an activity; tapping one opens it full screen. */
export function photoThumbs(paths) {
  if (!paths?.length) return "";
  return el("div", { class: "thumbs" }, paths.map((path) => {
    const box = el("button", { type: "button", class: "thumb", "aria-label": "תמונה מהפעילות", onclick: () => fullPhoto(path) }, "📷");
    photoUrl(path).then((url) => box.replaceChildren(el("img", { src: url, alt: "תמונה מהפעילות" }))).catch(() => {});
    return box;
  }));
}

function fullPhoto(path) {
  const viewer = el("div", { class: "photo-viewer", onclick: () => viewer.remove() },
    el("button", { class: "btn plain light-text", type: "button" }, "✕ סגירה"),
    el("p", { class: "loading light-text" }, "טוען..."),
    el("p", { class: "photo-note" }, "התמונות נשמרות 90 יום ואז נמחקות אוטומטית"));
  document.body.append(viewer);
  photoUrl(path)
    .then((url) => viewer.children[1].replaceWith(el("img", { src: url, alt: "תמונה מהפעילות" })))
    .catch((e) => { viewer.children[1].textContent = e.message });
}

// --- App logos the child's phone sent ---

/** An <img> of the logo (Base64 from device_apps.icon), or an empty square. */
export function appIcon(base64, size = 32) {
  if (!base64) return el("span", { class: "app-icon empty", style: `width:${size}px;height:${size}px` });
  return el("img", { class: "app-icon", src: "data:image/png;base64," + base64.replace(/\s/g, ""), alt: "", width: size, height: size });
}
