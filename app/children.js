// "הילדים שלי": a card per child with balance, phone mode (normal / locked / free), minutes,
// "where is the phone?", and the child's settings. Ported from ChildrenScreen.kt.

import * as api from "./api.js";
import {
  el, nodes, toast, runAction, openDialog, confirmDialog, chips, digitsInput, field, loadInto, screenTitle,
  formatTime, formatDateTime, nextIsraelHour,
} from "./ui.js";
import { DEFAULT_AVATAR } from "./shared.js";
import { locationDialog } from "./location.js";
import { mistakesScreen, mistakesSummary, mistakesWord } from "./mistakes.js";

/** Children whose card is open (cards start closed, and stay open while the site is open). */
const openCards = new Set();

/** The children, each with its mistakes summary (or null if it didn't load). */
async function loadChildrenWithMistakes() {
  const children = await loadChildren();
  await Promise.all(children.map(async (c) => { c.mistakes = await mistakesSummary(c.id).catch(() => null) }));
  return children;
}

async function loadChildren() {
  const rows = await api.select(
    "children?select=id,name,gender,birth_year,avatar,pin_hash," +
    "devices(pairing_code,paired_at,last_seen,service_enabled,admin_active),ledger(minutes),rules(lock_mode,lock_until)" +
    "&order=created_at");
  const now = Date.now();
  return rows.map((c) => {
    const rules = Array.isArray(c.rules) ? c.rules[0] : c.rules;
    const lockUntil = rules?.lock_until ? new Date(rules.lock_until) : null;
    const expired = lockUntil && lockUntil.getTime() < now;
    return {
      id: c.id,
      name: c.name,
      gender: c.gender,
      birthYear: c.birth_year,
      avatar: c.avatar || DEFAULT_AVATAR,
      pinSet: c.pin_hash != null,
      balance: Math.trunc(c.ledger.reduce((sum, l) => sum + Number(l.minutes), 0)),
      device: c.devices[0] || null,
      lockMode: expired ? "normal" : rules?.lock_mode || "normal",
      lockUntil: expired ? null : lockUntil,
    };
  });
}

/** Problems the parent should know about, in plain Hebrew (childAlerts). */
function childAlerts(child) {
  const d = child.device;
  if (!d?.paired_at) return [];
  const alerts = [];
  if (!child.pinSet) alerts.push("לא הוגדר קוד הורה: הילד יכול לכבות את ההגנות בטלפון.");
  if (d.last_seen) {
    const hours = Math.floor((Date.now() - new Date(d.last_seen).getTime()) / 3_600_000);
    if (hours >= 24) alerts.push(`הטלפון לא דיווח כבר ${hours} שעות. ייתכן שהוא כבוי, בלי אינטרנט, או שהאפליקציה הוסרה.`);
  }
  if (d.service_enabled === false) alerts.push("שומר הזמן כבוי בטלפון: יוטיוב ומשחקים לא נחסמים.");
  if (d.admin_active === false) alerts.push("ההגנה מהסרה כבויה: מפעילים אותה ב\"הגדרות הורה\" בטלפון של הילד.");
  return alerts;
}

/** "בת 9" / "בן 10", from the birth year (approximate: doesn't know the birthday). */
function ageLabel(child) {
  if (!child.birthYear) return null;
  const age = new Date().getFullYear() - child.birthYear;
  return child.gender === "girl" ? `בת ${age}` : child.gender === "boy" ? `בן ${age}` : `גיל ${age}`;
}

/** [cached]: the children already loaded, to redraw without the server (opening a card). */
export function childrenScreen(container, app, cached) {
  const reload = () => childrenScreen(container, app);
  let current = cached;

  function setLock(child, mode, until) {
    const done = mode === "locked" ? `הטלפון של ${child.name} ננעל 🔒`
      : mode === "free" ? `הטלפון של ${child.name} משוחרר 🔓`
      : `הטלפון של ${child.name} חזר למצב רגיל`;
    runAction(() => api.update("rules", `child_id=eq.${child.id}`, { lock_mode: mode, lock_until: until ? until.toISOString() : null }), done, reload);
  }

  const actions = {
    onLock: (child, mode) => (mode === "normal" ? setLock(child, mode, null) : lockDialog(child, mode, (until) => setLock(child, mode, until))),
    onMinutes: (child) => minutesDialog(child, reload),
    onLocate: (child) => locationDialog(child),
    onEdit: (child) => childDetailsDialog(`פרטי ${child.name}`, child, (name, gender, year) =>
      runAction(() => api.update("children", `id=eq.${child.id}`, { name, gender, birth_year: year }), "הפרטים נשמרו", reload)),
    onSetPin: (child) => pinDialog(child, reload),
    onNewCode: (child) => confirmDialog(`קוד שיוך חדש ל${child.name}?`, "הטלפון שמחובר עכשיו יתנתק, ויהיה צריך להקליד בו את הקוד החדש.", "קוד חדש",
      () => runAction(() => api.rpc("new_pairing_code", { p_child: child.id }), "נוצר קוד חדש", reload)),
    onDelete: (child) => confirmDialog(`למחוק את ${child.name}?`, `כל הנתונים של ${child.name} יימחקו: יתרה, היסטוריה, משימות והגדרות. אי אפשר לבטל.`, "מחיקה",
      () => runAction(() => api.remove("children", `id=eq.${child.id}`), `${child.name} נמחק/ה`, reload)),
    onMistakes: (child) => mistakesScreen(child, reload),
    onToggle: (child) => { openCards.has(child.id) ? openCards.delete(child.id) : openCards.add(child.id); childrenScreen(container, app, current) },
  };

  const addButton = el("button", {
    class: "fab", onclick: () => childDetailsDialog("הוספת ילד", null, (name, gender, year) =>
      runAction(() => api.rpc("add_child", { p_name: name, p_gender: gender, p_birth_year: year }),
        `${name} נוסף/ה. מקלידים את קוד השיוך בטלפון שלו/ה.`, reload)),
  }, "➕ הוספת ילד");

  const draw = (children) => { current = children; return [
    app.installHint(),
    screenTitle("הילדים שלי"),
    children.length === 0 && el("div", { class: "stack" },
      el("p", { class: "muted" }, "עוד לא הוספת ילדים. לוחצים על \"הוספת ילד\" למטה."),
      el("p", { class: "muted" }, "הורה אחר כבר רשם את הילדים? מבקשים ממנו קוד הזמנה:"),
      el("button", { class: "btn outline", onclick: app.openFamily }, "🔑 הצטרפות למשפחה")),
    children.map((c) => childCard(c, openCards.has(c.id), actions)),
    addButton,
  ] };
  if (cached) return container.replaceChildren(...nodes(draw(cached)));
  return loadInto(container, loadChildrenWithMistakes, draw);
}

/**
 * One child: name and balance on top; what parents do every day (phone mode, minutes, where is the
 * phone) in the middle; rare actions (edit, PIN, pairing code, delete) behind "⚙️ הגדרות".
 * Every card starts as one line and opens on tap.
 */
function childCard(child, expanded, a) {
  const device = child.device;
  const paired = !!device?.paired_at;
  const alerts = childAlerts(child);
  const collapsedLine = alerts.length ? "⚠️ צריך לבדוק"
    : !paired ? "הטלפון עוד לא מחובר"
    : child.lockMode === "locked" ? "🔒 נעול"
    : child.lockMode === "free" ? "🔓 חופשי"
    : "📱 רגיל";

  const head = el("button", { type: "button", class: "child-head", "aria-expanded": String(expanded), onclick: () => a.onToggle(child) },
    el("span", { class: "avatar", "aria-hidden": "true" }, child.avatar),
    el("span", { class: "grow" },
      el("span", { class: "child-name" }, child.name),
      expanded
        ? (ageLabel(child) && el("span", { class: "muted small block" }, ageLabel(child)))
        : el("span", { class: alerts.length ? "small block danger-text" : "small block muted" }, collapsedLine)),
    el("span", { class: "balance" }, el("b", { class: "ltr" }, child.balance), el("span", {}, "דק׳ ביתרה")),
    el("span", { class: "arrow" + (expanded ? " up" : ""), "aria-hidden": "true" }));

  const strip = mistakesStrip(child, a);
  if (!expanded) return el("section", { class: "card child-card" }, head, strip);

  return el("section", { class: "card child-card" },
    head,
    strip,
    alerts.length > 0 && el("div", { class: "alert-box" }, alerts.map((t) => el("p", {}, "⚠️ " + t))),
    (!child.gender || !child.birthYear) && el("div", { class: "note-row" },
      el("span", { class: "grow small" }, "חסרים פרטים: בן/בת ושנת לידה"),
      el("button", { class: "btn plain small", onclick: () => a.onEdit(child) }, "השלמת פרטים")),
    device && !paired && el("div", { class: "pair-box" },
      el("p", { class: "small muted" }, `כדי לחבר את הטלפון של ${child.name}: מתקינים שם את ScreenDeal, בוחרים "ילד" ומקלידים את הקוד`),
      el("div", { class: "pair-code ltr" }, device.pairing_code)),
    paired && el("p", { class: "status" }, "✅ הטלפון מחובר · עודכן לאחרונה: ", el("bdi", {}, formatDateTime(device.last_seen))),
    paired && phoneModeBox(child, (mode) => a.onLock(child, mode)),
    // The two everyday actions, side by side and alike.
    el("div", { class: "tiles" },
      actionTile("🎁", "להוסיף דקות", "או להוריד", () => a.onMinutes(child)),
      paired && actionTile("📍", "איפה הטלפון?", "במפה", () => a.onLocate(child))),
    // The actions parents rarely need, behind one clearly labeled button.
    el("button", { class: "btn outline block", onclick: () => childSettingsDialog(child, paired, a) }, `⚙️ הגדרות של ${child.name}`),
  );
}

/**
 * Mistakes in smart learning not gone over yet, or "finished correcting alone" (minutes to give).
 * Shown on the closed card too, so the parent sees it at once.
 */
function mistakesStrip(child, a) {
  const s = child.mistakes;
  const done = s?.correction?.done;
  const solo = s?.correction?.open;
  if (!s || (s.open === 0 && !done)) return null;
  const girl = child.gender === "girl";
  const [title, sub] = done
    ? [`${child.name} ${girl ? "סיימה" : "סיים"} לתקן טעויות`, `${done.fixed} מתוך ${done.total} תוקנו · לתת זמן מסך?`]
    : [`${mistakesWord(s.open)} בלמידה`, solo
      ? `🔧 ${girl ? "מתקנת" : "מתקן"} לבד: ${solo.answered} מתוך ${solo.total}`
      : s.open === 1 ? "שעוד לא עברתם עליה ביחד" : "שעוד לא עברתם עליהן ביחד"];
  return el("button", { type: "button", class: "mistakes-strip", onclick: () => a.onMistakes(child) },
    el("span", { class: "strip-icon" }, done ? "🎉" : "📝"),
    el("span", { class: "grow" }, el("b", { class: "block" }, title), el("span", { class: "small muted" }, sub)),
    el("b", { class: "small primary-text nowrap" }, done ? "לראות ›" : s.open === 1 ? "לעבור עליה ›" : "לעבור עליהן ›"));
}

/** A big, clear button with an icon and two lines of text. */
const actionTile = (icon, title, subtitle, onclick) =>
  el("button", { type: "button", class: "tile", onclick },
    el("span", { class: "tile-icon" }, icon), el("b", {}, title), el("span", { class: "small muted" }, subtitle));

/** "Phone mode": normal / locked / free as one choice, with a line that says what the current mode means. */
function phoneModeBox(child, onLock) {
  const until = child.lockUntil ? `עד ${formatTime(child.lockUntil)}` : "עד שתחזירו למצב רגיל";
  const explain = {
    locked: `כל האפליקציות חסומות, חוץ מטלפון ו"תמיד מותרות" · ${until}`,
    free: `אפשר להשתמש בהכול, והדקות לא יורדות · ${until}`,
  }[child.lockMode] || "לפי היתרה וההגדרות";
  const modes = [["normal", "רגיל"], ["locked", "🔒 נעול"], ["free", "🔓 חופשי"]];
  return el("div", { class: `mode-box ${child.lockMode}` },
    el("b", { class: "small" }, "מצב הטלפון"),
    el("div", { class: "segmented" }, modes.map(([mode, label]) =>
      el("button", { type: "button", "aria-pressed": String(child.lockMode === mode), onclick: () => { if (child.lockMode !== mode) onLock(mode) } }, label))),
    el("p", { class: "small" }, explain));
}

/** The rare actions for one child, each with a line that says what it does. */
function childSettingsDialog(child, paired, a) {
  openDialog((close) => {
    const option = (icon, title, subtitle, onclick, danger) =>
      el("button", { type: "button", class: "option" + (danger ? " danger" : ""), onclick: () => { close(); onclick() } },
        el("span", { class: "option-icon" }, icon),
        el("span", { class: "grow" }, el("b", {}, title), el("span", { class: "small muted block" }, subtitle)));
    return {
      title: `הגדרות של ${child.name}`,
      body: [
        option("✏️", "עריכת פרטים", "שם, בן/בת ושנת לידה", () => a.onEdit(child)),
        option("🔑", child.pinSet ? "החלפת קוד הורה" : "הגדרת קוד הורה", `הקוד שנכנסים איתו להגדרות בטלפון של ${child.name}`, () => a.onSetPin(child)),
        paired && option("🔄", "חיבור טלפון אחר", "קוד שיוך חדש. הטלפון הנוכחי יתנתק", () => a.onNewCode(child)),
        el("hr"),
        option("🗑", `מחיקת ${child.name}`, "כל הנתונים יימחקו, ואי אפשר לבטל", () => a.onDelete(child), true),
      ],
      buttons: el("button", { class: "btn plain", onclick: close }, "סגירה"),
    };
  });
}

/** How long to lock or free the phone. Calls [onSave] with the end time, or null for "until I cancel". */
function lockDialog(child, mode, onSave) {
  const locking = mode === "locked";
  const morning = nextIsraelHour(7);
  const options = [
    [0, "שעה", () => new Date(Date.now() + 3_600_000)],
    [1, "שעתיים", () => new Date(Date.now() + 7_200_000)],
    [2, `עד ${formatTime(morning)} בבוקר`, () => morning],
    [3, "עד שאבטל", () => null],
  ];
  let choice = 0;
  openDialog((close) => ({
    title: locking ? `לנעול את הטלפון של ${child.name}` : `לשחרר את הטלפון של ${child.name}`,
    body: [
      el("p", { class: "small muted" }, locking
        ? "כל האפליקציות ייחסמו, חוץ מטלפון, חירום ואפליקציות \"תמיד מותרות\". גם אם יש דקות ביתרה."
        : "אפשר להשתמש בכל האפליקציות, והדקות ביתרה לא יורדות."),
      el("b", {}, "לכמה זמן?"),
      chips(options.map(([i, label]) => [i, label]), choice, (i) => { choice = i }),
    ],
    buttons: [
      el("button", { class: "btn plain", onclick: close }, "ביטול"),
      el("button", { class: "btn plain", onclick: () => { close(); onSave(options[choice][2]()) } }, locking ? "🔒 לנעול" : "🔓 לשחרר"),
    ],
  }));
}

/**
 * Give screen minutes (or take some away). They go into the balance and the child uses them
 * whenever they like; they don't count toward the daily cap.
 */
function minutesDialog(child, reload) {
  let remove = false;
  let text = "";
  const value = () => { const n = Number(text); return text && n >= 1 && n <= 1440 ? n : null };
  const save = el("button", { class: "btn plain", disabled: true }, "הוספה");
  const error = el("small", { class: "hint error-text" });
  const giftNote = el("p", { class: "small muted" }, "הדקות נכנסות ליתרה, ואפשר להשתמש בהן מתי שרוצים. הן לא נספרות בתקרה היומית.");
  const note = el("input", { type: "text", maxlength: 60 });
  const noteLabel = el("span", {}, "לכבוד מה? (לא חובה)");
  let quick;
  const input = digitsInput("", 4, (v) => { text = v; update() }, { placeholder: "כמה דקות" });
  function update() {
    const ok = value() != null;
    save.disabled = !ok;
    error.textContent = text && !ok ? "מ-1 עד 1440" : "";
    quick.select(value());
    save.textContent = remove ? "הורדה" : "הוספה";
    noteLabel.textContent = remove ? "סיבה (לא חובה)" : "לכבוד מה? (לא חובה)";
    giftNote.hidden = remove;
  }
  quick = chips([10, 15, 30, 60].map((m) => [m, String(m)]), null, (m) => { text = String(m); input.value = text; update() });
  openDialog((close) => {
    save.onclick = async () => {
      close();
      const minutes = remove ? -value() : value();
      try {
        const given = (await api.rpc("parent_add_minutes", { p_child: child.id, p_minutes: minutes, p_note: note.value.trim() || null })) ?? minutes;
        toast(given > 0 ? `נוספו ${given} דקות ל${child.name} 🎁` : given < 0 ? `הורדו ${-given} דקות מ${child.name}` : `ל${child.name} אין דקות ביתרה להוריד`);
        reload();
      } catch (e) {
        toast(e.message || "שגיאה");
      }
    };
    return {
      title: `דקות מסך ל${child.name}`,
      body: [
        el("p", { class: "muted" }, `ביתרה עכשיו: ${child.balance} דק׳`),
        chips([[false, "➕ הוספה"], [true, "➖ הורדה"]], false, (r) => { remove = r; update() }),
        quick,
        el("label", { class: "field" }, el("span", {}, "כמה דקות (דק׳)"), input, error),
        el("label", { class: "field" }, noteLabel, note),
        giftNote,
      ],
      buttons: [el("button", { class: "btn plain", onclick: close }, "ביטול"), save],
    };
  });
}

/** Name, boy/girl and birth year; all three are required. Used for adding and for editing a child. */
function childDetailsDialog(title, initial, onSave) {
  const thisYear = new Date().getFullYear();
  let gender = initial?.gender || null;
  let year = initial?.birthYear ? String(initial.birthYear) : "";
  const name = el("input", { type: "text", maxlength: 40, value: initial?.name || "" });
  const yearValue = () => { const y = Number(year); return year.length === 4 && y >= thisYear - 25 && y <= thisYear ? y : null };
  const hint = el("small", { class: "hint" });
  const save = el("button", { class: "btn plain" }, "שמירה");
  function update() {
    save.disabled = !(name.value.trim() && gender && yearValue());
    hint.textContent = yearValue() ? `גיל ${thisYear - yearValue()}` : year.length === 4 ? "שנה לא סבירה" : "";
    hint.className = "hint" + (year.length === 4 && !yearValue() ? " error-text" : "");
  }
  name.oninput = update;
  const yearInput = digitsInput(year, 4, (v) => { year = v; update() });
  update();
  openDialog((close) => {
    save.onclick = () => { close(); onSave(name.value.trim(), gender, yearValue()) };
    return {
      title,
      body: [
        field("שם", name),
        chips([["boy", "👦 בן"], ["girl", "👧 בת"]], gender, (g) => { gender = g; update() }),
        el("label", { class: "field" }, el("span", {}, `שנת לידה, למשל ${thisYear - 9}`), yearInput, hint),
      ],
      buttons: [el("button", { class: "btn plain", onclick: close }, "ביטול"), save],
    };
  });
  if (!initial) name.focus();
}

function pinDialog(child, reload) {
  const save = el("button", { class: "btn plain", disabled: true }, "שמירה");
  const pin = el("input", {
    type: "password", inputmode: "numeric", autocomplete: "off", dir: "ltr",
    oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); save.disabled = e.target.value.length < 4 },
  });
  openDialog((close) => {
    save.onclick = () => {
      close();
      runAction(() => api.rpc("set_child_pin", { p_child: child.id, p_pin: pin.value }), "קוד ההורה נשמר", reload);
    };
    return {
      title: `קוד הורה ל${child.name}`,
      body: [el("p", { class: "muted small" }, "בעזרת הקוד הזה נכנסים להגדרות בטלפון של הילד. 4 עד 6 ספרות."), field("קוד", pin)],
      buttons: [el("button", { class: "btn plain", onclick: close }, "ביטול"), save],
    };
  });
  pin.focus();
}
