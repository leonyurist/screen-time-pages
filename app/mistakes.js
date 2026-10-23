// Going over the child's mistakes (SPEC.md "עוברים על הטעויות" in the app repo), like the Android app's
// MistakesScreen.kt: the mistakes of the last 30 days, going over them together one at a time, sending
// them to the child to try again alone ("לתת לנסות שוב"), and screen minutes at the end.

import * as api from "./api.js";
import { el, nodes, toast, runAction, openDialog, confirmDialog, chips, digitsInput, formatDate, israelDate } from "./ui.js";
import { subjects, subjectLabel } from "./shared.js";

// --- Data ---

/** A child's mistakes from the last 30 days, newest first (parent_mistakes). */
export async function loadMistakes(childId) {
  const rows = (await api.rpc("parent_mistakes", { p_child: childId })) || [];
  return rows.map((m) => ({
    id: m.id,
    subject: m.subject, // math | hebrew | english | reading | logic | general
    question: m.question,
    answer: m.answer,
    given: m.given,
    choices: m.choices, // in the order the child saw them, or null
    explanation: m.explanation || null,
    createdAt: m.created_at,
    status: m.status, // new | understood | still_hard | fixed | fixed_alone
    retries: m.retries || 0,
    reviewedBy: m.reviewed_by,
    passage: m.passage, // {title, body} or null
  }));
}

const isOpen = (m) => m.status === "new" || m.status === "still_hard";

/** The same question answered wrong more than once is shown once; tried again and wrong first, then the newest. */
export function groupMistakes(list) {
  const groups = new Map();
  for (const m of list) {
    const key = `${m.subject}|${m.question}|${m.answer}|${isOpen(m)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  return [...groups].map(([key, items]) => ({
    key,
    items,
    latest: items[0],
    open: isOpen(items[0]),
    status: items.some((m) => m.status === "still_hard") ? "still_hard" : items[0].status,
    retried: items.some((m) => m.retries > 0),
  })).sort((a, b) => (b.retried && b.open) - (a.retried && a.open) || new Date(b.latest.createdAt) - new Date(a.latest.createdAt));
}

/**
 * Can go back to the child as it was: saved whole (by the app since stage 2, with its explanation, or a
 * calculation with no words), and with its choices (reading also with its passage), or math.
 */
const replayable = (m) =>
  (m.explanation != null || (m.subject === "math" && !/[א-ת]/.test(m.question))) &&
  (m.subject === "math" || (m.choices != null && (m.subject !== "reading" || m.passage != null)));

/** {open: the request waiting for the child, done: the last finished one the parent hasn't seen} (parent_correction). */
export async function loadCorrection(childId) {
  const res = await api.rpc("parent_correction", { p_child: childId });
  return { open: res?.open || null, done: res?.done || null };
}

/** For the child's card: open mistakes (repeated ones once) and the correction state. */
export async function mistakesSummary(childId) {
  const [list, correction] = await Promise.all([loadMistakes(childId), loadCorrection(childId)]);
  return { open: groupMistakes(list).filter((g) => g.open).length, correction };
}

// --- Words ---

export const mistakesWord = (n) => (n === 1 ? "טעות אחת" : `${n} טעויות`);
const g = (child, boy, girl) => (child.gender === "boy" ? boy : child.gender === "girl" ? girl : `${boy}/${girl}`);
const answered = (child) => (child.gender === "boy" ? "ענה" : child.gender === "girl" ? "ענתה" : "ענה/תה");

function statusLabel(group, child) {
  if (group.open && group.retried) return `🔁 ${g(child, "ניסה שוב וטעה", "ניסתה שוב וטעתה")}`;
  return { still_hard: "🔁 עדיין קשה", understood: "✅ הבנו", fixed: "✅ תוקן", fixed_alone: "⭐ תוקן לבד" }[group.status] || "חדשה";
}

/** A calculation ("8 × 6") reads left-to-right with "= ?"; questions with words stay as they are. */
// Its own left-to-right box (direction marks from the app are dropped): neither a <bdi> nor LRE … PDF
// held in every place here (the list's two-line clamp, the big heading).
const questionText = (m) =>
  m.subject === "math" && !m.choices && !/[א-ת]/.test(m.question)
    ? el("span", { class: "ltr-math" }, `${m.question.replace(/[‪-‮⁦-⁩]/g, "")} = ?`)
    : m.question;

// --- A screen over the whole page ---

/** A full-page layer (like the Android app's full-screen dialog). Returns {set(parts), close}. */
function openSheet(onClose) {
  const inner = el("div", { class: "sheet-inner" });
  const sheet = el("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, inner);
  document.body.append(sheet);
  document.body.classList.add("sheet-open");
  let closed = false;
  return {
    set: (parts) => { inner.replaceChildren(...nodes(parts)); sheet.scrollTop = 0 },
    close: () => {
      if (closed) return;
      closed = true;
      sheet.remove();
      if (!document.querySelector(".sheet")) document.body.classList.remove("sheet-open");
      onClose?.();
    },
  };
}

// --- The list ---

/** The child's mistakes: to go over together, or already gone over. [onClosed] reloads the page under it. */
export function mistakesScreen(child, onClosed) {
  const sheet = openSheet(onClosed);
  const state = { subject: null, showOpen: true, rewarded: null };

  async function load() {
    sheet.set(el("p", { class: "loading" }, "טוען..."));
    try {
      const [list, correction] = await Promise.all([loadMistakes(child.id), loadCorrection(child.id)]);
      draw(groupMistakes(list), correction);
      // The child just finished correcting alone: the result and minutes first.
      if (correction.done && state.rewarded !== correction.done.id) {
        state.rewarded = correction.done.id;
        correctionDone(child, correction.done, load);
      }
    } catch (e) {
      sheet.set([header(), el("p", { class: "muted" }, e.message || "שגיאה"), el("button", { class: "btn plain", onclick: load }, "לנסות שוב")]);
    }
  }

  const header = () => el("div", { class: "row top" },
    el("div", { class: "grow" },
      el("h1", { class: "sheet-title" }, `📝 הטעויות של ${child.name}`),
      el("p", { class: "muted small" }, "מ-30 הימים האחרונים בלמידה החכמה")),
    el("button", { class: "btn plain", onclick: sheet.close }, "✕ סגירה"));

  function draw(groups, correction) {
    const shownSubjects = subjects().map((s) => [s.key, `${s.emoji} ${s.title}`]).filter(([key]) => groups.some((x) => x.latest.subject === key));
    const inSubject = groups.filter((x) => !state.subject || x.latest.subject === state.subject);
    const shown = inSubject.filter((x) => x.open === state.showOpen);
    const openCount = inSubject.filter((x) => x.open).length;
    // All subjects go to the child, whatever the filter shows.
    const allOpen = groups.filter((x) => x.open);
    const sendable = allOpen.filter((x) => replayable(x.latest)).length;
    const redraw = () => draw(groups, correction);
    const open = correction.open;

    sheet.set([
      header(),
      open && el("div", { class: "solo-banner row" },
        el("div", { class: "grow" },
          el("b", { class: "block" }, `🔧 ${child.name} ${g(child, "מתקן", "מתקנת")} לבד`),
          el("span", { class: "small muted" }, `${g(child, "ענה", "ענתה")} על ${open.answered} מתוך ${open.total} · ${open.fixed} תוקנו`)),
        el("button", {
          class: "btn plain danger", onclick: () => confirmDialog("לבטל את התיקון?",
            `השאלות שעוד לא נענו ייעלמו מהטלפון של ${child.name}. מה שכבר ${g(child, "ענה", "ענתה")} נשמר.`, "לבטל",
            () => runAction(() => api.rpc("parent_cancel_correction", { p_child: child.id }), "התיקון בוטל", load)),
        }, "ביטול")),
      shownSubjects.length > 1 && chips([[null, "הכול"], ...shownSubjects], state.subject, (s) => { state.subject = s; redraw() }),
      el("div", { class: "segmented" },
        el("button", { type: "button", "aria-pressed": String(state.showOpen), onclick: () => { state.showOpen = true; redraw() } }, `לעבור עליהן (${openCount})`),
        el("button", { type: "button", "aria-pressed": String(!state.showOpen), onclick: () => { state.showOpen = false; redraw() } }, `עברנו (${inSubject.length - openCount})`)),
      shown.length === 0 && el("p", { class: "muted pad" },
        groups.length === 0 ? "אין טעויות ב-30 הימים האחרונים 🎉" : state.showOpen ? "עברתם על כל הטעויות 🎉" : "עוד לא עברתם על אף טעות."),
      shown.map((x, i) => mistakeRow(x, child, () => walkthrough(child, shown, i, load))),
      state.showOpen && shown.length > 0 && el("div", { class: "sheet-bottom stack" },
        el("button", { class: "btn block big-btn", onclick: () => walkthrough(child, shown, 0, load) }, `▶ לעבור ביחד (${shown.length})`),
        !open && sendable > 0 && el("button", {
          class: "btn outline block", onclick: () => sendDialog(child, sendable, allOpen.length - sendable, load),
        }, `🔁 לתת ל${child.name} לנסות שוב לבד`)),
    ]);
  }

  load();
}

function mistakeRow(group, child, onclick) {
  const m = group.latest;
  return el("button", { type: "button", class: "card mistake-row", onclick },
    el("div", { class: "row" },
      el("span", { class: "grow small muted" }, subjectLabel(m.subject)),
      el("b", { class: "small " + (group.open ? "accent-text" : "primary-text") }, statusLabel(group, child))),
    el("span", { class: "block mistake-q" }, questionText(m)),
    el("span", { class: "small muted block" }, [
      formatDate(israelDate(m.createdAt)),
      group.items.length > 1 && `${g(child, "טעה", "טעתה")} בזה ${group.items.length} פעמים`,
      !group.open && m.reviewedBy && `סימן/ה: ${m.reviewedBy}`,
    ].filter(Boolean).join(" · ")));
}

/** "לתת לנסות שוב": how many go, and how many old ones can only be gone over together. */
function sendDialog(child, count, old, reload) {
  const questions = count === 1 ? "שאלה אחת" : `${count} שאלות`;
  openDialog((close) => ({
    title: `לשלוח ל${child.name} ${questions} לתיקון?`,
    body: [
      el("p", {}, `${count === 1 ? "השאלה תופיע" : "השאלות יופיעו"} בטלפון של ${child.name} תחת "🔧 תיקון טעויות", מכל המקצועות ביחד. ניסיון אחד לכל שאלה, בלי לראות את התשובה הנכונה.`),
      el("p", {}, `כש${g(child, "יסיים", "תסיים")} תקבלו התראה, ותוכלו לתת זמן מסך.`),
      old > 0 && el("p", { class: "small muted" }, `${old === 1 ? "טעות ישנה אחת נשמרה" : `${old} טעויות ישנות נשמרו`} בלי כל הפרטים, ואפשר רק לעבור עליהן ביחד.`),
    ],
    buttons: [
      el("button", { class: "btn plain", onclick: close }, "ביטול"),
      el("button", {
        class: "btn plain", onclick: () => {
          close();
          runAction(() => api.rpc("parent_start_correction", { p_child: child.id }), `נשלחו ל${child.name} ${questions} לתיקון 🔧`, reload);
        },
      }, "לשלוח"),
    ],
  }));
}

// --- Going over together ---

/** One mistake at a time, big enough to read together. The marks are saved right away. */
function walkthrough(child, groups, start, onDone) {
  const sheet = openSheet(onDone);
  const marks = new Map(); // index → understood | still_hard
  let index = start;

  const next = () => {
    if (index + 1 < groups.length) { index++; draw() } else if (marks.size === 0) sheet.close(); else finish();
  };

  async function mark(status) {
    const at = index;
    const before = marks.get(at);
    if (status === "new") marks.delete(at); else marks.set(at, status);
    if (status === "new") draw(); else next();
    try {
      for (const m of groups[at].items) await api.rpc("parent_mark_mistake", { p_id: m.id, p_status: status });
    } catch (e) {
      if (before) marks.set(at, before); else marks.delete(at);
      toast(e.message || "שגיאה");
    }
  }

  function finish() {
    const understood = [...marks.values()].filter((s) => s === "understood").length;
    const stillHard = marks.size - understood;
    sheet.set(rewardScreen(child, {
      emoji: "👏",
      title: `עברתם על ${mistakesWord(marks.size)}`,
      subtitle: stillHard > 0 && `${stillHard} עדיין ${stillHard === 1 ? "קשה" : "קשות"}: ${stillHard === 1 ? "היא תחזור" : "הן יחזרו"} ל${child.name} בלמידה הבאה.`,
      ask: `לתת ל${child.name} זמן מסך על השיחה?`,
      note: "📝 עברנו על הטעויות",
    }, sheet.close));
  }

  function draw() {
    const group = groups[index];
    const m = group.latest;
    const who = `${child.name} ${answered(child)}`;
    const done = marks.get(index);
    sheet.set([
      el("div", { class: "row" },
        el("b", { class: "grow" }, `${index + 1} מתוך ${groups.length}`),
        el("button", { class: "btn plain", onclick: () => (marks.size === 0 ? sheet.close() : finish()) }, "✕ סיום")),
      el("p", { class: "small muted" }, [subjectLabel(m.subject), formatDate(israelDate(m.createdAt)),
        group.items.length > 1 && `${g(child, "טעה", "טעתה")} בזה ${group.items.length} פעמים`].filter(Boolean).join(" · ")),
      m.passage && foldBox(`📖 ${m.passage.title || "הקטע"}`, m.passage.body, true, "passage-box"),
      el("h2", { class: "walk-q" }, questionText(m)),
      m.choices
        ? m.choices.map((c) => choiceLine(c, c === m.given ? false : c === m.answer ? true : null, who))
        : [choiceLine(m.given, false, who), choiceLine(m.answer, true, who)],
      m.explanation && foldBox("💡 איך פותרים", m.explanation, false, "explain-box"),
      done && el("div", { class: "row" },
        el("span", { class: "grow muted" }, done === "understood" ? "סימנתם: ✅ הבנו" : "סימנתם: 🔁 עדיין קשה"),
        el("button", { class: "btn plain", onclick: () => mark("new") }, "ביטול הסימון")),
      el("div", { class: "sheet-bottom stack" },
        el("button", { class: "btn block big-btn", onclick: () => mark("understood") }, "✅ עברנו על זה, הבנו"),
        el("div", { class: "row" },
          el("button", { class: "btn outline grow", onclick: () => mark("still_hard") }, "🔁 עדיין קשה"),
          el("button", { class: "btn outline grow", onclick: next }, "⏭ דילוג")),
        index > 0 && el("button", { class: "btn plain", onclick: () => { index--; draw() } }, "› הקודמת")),
    ]);
  }

  draw();
}

/** A choice (or the typed answer): red with ✗ for the child's answer, green with ✓ for the right one. */
function choiceLine(text, right, who) {
  const kind = right === false ? "wrong" : right === true ? "right" : "";
  const shown = /[א-ת]/.test(text) ? text : el("bdi", { dir: "ltr" }, text);
  return el("div", { class: `choice-line ${kind}` },
    el("span", { class: "grow" }, shown),
    right === false && el("b", { class: "small" }, `✗ ${who}`),
    right === true && el("b", { class: "small" }, "✓ התשובה הנכונה"));
}

/** A box with a title that opens and closes on tap (the reading passage, "how to solve it"). */
function foldBox(title, text, open, cls) {
  const body = el("p", { class: "fold-body" }, text);
  const head = el("b", { class: "block" });
  const box = el("button", { type: "button", class: `fold ${cls}` }, head, body);
  const draw = () => { head.textContent = `${title} ${open ? "▴" : "▾"}`; body.hidden = !open };
  box.onclick = () => { open = !open; draw() };
  draw();
  return box;
}

// --- Screen minutes at the end ---

/** A title, and screen minutes (10 / 20 / 30 / other / not this time). [onClose] after either. */
function rewardScreen(child, { emoji, title, subtitle, ask, note }, onClose) {
  let sending = false;
  const buttons = [];
  async function give(minutes) {
    if (sending) return;
    sending = true;
    buttons.forEach((b) => { b.disabled = true });
    try {
      await api.rpc("parent_add_minutes", { p_child: child.id, p_minutes: minutes, p_note: note });
      toast(`נוספו ${minutes} דקות ל${child.name} 🎁`);
      onClose();
    } catch (e) {
      sending = false;
      buttons.forEach((b) => { b.disabled = false });
      toast(e.message || "שגיאה");
    }
  }
  let text = "";
  const giveOther = el("button", { class: "btn", disabled: true, onclick: () => give(Number(text)) }, "לתת");
  const otherRow = el("div", { class: "row other-row", hidden: true },
    digitsInput("", 4, (v) => { text = v; giveOther.disabled = !(Number(v) >= 1 && Number(v) <= 1440) }, { placeholder: "כמה דקות" }),
    giveOther);
  [10, 20, 30].forEach((m) => buttons.push(el("button", { class: "btn big-btn", onclick: () => give(m) }, `${m} דק׳`)));
  buttons.push(el("button", { class: "btn outline big-btn", onclick: () => { otherRow.hidden = false; otherRow.querySelector("input").focus() } }, "אחר"));
  return el("div", { class: "reward stack" },
    el("div", { class: "reward-emoji" }, emoji),
    el("h1", { class: "sheet-title" }, title),
    subtitle && el("p", { class: "muted" }, subtitle),
    el("b", { class: "reward-ask" }, ask),
    el("div", { class: "button-row reward-buttons" }, buttons),
    otherRow,
    el("button", { class: "btn plain", onclick: () => { if (!sending) onClose() } }, "לא הפעם"));
}

/** The child finished correcting alone: how many were fixed, and minutes. Marked seen either way. */
function correctionDone(child, done, reload) {
  const sheet = openSheet(reload);
  const left = done.total - done.fixed;
  const close = async () => {
    try { await api.rpc("parent_ack_correction", { p_id: done.id }) } catch {}
    sheet.close(); // after the server knows, so the list reloads without it
  };
  sheet.set(rewardScreen(child, {
    emoji: left === 0 ? "🎉" : "🔧",
    title: `${child.name} ${g(child, "תיקן", "תיקנה")} לבד ${done.fixed} מתוך ${done.total}`,
    subtitle: left > 0 && `${left === 1 ? "טעות אחת נשארה" : `${left} טעויות נשארו`} ברשימה, כדאי לעבור ${left === 1 ? "עליה" : "עליהן"} ביחד.`,
    ask: `לתת ל${child.name} זמן מסך על התיקון?`,
    note: "🔧 תיקון טעויות",
  }, close));
}
