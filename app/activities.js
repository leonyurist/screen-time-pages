// "משימות": what earns screen time for each child, and how many screen minutes per minute.
// Changes are saved right away. Ported from ActivitiesScreen.kt.

import * as api from "./api.js";
import { el, runAction, openDialog, confirmDialog, chips, toggle, field, loadInto, screenTitle } from "./ui.js";
import { loadChildRefs, pick, childPicker, noChildrenYet } from "./shared.js";

/** Quick choices for "screen minutes per activity minute". */
export const RATIO_OPTIONS = [
  [0.5, "חצי דקה"], [1, "דקה"], [1.5, "דקה וחצי"], [2, "2 דקות"], [3, "3 דקות"], [4, "4 דקות"], [5, "5 דקות"],
];

export const ratioLabel = (ratio) => RATIO_OPTIONS.find(([v]) => v === ratio)?.[1] ?? `${ratio} דקות`;

/** Icons a parent can pick for a new activity. */
const ACTIVITY_EMOJIS = [
  "⭐", "📚", "🔢", "📝", "🔤", "📖", "🔬", "🌍", "🎨", "🎵", "🎹", "⚽", "🏀", "🚴", "🏊", "🤸",
  "🧹", "🛏️", "🍽️", "🐶", "🌱", "🧱", "♟️", "🧩", "💻", "🙏", "✨",
];

export function activitiesScreen(container, app) {
  const reload = () => activitiesScreen(container, app);

  return loadInto(container, async () => {
    const children = await loadChildRefs();
    const child = pick(children, app.childId);
    const activities = !child ? [] : await api.select(
      `activities?select=id,name,emoji,ratio,enabled&child_id=eq.${child.id}&order=sort,created_at`);
    return { children, child, activities };
  }, ({ children, child, activities }) => {
    const update = (a, values) => runAction(() => api.update("activities", `id=eq.${a.id}`, values), null, reload);
    return [
      screenTitle("משימות", "על אילו משימות מקבלים זמן מסך, וכמה דקות מסך על כל דקה. שינויים נשמרים מיד."),
      childPicker(children, child, (id) => { app.childId = id; reload() }),
      !child && noChildrenYet(),
      activities.map((a) => activityRow(a,
        (enabled) => update(a, { enabled }),
        (ratio) => update(a, { ratio }),
        () => confirmDialog(`למחוק את "${a.name}"?`, "המשימה תיעלם מהטלפון של הילד. משימות שכבר נעשו יישארו בהיסטוריה.", "מחיקה",
          () => runAction(() => api.remove("activities", `id=eq.${a.id}`), "נמחקה", reload)))),
      child && el("button", {
        class: "fab", onclick: () => addActivityDialog((name, emoji, ratio) =>
          runAction(() => api.insert("activities", { child_id: child.id, name, emoji, ratio, sort: activities.length + 1 }), `"${name}" נוספה`, reload)),
      }, "➕ משימה חדשה"),
    ];
  });
}

/** An activity that's off looks greyed out and says so, so it's clear it doesn't show on the child's phone. */
function activityRow(a, onToggle, onRatio, onDelete) {
  return el("section", { class: "card activity" + (a.enabled ? "" : " off") },
    toggle(a.enabled, onToggle, a.name),
    el("span", { class: "activity-emoji" }, a.emoji),
    el("div", { class: "grow" },
      el("b", { class: "block" }, a.name),
      a.enabled ? ratioPicker(a.ratio, onRatio) : el("span", { class: "small muted" }, "כבויה · לא מופיעה בטלפון של הילד")),
    el("button", { class: "btn plain", "aria-label": `מחיקת ${a.name}`, onclick: onDelete }, "🗑"));
}

/** "כל דקה = דקה מסך ▾" that opens the quick choices. */
function ratioPicker(ratio, onPick) {
  const known = RATIO_OPTIONS.some(([v]) => v === ratio);
  return el("label", { class: "ratio-picker" },
    el("span", {}, `כל דקה = ${ratioLabel(ratio)} מסך ▾`),
    el("select", { "aria-label": "כמה דקות מסך על כל דקה", onchange: (e) => onPick(Number(e.target.value)) },
      !known && el("option", { value: ratio, selected: true }, ratioLabel(ratio)),
      RATIO_OPTIONS.map(([v, label]) => el("option", { value: v, selected: v === ratio }, v === ratio ? `✓ ${label}` : label))));
}

function addActivityDialog(onAdd) {
  let emoji = "⭐";
  let ratio = 1;
  const name = el("input", { type: "text", maxlength: 30 });
  const add = el("button", { class: "btn plain", disabled: true }, "הוספה");
  name.oninput = () => { add.disabled = !name.value.trim() };
  const emojis = el("div", { class: "emoji-grid" });
  const drawEmojis = () => emojis.replaceChildren(...ACTIVITY_EMOJIS.map((e) =>
    el("button", { type: "button", class: "emoji-choice", "aria-pressed": String(e === emoji), onclick: () => { emoji = e; drawEmojis() } }, e)));
  drawEmojis();
  openDialog((close) => {
    add.onclick = () => { close(); onAdd(name.value.trim(), emoji, ratio) };
    return {
      title: "משימה חדשה",
      body: [
        field("שם, למשל: שטיפת כלים", name),
        el("b", {}, "סמל"),
        emojis,
        el("b", {}, "כל דקה של המשימה שווה"),
        chips(RATIO_OPTIONS, ratio, (v) => { ratio = v }),
      ],
      buttons: [el("button", { class: "btn plain", onclick: close }, "ביטול"), add],
    };
  });
  name.focus();
}
