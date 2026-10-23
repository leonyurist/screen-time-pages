// "היסטוריה": three views, like the Android app (HistoryScreen.kt, LearningSummary.kt, StatsScreen.kt):
// - "⭐ משימות": tasks and minute gifts of the last 30 days, a small card per day that opens on tap;
// - "🎓 למידה": in-app learning by subject in the last 7, 30 or 90 days, and what was hard;
// - "📊 זמן מסך": a bar per day (7 or 30 days, and earlier periods), and the time in each app on the chosen day.

import * as api from "./api.js";
import {
  el, toast, openDialog, chips, loadInto, screenTitle, formatDate, formatTime, israelDate, israelToday, addDays,
  israelTime, weekday, signed, formatDuration,
} from "./ui.js";
import { mistakesScreen } from "./mistakes.js";
import { loadChildRefs, pick, childPicker, noChildrenYet, loadSessions, reviewSession, reviewDialog, photoThumbs, appIcon, subjects } from "./shared.js";

const HISTORY_DAYS = 30;

/** Which view, period and page are shown (kept while moving between tabs). */
const view = { name: "tasks", period: 7, pagesBack: 0, chosenDay: null, learningDays: 7, openDays: new Set() };

export function historyScreen(container, app) {
  if (view.name === "learning") return learningView(container, app);
  return view.name === "stats" ? statsView(container, app) : activityHistory(container, app);
}

/** "Tasks | learning | screen time" at the top of the history tab. */
function viewSwitch(container, app) {
  return el("div", { class: "segmented" },
    [["tasks", "⭐ משימות"], ["learning", "🎓 למידה"], ["stats", "📊 זמן מסך"]].map(([name, label]) =>
      el("button", { type: "button", "aria-pressed": String(view.name === name), onclick: () => { view.name = name; historyScreen(container, app) } }, label)));
}

/** "ענה" for a boy, "ענתה" for a girl ("ענה/תה" if the gender isn't known). */
const answered = (gender) => (gender === "boy" ? "ענה" : gender === "girl" ? "ענתה" : "ענה/תה");
/** A verb by the child's gender: byGender(child, "סיים", "סיימה"). */
const byGender = (child, boy, girl) => (child?.gender === "boy" ? boy : child?.gender === "girl" ? girl : `${boy}/ה`);

// --- Tasks ---

function activityHistory(container, app) {
  const reload = () => activityHistory(container, app);
  return loadInto(container, async () => {
    const children = await loadChildRefs();
    const child = pick(children, app.childId);
    if (!child) return { children, child, sessions: [], gifts: [] };
    const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 19) + "Z";
    const [sessions, gifts] = await Promise.all([
      loadSessions(`child_id=eq.${child.id}&started_at=gte.${since}&order=started_at.desc`),
      api.select(`ledger?select=minutes,reason,created_at&child_id=eq.${child.id}&kind=in.(parent,daily)&created_at=gte.${since}&order=created_at.desc`),
    ]);
    return { children, child, sessions, gifts: gifts.map((g) => ({ minutes: Math.trunc(g.minutes), reason: g.reason, at: g.created_at })) };
  }, ({ children, child, sessions, gifts }) => {
    const days = new Map();
    const add = (day, kind, item) => {
      if (!days.has(day)) days.set(day, { sessions: [], gifts: [] });
      days.get(day)[kind].push(item);
    };
    sessions.forEach((s) => add(israelDate(s.start), "sessions", s));
    gifts.forEach((g) => add(israelDate(g.at), "gifts", g));
    const onReview = (s) => reviewDialog(s, async (approve, minutes) => {
      try { toast(await reviewSession(s, approve, minutes)); reload() } catch (e) { toast(e.message || "שגיאה") }
    });
    return [
      screenTitle("היסטוריה", `כל המשימות של ${HISTORY_DAYS} הימים האחרונים.`),
      viewSwitch(container, app),
      childPicker(children, child, (id) => { app.childId = id; reload() }),
      !child ? noChildrenYet()
        : sessions.length === 0 && gifts.length === 0 && el("p", { class: "muted" }, `${child.name} עוד לא ${byGender(child, "סיים", "סיימה")} משימות בתקופה הזו.`),
      [...days.keys()].sort().reverse().map((day) => dayCard(day, days.get(day), onReview, child)),
    ];
  });
}

/** A small card per day (date, minutes); tap it to open the day's tasks and gifts. */
function dayCard(day, { sessions, gifts }, onReview, child) {
  const activityMinutes = sessions.reduce((n, s) => n + s.minutes, 0);
  const screenMinutes = sessions.reduce((n, s) => n + (s.approvedMinutes ?? 0), 0) + gifts.reduce((n, g) => n + g.minutes, 0);
  const count = sessions.length + gifts.length;
  const pending = sessions.filter((s) => s.status === "pending").length;
  // Gifts and activities together, newest first, like the days.
  const entries = [...gifts.map((g) => [g.at, g]), ...sessions.map((s) => [s.start, s])]
    .sort((a, b) => new Date(b[0]) - new Date(a[0]));
  const body = el("div", {});
  const arrow = el("span", { class: "muted day-arrow" });
  const draw = () => {
    const open = view.openDays.has(day);
    arrow.textContent = open ? "▴" : "▾";
    body.replaceChildren(...(open ? entries.map(([, e]) => ("reason" in e ? giftRow(e) : sessionRow(e, onReview, child))) : []));
  };
  draw();
  return el("section", { class: "card list-card" },
    el("button", {
      type: "button", class: "list-head row day-head", "aria-expanded": String(view.openDays.has(day)),
      onclick: (e) => {
        if (view.openDays.has(day)) view.openDays.delete(day); else view.openDays.add(day);
        e.currentTarget.setAttribute("aria-expanded", String(view.openDays.has(day)));
        draw();
      },
    },
      el("div", { class: "grow" },
        el("b", { class: "block" }, formatDate(day)),
        el("span", { class: "small muted" },
          `${count} ${count === 1 ? "פריט" : "פריטים"} · ${activityMinutes} דק׳ משימות · ${screenMinutes < 0 ? signed(screenMinutes) : screenMinutes} דק׳ מסך`)),
      pending > 0 && el("span", { class: "badge pending" }, `${pending} ${pending === 1 ? "ממתינה" : "ממתינות"}`),
      arrow),
    body);
}

function giftRow(g) {
  return el("div", { class: "list-row" },
    el("div", { class: "grow" },
      el("b", { class: "block medium" }, `${g.minutes > 0 ? "🎁" : "➖"} ${g.reason}`),
      el("span", { class: "small muted" }, formatTime(g.at))),
    el("span", { class: g.minutes > 0 ? "badge ok" : "badge grey" }, `${signed(g.minutes)} דק׳ מסך`));
}

function sessionRow(s, onReview, child) {
  const l = s.learning;
  const badge = s.status === "approved" ? el("span", { class: "badge ok" }, `${signed(s.approvedMinutes ?? 0)} דק׳ מסך`)
    : s.status === "pending" ? el("button", { type: "button", class: "badge pending", onclick: () => onReview(s) }, "ממתין לאישור ›")
    : el("span", { class: "badge grey" }, "נדחה");
  const info = el("div", { class: "grow" },
    el("b", { class: "block medium" }, `${s.emoji} ${s.subject}`),
    el("span", { class: "small muted block" }, `${formatTime(s.start)}–${formatTime(s.end)} · ${s.minutes} דק׳`),
    l && el("span", { class: "small primary-text block" },
      `${learningCount(s.subject, l.exercises)} · ${l.percent}% הצלחה` +
      (l.bonusMinutes > 0 ? ` · בונוס ${signed(l.bonusMinutes)} 🏆` : "") +
      (l.mistakes.length ? " · פרטים ›" : "")),
    photoThumbs(s.photos));
  if (l) {
    info.classList.add("clickable");
    info.addEventListener("click", (e) => { if (!e.target.closest(".thumb")) learningDetails(s, child) });
  }
  return el("div", { class: "list-row" }, info, badge);
}

/** "12 תרגילים" (math) or "12 שאלות" (other subjects), and "תרגיל אחד" / "שאלה אחת" for one. */
function learningCount(subject, n) {
  const math = subject.startsWith("חשבון");
  if (n === 1) return math ? "תרגיל אחד" : "שאלה אחת";
  return `${n} ${math ? "תרגילים" : "שאלות"}`;
}

/** A mistake: math "7 + 5 = 12" left-to-right; other subjects the question, then the answers in words. */
function mistakeLine({ q, answer, given }, math, child) {
  const word = answered(child?.gender);
  if (math && !/[א-ת]/.test(q)) {
    return el("p", { class: "small" }, "• ", el("bdi", { dir: "ltr" }, `${q} = ${answer}`), ` (${word} `, el("bdi", { dir: "ltr" }, given), ")");
  }
  return el("p", { class: "small" }, `• ${q}`, el("br"), `   התשובה: ${answer} (${word} `, el("bdi", {}, given), ")");
}

function learningDetails(s, child) {
  const l = s.learning;
  const math = s.subject.startsWith("חשבון");
  openDialog((close) => ({
    title: `🎓 ${s.subject}`,
    body: [
      el("p", {}, `${learningCount(s.subject, l.exercises)} · ${l.correct} נכונים (${l.percent}%) · ${l.hints} רמזים`),
      l.bonusMinutes > 0 && el("p", { class: "primary-text" }, `בונוס: ${signed(l.bonusMinutes)} דקות 🏆`),
      l.mistakes.length === 0 ? el("b", {}, "אין טעויות 🎉") : [el("b", {}, "טעויות:"), l.mistakes.map((m) => mistakeLine(m, math, child))],
    ],
    buttons: el("button", { class: "btn plain", onclick: close }, "סגירה"),
  }));
}

// --- In-app learning ---

function learningView(container, app) {
  const reload = () => learningView(container, app);
  return loadInto(container, async () => {
    const children = await loadChildRefs();
    const child = pick(children, app.childId);
    if (!child) return { children, child };
    const end = israelToday();
    const from = israelTime(addDays(end, -(view.learningDays - 1))).toISOString();
    const to = israelTime(addDays(end, 1)).toISOString();
    const sessions = await loadSessions(`child_id=eq.${child.id}&kind=eq.learning&started_at=gte.${from}&started_at=lt.${to}&order=started_at.desc&limit=1000`);
    return { children, child, learning: bySubject(sessions) };
  }, ({ children, child, learning }) => [
    screenTitle("היסטוריה", "מה הילד למד בלמידה החכמה, כמה זמן, ובמה היה קשה."),
    viewSwitch(container, app),
    childPicker(children, child, (id) => { app.childId = id; reload() }),
    !child ? noChildrenYet() : [
      chips([[7, "7 ימים"], [30, "30 ימים"], [90, "90 ימים"]], view.learningDays, (d) => { view.learningDays = d; reload() }),
      learningSummary(child, learning),
      el("button", { class: "btn outline block", onclick: () => mistakesScreen(child) }, `📝 לעבור על הטעויות של ${child.name}`),
    ],
  ]);
}

// --- Screen time ---

/** Sunday first, like the Israeli week. */
const HEBREW_DAY_LETTERS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

function statsView(container, app) {
  const reload = () => statsView(container, app);
  return loadInto(container, async () => {
    const children = await loadChildRefs();
    const child = pick(children, app.childId);
    if (!child) return { children, child };
    const end = addDays(israelToday(), -view.period * view.pagesBack);
    const start = addDays(end, -(view.period - 1));
    const [rows, apps] = await Promise.all([
      api.select(`app_usage?select=day,package,seconds&child_id=eq.${child.id}&day=gte.${start}&day=lte.${end}&limit=5000`),
      api.select(`device_apps?select=package,label,icon&child_id=eq.${child.id}`),
    ]);
    const days = [];
    for (let i = 0; i < view.period; i++) {
      const day = addDays(start, i);
      const apps = {};
      rows.filter((r) => r.day === day).forEach((r) => { apps[r.package] = r.seconds });
      days.push({ day, apps, total: Object.values(apps).reduce((a, b) => a + b, 0) });
    }
    return {
      children, child, days,
      labels: Object.fromEntries(apps.map((a) => [a.package, a.label])),
      icons: Object.fromEntries(apps.filter((a) => a.icon).map((a) => [a.package, a.icon])),
    };
  }, ({ children, child, days, labels, icons }) => {
    const top = [
      screenTitle("היסטוריה", "כמה זמן מסך בכל יום ובאילו אפליקציות."),
      viewSwitch(container, app),
      childPicker(children, child, (id) => { app.childId = id; view.chosenDay = null; reload() }),
    ];
    if (!child) return [...top, noChildrenYet()];

    const setPage = (period, pagesBack) => { view.period = period; view.pagesBack = pagesBack; view.chosenDay = null; reload() };
    const total = days.reduce((n, d) => n + d.total, 0);
    const usedDays = days.filter((d) => d.total > 0).length;
    const short = (day) => `${+day.slice(8)}/${+day.slice(5, 7)}`;
    const selected = days.find((d) => d.day === view.chosenDay) || [...days].reverse().find((d) => d.total > 0) || days[days.length - 1];
    // Apps open less than a minute that day (system screens like a "share" chooser) aren't listed.
    const appsOfDay = Object.entries(selected.apps).filter(([, s]) => s >= 60).sort((a, b) => b[1] - a[1]);
    const hiddenApps = Object.values(selected.apps).filter((s) => s > 0 && s < 60).length;

    return [
      ...top,
      chips([[7, "7 ימים"], [30, "30 ימים"]], view.period, (p) => setPage(p, 0)),
      // The dates shown, with earlier and later periods around them. Data is kept for 90 days.
      // Hebrew order: "earlier" on the right, "later" on the left.
      el("div", { class: "row period-nav" },
        el("button", { class: "btn plain small", disabled: (view.pagesBack + 1) * view.period >= 90, onclick: () => setPage(view.period, view.pagesBack + 1) }, "‹ קודם"),
        el("b", { class: "grow period-dates" }, el("bdi", { dir: "ltr" }, `${short(days[0].day)} – ${short(days[days.length - 1].day)}`)),
        el("button", { class: "btn plain small", disabled: view.pagesBack === 0, onclick: () => setPage(view.period, view.pagesBack - 1) }, "הבא ›")),
      el("p", { class: "small muted period-sum" },
        `סה״כ ${formatDuration(total)}` + (usedDays > 0 ? ` · ממוצע ${formatDuration(Math.floor(total / usedDays))} ביום` : "")),
      usageChart(days, selected.day, view.period, (day) => { view.chosenDay = day; reload() }),
      el("div", { class: "row" },
        el("b", { class: "grow day-title" }, formatDate(selected.day)),
        el("b", { class: "primary-text" }, formatDuration(selected.total))),
      appsOfDay.length === 0 && el("p", { class: "muted" }, "אין זמן מסך ביום הזה."),
      appsOfDay.map(([pkg, seconds]) => appUsageRow(labels[pkg] || pkg, icons[pkg], seconds, appsOfDay[0][1])),
      hiddenApps > 0 && el("p", { class: "small muted" },
        hiddenApps === 1 ? "ועוד אפליקציה אחת שהייתה פתוחה פחות מדקה" : `ועוד ${hiddenApps} אפליקציות שהיו פתוחות פחות מדקה`),
      el("p", { class: "small muted" }, `נמדד בטלפון של ${child.name} כשהמסך דלוק, בלי מסך הבית ובלי האפליקציה הזו. מתעדכן בכל סנכרון.`),
    ];
  });
}

/**
 * A bar per day, oldest on the right and newest on the left, like the Hebrew week (Sunday on the right).
 * Bars and labels are both right-to-left rows, so they line up. Tap a bar to see that day.
 * Every day has a light track, so days without use still show. The scale is at least 30 minutes.
 */
function usageChart(days, selected, period, onSelect) {
  const max = Math.max(30 * 60, ...days.map((d) => d.total));
  // 30 days: every 5th date counting back from the last day, plus the chosen day.
  const chosen = days.findIndex((d) => d.day === selected);
  let dated = new Set(days.map((_, i) => i).filter((i) => (days.length - 1 - i) % 5 === 0));
  if (chosen >= 0 && !dated.has(chosen)) {
    dated = new Set([...dated].filter((i) => Math.abs(i - chosen) > 2));
    dated.add(chosen);
  }
  return el("section", { class: "card chart" + (period > 7 ? " dense" : "") },
    el("div", { class: "bars", dir: "rtl" }, days.map((d) =>
      el("button", {
        type: "button", class: "bar-slot" + (d.day === selected ? " selected" : ""),
        "aria-label": `${formatDate(d.day)}: ${formatDuration(d.total)}`, onclick: () => onSelect(d.day),
      },
        period <= 7 && d.total >= 60 && el("span", { class: "bar-value" }, Math.floor(d.total / 60)),
        el("span", { class: "bar", style: `height:${(d.total / max) * 85}%` })))),
    el("div", { class: "bar-labels", dir: "rtl" }, days.map((d, i) =>
      el("span", { class: d.day === selected ? "selected" : "" },
        period <= 7 ? HEBREW_DAY_LETTERS[weekday(d.day)] : dated.has(i) ? `${+d.day.slice(8)}/${+d.day.slice(5, 7)}` : ""))));
}

function appUsageRow(name, icon, seconds, maxSeconds) {
  return el("section", { class: "card usage-row" },
    appIcon(icon, 36),
    el("div", { class: "grow" },
      el("div", { class: "row" }, el("span", { class: "grow medium app-name", title: name }, name), el("span", { class: "small nowrap" }, formatDuration(seconds))),
      el("div", { class: "meter" }, el("span", { style: `width:${Math.max(2, Math.min(100, (seconds / maxSeconds) * 100))}%` }))));
}

/** In-app learning by subject, most time first (loadLearning). */
function bySubject(sessions) {
  const groups = new Map();
  for (const s of sessions) {
    const subject = s.subject.replace(/ \(למידה חכמה\)$/, "").trim();
    if (!groups.has(subject)) groups.set(subject, []);
    groups.get(subject).push(s);
  }
  return [...groups].map(([subject, list]) => {
    const exercises = list.reduce((n, s) => n + (s.learning?.exercises || 0), 0);
    const correct = list.reduce((n, s) => n + (s.learning?.correct || 0), 0);
    return {
      subject,
      emoji: subjects().find((x) => x.title === subject)?.emoji || (subject === "תיקון טעויות" ? "🔧" : "🎓"),
      seconds: list.reduce((n, s) => n + Math.max(0, Math.floor((new Date(s.end) - new Date(s.start)) / 1000)), 0),
      sessions: list.length,
      exercises,
      correct,
      percent: exercises === 0 ? 0 : Math.floor((correct * 100) / exercises),
      math: subject.startsWith("חשבון"),
      mistakes: list.flatMap((s) => s.learning?.mistakes || []),
    };
  }).sort((a, b) => b.seconds - a.seconds);
}

/** Green from 80% (the bonus line), orange from 60%, red below. */
const percentColor = (p) => (p >= 80 ? "var(--primary)" : p >= 60 ? "#e08a00" : "#d14343");
const times = (n) => (n === 1 ? "פעם אחת" : `${n} פעמים`);
const questions = (s) => (s.exercises === 1 ? (s.math ? "תרגיל אחד" : "שאלה אחת") : `${s.exercises} ${s.math ? "תרגילים" : "שאלות"}`);

/** A card per subject; tap one to see what was hard. */
function learningSummary(child, subjects) {
  return el("div", { class: "stack learning" },
    subjects.length === 0 && el("p", { class: "muted small" }, `${child.name} לא ${byGender(child, "למד", "למדה")} בלמידה החכמה בתקופה הזו.`),
    subjects.map((s) => el("button", { type: "button", class: "card subject-card", onclick: () => subjectDetails(s, child) },
      el("div", { class: "row" },
        el("b", { class: "grow subject-name" }, `${s.emoji} ${s.subject}`),
        el("b", { style: `color:${percentColor(s.percent)}` }, `${s.percent}% הצלחה`)),
      el("span", { class: "small muted block" }, `${formatDuration(s.seconds)} · ${times(s.sessions)} · ${questions(s)}`),
      el("div", { class: "meter thick" }, el("span", { style: `width:${Math.min(100, s.percent)}%;background:${percentColor(s.percent)}` })),
      el("span", { class: "small primary-text block" }, s.mistakes.length === 0 ? "אין טעויות 🎉" : "לראות מה היה קשה ›"))));
}

function subjectDetails(s, child) {
  openDialog((close) => ({
    title: `${s.emoji} ${s.subject}: מה היה קשה`,
    body: [
      el("p", { class: "small" }, `${questions(s)} · ${s.correct} ${s.math ? "נכונים" : "נכונות"} (${s.percent}%)`),
      s.mistakes.length === 0 && el("b", {}, "אין טעויות 🎉"),
      s.mistakes.slice(0, 15).map((m) => mistakeLine(m, s.math, child)),
      s.mistakes.length > 15 && el("p", { class: "muted small" }, `ועוד ${s.mistakes.length - 15} טעויות.`),
    ],
    buttons: el("button", { class: "btn plain", onclick: close }, "סגירה"),
  }));
}
