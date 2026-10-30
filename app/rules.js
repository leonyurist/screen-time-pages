// "הגדרות": parent approval, daily cap, lock hours for each day, and each app's type and daily limit.
// Changes are saved right away and reach the child's phone within seconds. Ported from RulesScreen.kt.

import * as api from "./api.js";
import { el, runAction, openDialog, chips, toggle, digitsInput, field, loadInto, screenTitle, formatDuration } from "./ui.js";
import { loadChildRefs, pick, childPicker, noChildrenYet, appIcon } from "./shared.js";

/** Well-known apps, so parents pick by name instead of package name. Some apps have several packages. */
const APP_GROUPS = [
  ["וידאו ורשתות", [
    ["YouTube", "com.google.android.youtube"],
    ["YouTube Kids", "com.google.android.apps.youtube.kids"],
    ["TikTok", "com.zhiliaoapp.musically", "com.ss.android.ugc.trill"],
    ["Instagram", "com.instagram.android"],
    ["Snapchat", "com.snapchat.android"],
    ["Facebook", "com.facebook.katana"],
    ["Netflix", "com.netflix.mediaclient"],
    ["Twitch", "tv.twitch.android.app"],
    ["Discord", "com.discord"],
    ["Pinterest", "com.pinterest"],
  ]],
  ["משחקים", [
    ["Roblox", "com.roblox.client"],
    ["Minecraft", "com.mojang.minecraftpe"],
    ["Brawl Stars", "com.supercell.brawlstars"],
    ["Clash Royale", "com.supercell.clashroyale"],
    ["Clash of Clans", "com.supercell.clashofclans"],
    ["Subway Surfers", "com.kiloo.subwaysurf"],
    ["Stumble Guys", "com.kitkagames.fallbuddies"],
    ["Among Us", "com.innersloth.spacemafia"],
    ["Free Fire", "com.dts.freefireth"],
    ["PUBG Mobile", "com.tencent.ig"],
    ["Candy Crush", "com.king.candycrushsaga"],
  ]],
  ["תקשורת, ניווט ולימודים", [
    ["WhatsApp", "com.whatsapp"],
    ["הודעות (Google)", "com.google.android.apps.messaging"],
    ["הודעות (Samsung)", "com.samsung.android.messaging"],
    ["Google Maps", "com.google.android.apps.maps"],
    ["Waze", "com.waze"],
    ["Moovit", "com.tranzmate"],
    ["Google Classroom", "com.google.android.apps.classroom"],
    ["Spotify", "com.spotify.music"],
  ]],
];
const CATALOG = APP_GROUPS.flatMap(([, apps]) => apps).map(([name, ...packages]) => ({ name, packages }));
const CATALOG_NAMES = Object.fromEntries(CATALOG.flatMap((a) => a.packages.map((p) => [p, a.name])));

/** Phone settings and installers stay open whatever the parent chose (AppType.SYSTEM_OPEN). */
const SYSTEM_OPEN = new Set([
  "com.android.settings", "com.google.android.permissioncontroller", "com.google.android.packageinstaller", "com.android.packageinstaller",
]);

/** What each app type means, in words parents understand (AppType in the Android app). */
const TYPES = ["count", "free", "always", "always_count", "blocked", "pending"];
const TYPE_INFO = {
  count: { icon: "⏳", title: "לפי זמן מסך", explain: "משתמשים בדקות מהיתרה, והאפליקציה נסגרת כשהן נגמרות" },
  free: { icon: "🎈", title: "חופשי", explain: "לא מוריד דקות. נסגרת רק בזמן פעילות ובשעות נעילה" },
  always: { icon: "✅", title: "תמיד פתוח", explain: "לא נסגרת אף פעם, גם כשהטלפון נעול. למשל וואטסאפ להורים" },
  always_count: { icon: "✅", title: "תמיד פתוח · סופר זמן", explain: "לא נסגרת אף פעם, אבל מורידה דקות מהיתרה כל עוד יש" },
  blocked: { icon: "⛔", title: "חסום", explain: "לא נפתחת אף פעם, גם כשיש דקות ביתרה וגם כשהטלפון חופשי" },
  pending: { icon: "📲", title: "מחכה לאישור", explain: "אפליקציה חדשה שהילד התקין. חסומה עד שתאשרו או תחסמו" },
};
/** "Always open" in both its forms: never closes. */
const alwaysOpen = (t) => t === "always" || t === "always_count";
/** The two "always open" choices, shown under it once it's picked (ALWAYS_CHOICES in the Android app). */
const ALWAYS_CHOICES = [
  ["always", "לא מוריד זמן מסך", "השימוש בה לא נספר. מתאים לאפליקציות שהילד צריך, כמו טלפון להורים או מפות."],
  ["always_count", "מוריד זמן מסך", "כל עוד יש יתרה, הזמן בה נספר כמו בכל אפליקציה. כשהיתרה נגמרת היא נשארת פתוחה, והדקות מפסיקות לרדת. מתאים לוואטסאפ: תמיד אפשר לדבר, אבל הזמן נספר."],
];

/** Sunday first, like the Israeli week. Keys as on the server: 0 = Sunday ... 6 = Saturday. */
const WEEK = [["0", "ראשון"], ["1", "שני"], ["2", "שלישי"], ["3", "רביעי"], ["4", "חמישי"], ["5", "שישי"], ["6", "שבת"]];

/** Lock hours from the server, without broken or empty days (LockSchedule.parse). */
function parseSchedule(obj) {
  const out = {};
  for (const [key] of WEEK) {
    const w = obj?.[key];
    const from = normTime(w?.from), to = normTime(w?.to);
    if (from && to && from !== to) out[key] = { from, to };
  }
  return out;
}
function normTime(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(s || "");
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** Whether the lock-hours editor is open (it stays open while the parent changes days). */
let lockHoursOpen = false;
let query = "";

export function rulesScreen(container, app) {
  const reload = () => rulesScreen(container, app);

  return loadInto(container, async () => {
    const children = await loadChildRefs();
    const child = pick(children, app.childId);
    if (!child) return { children, child };
    const [r, apps] = await Promise.all([
      api.select(`rules?select=require_approval,daily_cap,auto_approve_up_to,seconds_per_correct,mistakes_reminder,strengthen_ratio,strengthen_reward,daily_goal,goal_notify,surprise_on,surprise_budget,app_types,lock_schedule,app_limits,daily_allowance,reset_daily,daily_max,new_apps&child_id=eq.${child.id}`),
      api.select(`device_apps?select=package,label,icon&child_id=eq.${child.id}`),
    ]);
    const rules = r[0] && {
      requireApproval: r[0].require_approval,
      dailyCap: r[0].daily_cap,
      autoApproveUpTo: r[0].auto_approve_up_to,
      secondsPerCorrect: r[0].seconds_per_correct ?? 5,
      mistakesReminder: r[0].mistakes_reminder ?? true,
      strengthenRatio: Number(r[0].strengthen_ratio ?? 1),
      strengthenReward: r[0].strengthen_reward ?? 0,
      dailyGoal: r[0].daily_goal ?? 10,
      goalNotify: r[0].goal_notify ?? true,
      surpriseOn: r[0].surprise_on ?? true,
      surpriseBudget: r[0].surprise_budget ?? 10,
      types: Object.fromEntries(Object.entries(r[0].app_types || {}).filter(([, t]) => TYPES.includes(t))),
      lockHours: parseSchedule(r[0].lock_schedule),
      appLimits: r[0].app_limits || {},
      dailyAllowance: positive(r[0].daily_allowance),
      resetDaily: !!r[0].reset_daily,
      dailyMax: positive(r[0].daily_max),
      newApps: r[0].new_apps || "allow",
    };
    // Calls, contacts, settings and installers are always open on the phone, so they aren't listed.
    const installed = Object.fromEntries(apps.filter((a) => !SYSTEM_OPEN.has(a.package)).map((a) => [a.package, a.label]));
    const icons = Object.fromEntries(apps.filter((a) => a.icon).map((a) => [a.package, a.icon]));
    return { children, child, rules, installed, icons };
  }, ({ children, child, rules, installed, icons }) => {
    const top = [
      screenTitle("הגדרות", "השינויים נשמרים מיד ומגיעים לטלפון של הילד תוך כמה שניות."),
      childPicker(children, child, (id) => { app.childId = id; query = ""; reload() }),
    ];
    if (!child || !rules) return [...top, noChildrenYet()];

    const save = (values) => runAction(() => api.update("rules", `child_id=eq.${child.id}`, values), null, reload);
    const typeOf = (packages) => packages.map((p) => rules.types[p]).find(Boolean) || "count";
    const limitOf = (packages) => packages.map((p) => rules.appLimits[p]).find((v) => v != null) ?? null;
    const iconOf = (packages) => packages.map((p) => icons[p]).find(Boolean);

    /** Saves an app's type and daily limit together. "By screen time" is the default, so it isn't stored. */
    function setApp(packages, type, limit) {
      const types = { ...rules.types };
      const limits = { ...rules.appLimits };
      for (const p of packages) {
        delete types[p];
        delete limits[p];
        if (type !== "count") types[p] = type;
        if (limit != null && !alwaysOpen(type) && type !== "blocked") limits[p] = limit;
      }
      save({ app_types: types, app_limits: limits });
    }
    const editApp = (row) => appDialog(row.name, iconOf(row.packages), typeOf(row.packages), limitOf(row.packages),
      (type, limit) => setApp(row.packages, type, limit));

    let allRows;
    const installedPkgs = Object.keys(installed);
    if (installedPkgs.length) {
      const nameOf = (p) => CATALOG_NAMES[p] || installed[p] || p;
      const chosen = [...Object.keys(rules.types), ...Object.keys(rules.appLimits)].filter((p) => !(p in installed) && !SYSTEM_OPEN.has(p));
      allRows = [...new Set([...installedPkgs, ...chosen])].map((p) => ({ name: nameOf(p), packages: [p] }));
    } else {
      // Not paired yet: well-known apps, plus anything the parent already chose.
      allRows = [...CATALOG, ...Object.keys(rules.types).filter((p) => !(p in CATALOG_NAMES)).map((p) => ({ name: p, packages: [p] }))];
    }

    // The list is drawn on its own, so typing in the search box doesn't redraw the box.
    const list = el("div", { class: "stack" });
    function drawList() {
      const q = query.trim().toLowerCase();
      const shown = allRows.filter((r) => !q || r.name.toLowerCase().includes(q));
      // The short groups first, so "blocked", "always open" and "free" aren't buried under a long list.
      const groups = ["pending", "blocked", "always", "always_count", "free", "count"].map((type) => {
        const inGroup = shown.filter((r) => typeOf(r.packages) === type).sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
        if (!inGroup.length) return null;
        const info = TYPE_INFO[type];
        return [
          el("b", { class: "muted group-title" }, `${info.icon} ${info.title} · ${inGroup.length}`),
          inGroup.map((row) => appLine(row.name, iconOf(row.packages), type, limitOf(row.packages), () => editApp(row))),
        ];
      });
      list.replaceChildren(...groups.flat(Infinity).filter(Boolean),
        ...(shown.length === 0 && q ? [el("p", { class: "muted" }, `לא נמצאה אפליקציה בשם "${query}".`)] : []));
    }
    drawList();

    return [
      ...top,
      el("h2", { class: "section-title" }, "⏳ צבירת זמן מסך"),
      el("section", { class: "card" },
        settingRow("✋", "אישור הורה למשימות",
          rules.requireApproval ? "כל משימה שהילד מדווח מחכה לאישור שלך במסך \"אישורים\"" : "כבוי: הדקות נכנסות ליתרה מיד, בלי אישור",
          toggle(rules.requireApproval, (v) => save({ require_approval: v }), "אישור הורה למשימות")),
        el("p", { class: "small muted" }, "🎓 למידה חכמה לא צריכה אישור: האפליקציה בודקת את התשובות, והדקות נכנסות ליתרה מיד."),
        rules.requireApproval && [
          el("hr"),
          el("b", { class: "block" }, "לאשר לבד משימה קצרה?"),
          el("p", { class: "small muted" }, "משימה קצרה עד הזמן שבוחרים תאושר לבד, בלי לחכות לך. \"לא\": כל משימה מחכה לאישור."),
          chips([[0, "לא"], [10, "עד 10 דק׳"], [15, "עד 15 דק׳"], [20, "עד 20 דק׳"], [30, "עד 30 דק׳"]], rules.autoApproveUpTo,
            (v) => save({ auto_approve_up_to: v })),
        ]),
      el("section", { class: "card" },
        el("b", { class: "block" }, "🎓 למידה חכמה: בונוס על תשובה נכונה"),
        el("p", { class: "small muted" }, "כל תשובה נכונה מוסיפה עוד זמן מסך, מעבר לזמן הלמידה עצמו."),
        chips([[0, "בלי בונוס"], [5, "5 שניות"], [10, "10 שניות"], [15, "15 שניות"], [30, "30 שניות"]], rules.secondsPerCorrect,
          (v) => save({ seconds_per_correct: v }))),
      minutesSection("🎯", "יעד למידה יומי",
        rules.dailyGoal > 0 ? `כל יום ${child.name} רואה כמה נשאר ליעד, וכשמשלימים מקבלים תיבת זהב 🥇 (4 עד 6 דק׳)` : "כבוי: בלי יעד יומי",
        rules.dailyGoal, "דק׳ למידה ביום", [0, 5, 10, 15, 20], 120, (v) => save({ daily_goal: v }), "בלי יעד"),
      rules.dailyGoal > 0 && el("section", { class: "card" },
        settingRow("🔔", "התראה כשהיעד הושלם", rules.goalNotify ? "פעם ביום, כשהיעד הושלם" : "כבוי",
          toggle(rules.goalNotify, (v) => save({ goal_notify: v }), "התראה כשהיעד הושלם"))),
      el("section", { class: "card" },
        settingRow("🎁", "תיבות הפתעה",
          rules.surpriseOn ? "התיבות מופיעות באופן אקראי בזמן למידה, אחרי תשובות נכונות. יותר תשובות נכונות ומקצועות שלא למדו מזמן מגדילים את הסיכוי"
            : "כבוי: בלי תיבות (תיבת הזהב של היעד היומי נשארת)",
          toggle(rules.surpriseOn, (v) => save({ surprise_on: v }), "תיבות הפתעה"))),
      rules.surpriseOn && minutesSection("💰", "הכי הרבה דקות מתיבות ביום",
        `${child.name} לא יודע/ת מה התקרה. כשהיא נגמרת, לעיתים נדירות תגיע עוד תיבה של דקה`,
        rules.surpriseBudget, "דק׳ ביום", [5, 10, 15, 30], 120, (v) => save({ surprise_budget: v })),
      el("section", { class: "card" },
        el("b", { class: "block" }, "💪 בונוס על חיזוק נושאים"),
        el("p", { class: "small muted" }, `כשקשה ל${child.name} בנושא, השאלות בו חוזרות בלמידה בשקט, בלי לומר לילד שהוא חלש. אפשר לעודד בבונוס:`),
        el("b", { class: "block small" }, "דקת למידה בנושאים לחיזוק שווה"),
        chips([[1, "כרגיל"], [1.5, "פי 1.5"], [2, "פי 2"], [3, "פי 3"]], rules.strengthenRatio, (v) => save({ strengthen_ratio: v })),
        el("b", { class: "block small" }, "פרס כשנושא קשה מתחזק"),
        chips([[0, "בלי פרס"], [5, "5 דק׳"], [10, "10 דק׳"], [15, "15 דק׳"], [30, "30 דק׳"]], rules.strengthenReward, (v) => save({ strengthen_reward: v }))),
      el("section", { class: "card" },
        settingRow("📝", "תזכורת לעבור על טעויות",
          rules.mistakesReminder ? "התראה ב-18:00 כשיש טעויות בנות 3 ימים לפחות. לכל היותר פעם בשבוע, ורק כשנוספו טעויות חדשות"
            : "כבוי: לא נשלחות תזכורות. הטעויות עדיין מופיעות בכרטיס של הילד",
          toggle(rules.mistakesReminder, (v) => save({ mistakes_reminder: v }), "תזכורת לעבור על טעויות"))),
      dailyCapSection(rules.dailyCap, (v) => save({ daily_cap: v })),

      el("h2", { class: "section-title" }, "⏰ זמן מסך יומי"),
      weekMinutesCard("🌅", "זמן התחלה לכל יום", `כל בוקר הזמן מתמלא בחזרה. זמן שלא נוצל לא נצבר. דקות ש${child.name} הרוויח/ה נשמרות.`,
        "בלי זמן התחלה: הילד מתחיל כל יום עם מה שנשאר לו", rules.dailyAllowance, (m) => save({ daily_allowance: m })),
      el("section", { class: "card" },
        settingRow("🌙", "דקות שהרוויח נמחקות בסוף היום",
          rules.resetDaily ? "בחצות נמחקות גם הדקות שהילד הרוויח (למידה, משימות ומתנות), ונשאר רק הזמן היומי של היום החדש"
            : "כבוי: דקות שהילד הרוויח עוברות למחר",
          toggle(rules.resetDaily, (v) => save({ reset_daily: v }), "דקות שהרוויח נמחקות בסוף היום"))),
      weekMinutesCard("⏱️", "זמן מסך מקסימלי ביום", "גם אם יש יתרה, אחרי הזמן הזה אפליקציות \"לפי זמן מסך\" נסגרות עד מחר. אפליקציות \"תמיד פתוח\" נשארות פתוחות.",
        "בלי הגבלה: אפשר להשתמש בכל היתרה", rules.dailyMax, (m) => save({ daily_max: m })),

      el("h2", { class: "section-title" }, "🌙 שעות נעילה"),
      lockHoursCard(rules.lockHours, (hours) => save({ lock_schedule: hours }), reload),

      el("h2", { class: "section-title" }, "📲 אפליקציות חדשות"),
      newAppsSection(child, rules, installed, (mode) => save({ new_apps: mode }), (pkg, type) => setApp([pkg], type, null)),

      el("h2", { class: "section-title" }, "📱 אפליקציות"),
      typesLegend(),
      !installedPkgs.length && el("p", { class: "small muted" }, `כשהטלפון של ${child.name} יחובר, תופיע כאן רשימת האפליקציות שמותקנות בו.`),
      allRows.length > 8 && field("🔍 חיפוש אפליקציה", el("input", { type: "search", value: query, oninput: (e) => { query = e.target.value; drawList() } })),
      list,
      el("button", { class: "btn plain muted-text", onclick: () => addPackageDialog((pkg) => editApp({ name: pkg, packages: [pkg] })) }, "אפליקציה שלא ברשימה? (מתקדם)"),
    ];
  });
}

/** A setting with an icon, a title, a line that explains it, and its control on the side. */
const settingRow = (icon, title, subtitle, control) =>
  el("div", { class: "setting-row" },
    el("span", { class: "setting-icon" }, icon),
    el("div", { class: "grow" }, el("b", { class: "block" }, title), el("span", { class: "small muted" }, subtitle)),
    control);

/** What the three app types mean, once, above the list. */
function typesLegend() {
  return el("section", { class: "card" },
    TYPES.filter((t) => t !== "pending").map((t) => el("div", { class: "legend-row" },
      el("span", {}, TYPE_INFO[t].icon),
      el("div", {}, el("b", { class: "block" }, TYPE_INFO[t].title), el("span", { class: "small muted" }, TYPE_INFO[t].explain)))),
    el("hr"),
    el("p", { class: "small muted" }, "אפליקציה שלא בחרת לה סוג נספרת לפי זמן מסך. טלפון, חירום, הגדרות ומסך הבית תמיד פתוחים. לוחצים על אפליקציה כדי לשנות."));
}

/** One app: logo, name, its daily limit if any, and its type. Tapping opens the app's window. */
function appLine(name, icon, type, limit, onclick) {
  const info = TYPE_INFO[type];
  return el("button", { type: "button", class: "app-line", onclick },
    appIcon(icon, 32),
    el("span", { class: "grow app-name" }, name),
    limit != null && el("span", { class: "small primary-text" }, `⏱ ${limit} דק׳ ביום`),
    el("span", { class: "badge grey" }, `${info.icon} ${info.title} ▾`));
}

/** Choose an app's type (with what each one means) and its daily limit, then save both. */
function appDialog(name, icon, currentType, currentLimit, onSave) {
  let type = currentType;
  let limitText = currentLimit != null ? String(currentLimit) : "";
  const limit = () => { const n = Number(limitText); return limitText && n >= 1 && n <= 1440 ? n : null };
  const limitValid = () => !limitText || limit() != null;
  const save = el("button", { class: "btn plain" }, "שמירה");
  const typeRows = el("div", { class: "stack" });
  const limitBox = el("div", { class: "stack" });
  let quick;
  const input = digitsInput(limitText, 4, (v) => { limitText = v; update() });
  function update() {
    save.disabled = !limitValid();
    input.classList.toggle("invalid", !limitValid());
    quick.select(limitText ? limit() : "");
    limitBox.hidden = alwaysOpen(type) || type === "blocked";
    // "Always open" is one choice here; whether it counts time is picked right under it.
    typeRows.replaceChildren(...["count", "free", "always", "blocked"].flatMap((t) => {
      const selected = t === "always" ? alwaysOpen(type) : t === type;
      const row = el("button", {
        type: "button", class: "type-choice", "aria-pressed": String(selected), onclick: () => { if (!selected) { type = t; update() } },
      },
        el("span", { class: "radio", "aria-hidden": "true" }),
        el("span", { class: "grow" }, el("b", { class: "block" }, `${TYPE_INFO[t].icon} ${TYPE_INFO[t].title}`), el("span", { class: "small muted" }, TYPE_INFO[t].explain)));
      if (t !== "always" || !selected) return [row];
      return [row, el("div", { class: "stack always-choices" }, ALWAYS_CHOICES.map(([choice, title, explain]) =>
        el("button", { type: "button", class: "type-choice sub", "aria-pressed": String(type === choice), onclick: () => { type = choice; update() } },
          el("span", { class: "radio", "aria-hidden": "true" }),
          el("span", { class: "grow" }, el("b", { class: "block" }, title), el("span", { class: "small muted" }, explain)))))];
    }));
  }
  quick = chips([["", "בלי הגבלה"], [15, "15"], [30, "30"], [60, "60"]], "", (m) => { limitText = String(m); input.value = limitText; update() });
  limitBox.append(
    el("b", {}, "⏱ הגבלה יומית (לא חובה)"),
    el("p", { class: "small muted" }, `גם אם נשארו דקות ביתרה, ${name} תיסגר עד מחר אחרי:`),
    quick,
    el("label", { class: "field" }, el("span", {}, "או מספר אחר (דק׳ ביום)"), input));
  update();
  openDialog((close) => {
    save.onclick = () => { close(); onSave(type, alwaysOpen(type) || type === "blocked" ? null : limit()) };
    return {
      title: el("span", { class: "row" }, icon ? appIcon(icon, 32) : "", name),
      body: [typeRows, limitBox],
      buttons: [el("button", { class: "btn plain", onclick: close }, "ביטול"), save],
    };
  });
}

function addPackageDialog(onNext) {
  const input = el("input", { type: "text", dir: "ltr", placeholder: "com.example.game", autocapitalize: "off", autocorrect: "off" });
  const next = el("button", { class: "btn plain", disabled: true }, "המשך");
  input.oninput = () => { next.disabled = !/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(input.value.trim()) };
  openDialog((close) => {
    next.onclick = () => { close(); onNext(input.value.trim()) };
    return {
      title: "הוספת אפליקציה",
      body: [el("p", { class: "small muted" }, "\"שם החבילה\" מופיע בכתובת של האפליקציה ב-Google Play, אחרי id="), input],
      buttons: [el("button", { class: "btn plain", onclick: close }, "ביטול"), next],
    };
  });
  input.focus();
}

/** "120 דק׳" as hours too: "שעתיים", "שעה ו-30 דק׳". */
function asHours(minutes) {
  if (minutes < 60) return null;
  const h = Math.floor(minutes / 60);
  const hours = h === 1 ? "שעה" : h === 2 ? "שעתיים" : `${h} שעות`;
  return minutes % 60 === 0 ? hours : `${hours} ו-${minutes % 60} דק׳`;
}

/** Most screen minutes that can be earned in a day (0 to 1440): shown big, changed in a small window. */
/** A setting in minutes: the number, and "שינוי" opens quick choices and a free field (0..[max]). */
function minutesSection(icon, title, subtitle, current, unit, presets, max, onSave, zeroLabel) {
  return el("section", { class: "card" },
    settingRow(icon, title, subtitle,
      el("button", { class: "btn outline small", onclick: () => minutesSettingDialog(`${icon} ${title}`, current, unit, presets, max, onSave, zeroLabel) }, "שינוי")),
    el("div", { class: "cap" },
      current === 0 && zeroLabel ? el("b", { class: "primary-text" }, zeroLabel)
        : [el("b", { class: "cap-number ltr" }, current), el("span", { class: "primary-text" }, " " + unit)]));
}

function minutesSettingDialog(title, current, unit, presets, max, onSave, zeroLabel) {
  let text = String(current);
  const value = () => { const n = Number(text); return text !== "" && n >= 0 && n <= max ? n : null };
  const save = el("button", { class: "btn plain" }, "שמירה");
  const hint = el("small", { class: "hint" });
  let quick;
  const input = digitsInput(text, 3, (v) => { text = v; update() });
  function update() {
    save.disabled = value() == null;
    hint.textContent = value() == null ? `אפשר מ-0 עד ${max}` : "";
    hint.className = "hint" + (value() == null ? " error-text" : "");
    quick.select(value());
  }
  quick = chips(presets.map((m) => [m, m === 0 && zeroLabel ? zeroLabel : String(m)]), null, (m) => { text = String(m); input.value = text; update() });
  update();
  openDialog((close) => {
    save.onclick = () => { close(); onSave(value()) };
    return {
      title,
      body: [quick, el("label", { class: "field" }, el("span", {}, `או מספר אחר (${unit})`), input, hint)],
      buttons: [el("button", { class: "btn plain", onclick: close }, "ביטול"), save],
    };
  });
}

function dailyCapSection(current, onSave) {
  return el("section", { class: "card" },
    settingRow("📈", "תקרת צבירה יומית", "הכי הרבה דקות שאפשר לצבור (להרוויח) ביום מלמידה ומשימות. זה לא מגביל כמה משתמשים",
      el("button", { class: "btn outline small", onclick: () => dailyCapDialog(current, onSave) }, "שינוי")),
    el("div", { class: "cap" },
      el("b", { class: "cap-number ltr" }, current), el("span", { class: "primary-text" }, " דק׳ ביום"),
      asHours(current) && el("span", { class: "small muted" }, `  (${asHours(current)})`)));
}

function dailyCapDialog(current, onSave) {
  let text = String(current);
  const value = () => { const n = Number(text); return text !== "" && n >= 0 && n <= 1440 ? n : null };
  const save = el("button", { class: "btn plain" }, "שמירה");
  const hint = el("small", { class: "hint" });
  let quick;
  const input = digitsInput(text, 4, (v) => { text = v; update() });
  function update() {
    save.disabled = value() == null;
    hint.textContent = value() == null ? "אפשר מ-0 עד 1440 (יום שלם)" : asHours(value()) || "";
    hint.className = "hint" + (value() == null ? " error-text" : "");
    quick.select(value());
  }
  quick = chips([60, 90, 120, 180].map((m) => [m, String(m)]), null, (m) => { text = String(m); input.value = text; update() });
  update();
  openDialog((close) => {
    save.onclick = () => { close(); onSave(value()) };
    return {
      title: "📈 תקרת צבירה יומית",
      body: [
        el("p", { class: "small muted" }, "כמה דקות מסך אפשר לצבור לכל היותר ביום? מתנות דקות ממך לא נספרות בתקרה."),
        quick,
        el("label", { class: "field" }, el("span", {}, "דקות ביום (דק׳)"), input, hint),
      ],
      buttons: [el("button", { class: "btn plain", onclick: close }, "ביטול"), save],
    };
  });
}

/** The lock hours as one summary line; "עריכה" opens the full week. */
function lockHoursCard(hours, onSave, reload) {
  const days = Object.keys(hours);
  const windows = [...new Set(Object.values(hours).map((w) => `${w.from}–${w.to}`))];
  const summary = !days.length ? "אין שעות נעילה"
    : windows.length === 1 ? `${days.length === 7 ? "כל יום" : `${days.length} ימים בשבוע`} · ${ltrTimes(windows[0])}`
    : `${days.length} ימים בשבוע, בשעות שונות`;
  if (!lockHoursOpen) {
    return el("section", { class: "card" },
      el("div", { class: "setting-row" },
        el("div", { class: "grow" }, el("b", { class: "block" }, summary),
          el("span", { class: "small muted" }, "בשעות האלה הטלפון נעול, חוץ מטלפון ו\"תמיד פתוח\".")),
        el("button", { class: "btn plain", onclick: () => { lockHoursOpen = true; reload() } }, days.length ? "עריכה" : "הוספה")));
  }
  return el("div", {},
    lockHoursSection(hours, onSave),
    el("button", { class: "btn plain", onclick: () => { lockHoursOpen = false; reload() } }, "סיום"));
}

/** "21:00–07:00" kept left-to-right inside Hebrew text. */
const ltrTimes = (s) => `⁦${s}⁩`;

/** Lock hours for each day of the week (e.g. Sunday 21:00–06:00). Every change is saved right away. */
function lockHoursSection(hours, onSave) {
  const timeInput = (value, onPicked) => {
    const input = el("input", { type: "time", value, step: 60, class: "time" });
    // Saving redraws the screen, so wait until the time wheel is closed (iPhone) before saving.
    const commit = () => { if (input.value && input.value !== value) onPicked(input.value) };
    input.addEventListener("change", () => { if (document.activeElement !== input) commit() });
    input.addEventListener("blur", commit);
    return input;
  };
  const lastWindow = () => { const w = Object.values(hours); return w[w.length - 1] || { from: "21:00", to: "07:00" } };
  const first = WEEK.map(([k, name]) => hours[k] && { name, w: hours[k] }).find(Boolean);
  const allSame = new Set(Object.values(hours).map((w) => w.from + w.to)).size <= 1;
  return el("section", { class: "card" },
    el("b", { class: "block" }, "🌙 שעות נעילה"),
    el("p", { class: "small muted" }, "בשעות האלה הטלפון נעול: רק טלפון, חירום ואפליקציות \"תמיד מותרות\". שעות שעוברות את חצות נגמרות למחרת בבוקר."),
    WEEK.map(([key, name]) => {
      const w = hours[key];
      return el("div", { class: "day-row" },
        // A new day starts with the hours of the last day that has them, or 21:00–07:00.
        toggle(!!w, (on) => { const next = { ...hours }; if (on) next[key] = lastWindow(); else delete next[key]; onSave(next) }, name),
        el("span", { class: "grow" }, name),
        w ? [
          timeInput(w.from, (from) => onSave({ ...hours, [key]: { ...w, from } })),
          el("span", { class: "muted" }, "עד"),
          timeInput(w.to, (to) => onSave({ ...hours, [key]: { ...w, to } })),
        ] : el("span", { class: "small muted" }, "בלי נעילה"));
    }),
    first && (Object.keys(hours).length < 7 || !allSame) && el("button", {
      class: "btn plain", onclick: () => onSave(Object.fromEntries(WEEK.map(([k]) => [k, first.w]))),
    }, `להעתיק את השעות של יום ${first.name} לכל הימים`));
}

// --- Daily screen time (SPEC.md "שש תוספות", stage ג): a value per day of the week ---

/** {"0": 120, ...} with only the days above 0 ("0" = Sunday). */
function positive(obj) {
  return Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, Number(v)]).filter(([, v]) => v > 0));
}

/** "כל יום: 2 ש׳", or day by day; null when nothing is set. */
function weekSummary(m) {
  const values = WEEK.map(([k]) => m[k] || 0);
  if (values.every((v) => v === 0)) return null;
  if (new Set(values).size === 1) return `כל יום: ${formatDuration(values[0] * 60)}`;
  return WEEK.filter(([k]) => m[k] > 0).map(([k, name]) => `${name}: ${formatDuration(m[k] * 60)}`).join(" · ");
}

/** A setting with a value per day: its explanation, a summary line and "עריכה" (WeekMinutesCard in the app). */
function weekMinutesCard(icon, title, explain, empty, current, onSave) {
  const summary = weekSummary(current);
  return el("section", { class: "card" },
    settingRow(icon, title, explain,
      el("button", { class: "btn outline small", onclick: () => weekMinutesDialog(`${icon} ${title}`, current, onSave) }, "עריכה")),
    el("p", { class: "cap " + (summary ? "primary-text" : "muted") }, el("b", {}, summary || empty)));
}

/** A field per day of the week (minutes; empty or 0 = none), and "the same every day". */
function weekMinutesDialog(title, current, onSave) {
  const texts = Object.fromEntries(WEEK.map(([k]) => [k, current[k] ? String(current[k]) : ""]));
  const valid = (k) => !texts[k] || Number(texts[k]) <= 1440;
  const save = el("button", { class: "btn plain" }, "שמירה");
  const inputs = {};
  const update = () => {
    save.disabled = !WEEK.every(([k]) => valid(k));
    WEEK.forEach(([k]) => inputs[k].classList.toggle("invalid", !valid(k)));
  };
  const rows = WEEK.map(([k, name]) => {
    inputs[k] = digitsInput(texts[k], 4, (v) => { texts[k] = v; update() }, { placeholder: "0", class: "week-minutes" });
    return el("div", { class: "row week-row" }, el("span", { class: "grow medium" }, name), inputs[k], el("span", { class: "small muted" }, "דק׳"));
  });
  const same = el("button", {
    class: "btn plain", onclick: () => { WEEK.forEach(([k]) => { texts[k] = texts["0"]; inputs[k].value = texts["0"] }); update() },
  }, "כמו ראשון בכל הימים");
  update();
  openDialog((close) => {
    save.onclick = () => {
      close();
      onSave(Object.fromEntries(WEEK.map(([k]) => [k, Number(texts[k] || 0)]).filter(([, v]) => v > 0)));
    };
    return {
      title,
      body: [el("p", { class: "small muted" }, "בדקות. ריק או 0 = בלי. למשל 120 = שעתיים."), rows, same],
      buttons: [el("button", { class: "btn plain", onclick: close }, "ביטול"), save],
    };
  });
}

// --- New apps (SPEC.md "שש תוספות", stage ד) ---

const PLAY_STORE = "com.android.vending";

/** Whether a new app needs approval, the Google Play switch, and the apps waiting now (NewAppsSection in the app). */
function newAppsSection(child, rules, installed, onMode, onApp) {
  const waiting = Object.entries(rules.types).filter(([, t]) => t === "pending").map(([p]) => p)
    .sort((a, b) => (installed[a] || a).localeCompare(installed[b] || b));
  const storeBlocked = rules.types[PLAY_STORE] === "blocked";
  return [
    el("section", { class: "card" },
      el("b", { class: "block" }, `מה קורה כש${child.name} מתקין/ה אפליקציה חדשה?`),
      chips([["allow", "מותר להתקין"], ["approve", "צריך אישור הורה"]], rules.newApps, onMode),
      el("p", { class: "small muted" }, rules.newApps === "approve"
        ? "אפליקציה חדשה תותקן, אבל תהיה חסומה עד שתאשרו. תקבלו הודעה, וההחלטה כאן למטה."
        : "אפליקציה חדשה נספרת לפי זמן מסך, כמו כל אפליקציה. אי אפשר למנוע את ההורדה עצמה, אבל עם \"צריך אישור הורה\" היא לא תיפתח בלי אישור."),
      el("hr"),
      settingRow("🛒", "לחסום את חנות Google Play",
        storeBlocked ? "החנות לא נפתחת, אז אי אפשר להוריד אפליקציות. מכבים כשרוצים לתת להוריד משהו" : "החנות פתוחה",
        toggle(storeBlocked, (on) => onApp(PLAY_STORE, on ? "blocked" : "count"), "לחסום את חנות Google Play"))),
    waiting.length > 0 && el("section", { class: "card waiting-apps" },
      el("b", { class: "block" }, `📲 ${waiting.length === 1 ? "אפליקציה אחת מחכה" : `${waiting.length} אפליקציות מחכות`} לאישור שלך`),
      waiting.map((pkg) => el("div", { class: "row" },
        el("span", { class: "grow medium" }, installed[pkg] || pkg),
        el("button", { class: "btn plain small", onclick: () => onApp(pkg, "count") }, "לאשר"),
        el("button", { class: "btn plain small danger", onclick: () => onApp(pkg, "blocked") }, "לחסום"))),
      el("p", { class: "small muted" }, "\"לאשר\": האפליקציה נספרת לפי זמן מסך (אפשר לשנות אחר כך ברשימה). \"לחסום\": היא לא תיפתח.")),
  ];
}
