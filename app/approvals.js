// "אישורים": activities waiting for approval (approve / shorten / reject, with photos), and the
// ones handled lately, one card per day. Ported from ApprovalsScreen.kt.

import { el, toast, loadInto, screenTitle, formatDate, formatDateTime, formatTime, israelDate, signed } from "./ui.js";
import { loadSessions, reviewSession, shortenDialog, photoThumbs } from "./shared.js";

export function approvalsScreen(container) {
  const reload = () => approvalsScreen(container);

  async function review(s, approve, minutes = null) {
    try {
      toast(await reviewSession(s, approve, minutes));
      reload();
    } catch (e) {
      toast(e.message || "שגיאה");
    }
  }

  return loadInto(container, async () => ({
    pending: await loadSessions("status=eq.pending&order=started_at"),
    recent: await loadSessions("status=neq.pending&order=reviewed_at.desc&limit=30"),
  }), ({ pending, recent }) => {
    // One card per day, newest day first.
    const days = new Map();
    for (const s of recent) {
      const day = israelDate(s.start);
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(s);
    }
    return [
      screenTitle("אישורים", "משימות שמחכות לאישור. כדי לוותר על אישור לילד מסוים, מבטלים את \"אישור הורה למשימות\" במסך ההגדרות."),
      pending.length === 0 && el("div", { class: "empty" }, el("div", { class: "big" }, "🎉"), el("p", { class: "muted" }, "אין משימות שמחכות לאישור")),
      pending.map((s) => pendingCard(s, () => review(s, true), () => shortenDialog(s, (m) => review(s, true, m)), () => review(s, false))),
      recent.length > 0 && el("h2", { class: "section-title" }, "טופלו לאחרונה"),
      [...days.keys()].sort().reverse().map((day) => recentDayCard(day, days.get(day))),
    ];
  });
}

function pendingCard(s, onApprove, onShorten, onReject) {
  return el("section", { class: "card" },
    el("div", { class: "row" },
      el("span", { class: "avatar small-avatar", "aria-hidden": "true" }, s.childAvatar),
      el("div", { class: "grow" },
        el("b", { class: "block" }, `${s.childName} · ${s.emoji} ${s.subject}`),
        el("span", { class: "small muted" }, formatDateTime(s.start)))),
    el("p", {}, `${s.minutes} דקות פעילות ← ${s.fullScreenMinutes} דקות מסך`),
    photoThumbs(s.photos),
    el("div", { class: "button-row" },
      el("button", { class: "btn", onclick: onApprove }, `אישור (${s.fullScreenMinutes} דק׳)`),
      el("button", { class: "btn outline", onclick: onShorten }, "מקוצר"),
      el("button", { class: "btn plain danger", onclick: onReject }, "דחייה")));
}

/** Activities handled on one day: who, what, when, and whether it was approved (with how many minutes). */
function recentDayCard(day, list) {
  return el("section", { class: "card list-card" },
    el("b", { class: "list-head" }, formatDate(day)),
    list.slice().sort((a, b) => (a.start < b.start ? 1 : -1)).map((s) => {
      const approved = s.status === "approved";
      return el("div", { class: "list-row" },
        el("span", { class: "row-emoji" }, s.childAvatar),
        el("div", { class: "grow" },
          el("b", { class: "block medium" }, `${s.childName} · ${s.emoji} ${s.subject}`),
          el("span", { class: "small muted" }, `${formatTime(s.start)} · ${s.minutes} דק׳ פעילות`)),
        el("span", { class: approved ? "badge ok" : "badge grey" }, approved ? `✓ ${signed(s.approvedMinutes ?? 0)} דק׳` : "✕ נדחה"));
    }));
}
