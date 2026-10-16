// Building blocks shared by all screens: elements, messages, dialogs, chips, switches and dates.
// Text is always set as text (never as HTML), so names typed by the family can't break the page.

/** el("div", {class: "card", onclick: f}, "text", child, [more children]...) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "class") node.className = v;
    else if (k === "value") node.value = v;
    else if (k === "checked") node.checked = !!v;
    else if (k === "disabled") node.disabled = !!v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

let toastTimer;
/** A short message at the bottom (like the Android app's snackbar). */
export function toast(text) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

/**
 * Runs a change on the server; on success shows [success] and calls [then], on failure shows the
 * Hebrew error (like runAction in the Android app).
 */
export async function runAction(action, success, then) {
  try {
    await action();
    if (success) toast(success);
    then?.();
  } catch (e) {
    toast(e.message || "שגיאה");
  }
}

/**
 * A dialog window. [build] gets a close function and returns {title, body, buttons}; it runs once,
 * so fields keep their focus (and the iPhone keyboard stays open). To enable "save" as the parent
 * types, keep the button and set its .disabled. Tapping outside or Escape works like "cancel".
 */
export function openDialog(build, { onClose } = {}) {
  const dialog = el("dialog", { class: "dialog" });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    dialog.close();
    dialog.remove();
    onClose?.();
  };
  const { title, body, buttons } = build(close);
  dialog.append(
    title ? el("h2", { class: "dialog-title" }, title) : "",
    el("div", { class: "dialog-body" }, body),
    buttons ? el("div", { class: "dialog-buttons" }, buttons) : "",
  );
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close() });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close() });
  document.body.append(dialog);
  dialog.showModal();
  return { close, dialog };
}

/** "Are you sure?" with a red confirm button (ConfirmDialog in the Android app). */
export function confirmDialog(title, text, confirm, onConfirm) {
  openDialog((close) => ({
    title,
    body: el("p", {}, text),
    buttons: [
      el("button", { class: "btn plain", onclick: close }, "ביטול"),
      el("button", { class: "btn plain danger", onclick: () => { close(); onConfirm() } }, confirm),
    ],
  }));
}

/**
 * A row of choice chips. [options]: [[value, label], ...]. Tapping one marks it and calls [onPick];
 * row.select(value) marks one from outside (e.g. when the parent types the same number).
 */
export function chips(options, selected, onPick, { wrap = true } = {}) {
  const buttons = options.map(([value, label]) =>
    el("button", { type: "button", class: "chip", onclick: () => { row.select(value); onPick(value) } }, label));
  const row = el("div", { class: wrap ? "chips" : "chips nowrap" }, buttons);
  row.select = (v) => buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(options[i][0] === v)));
  row.select(selected);
  return row;
}

/** The on/off switch, the same on every screen (AppSwitch in the Android app). */
export function toggle(checked, onChange, label) {
  return el("input", {
    type: "checkbox", role: "switch", class: "switch", checked, "aria-label": label,
    onchange: (e) => onChange(e.target.checked),
  });
}

/** A number field that keeps only digits, up to [max] of them. */
export function digitsInput(value, maxDigits, oninput, attrs = {}) {
  return el("input", {
    type: "text", inputmode: "numeric", pattern: "[0-9]*", dir: "ltr", value, ...attrs,
    oninput: (e) => {
      const clean = e.target.value.replace(/\D/g, "").slice(0, maxDigits);
      if (clean !== e.target.value) e.target.value = clean;
      oninput(clean);
    },
  });
}

/** A field with a label above it. */
export const field = (label, input, hint) =>
  el("label", { class: "field" }, el("span", {}, label), input, hint ? el("small", { class: "hint" }, hint) : "");

/** A screen's parts as a flat list of nodes (nested lists, and false/null/"" left out). */
export const nodes = (parts) => [parts].flat(Infinity).filter((c) => c != null && c !== false && c !== "");

/**
 * Spinner / error with "try again" / content, like LoadedContent in the Android app. When the
 * screen is already showing (reload after a change), it stays on screen until the new data arrives.
 */
export async function loadInto(container, load, render) {
  if (!container.hasChildNodes()) container.replaceChildren(el("p", { class: "loading" }, "טוען..."));
  try {
    const data = await load();
    container.replaceChildren(...nodes(render(data)));
  } catch (e) {
    if (e.signedOut) throw e;
    container.replaceChildren(el("div", { class: "empty" },
      el("div", { class: "big" }, "😕"),
      el("p", { class: "muted" }, e.message || "שגיאה"),
      el("button", { class: "btn plain", onclick: () => loadInto(container, load, render) }, "לנסות שוב")));
  }
}

export const screenTitle = (title, subtitle) =>
  el("div", { class: "screen-title" }, el("h1", {}, title), subtitle ? el("p", { class: "muted small" }, subtitle) : "");

// --- Dates, in Israel time (like Common.kt) ---

export const TZ = "Asia/Jerusalem";
const timeFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const weekdayFmt = new Intl.DateTimeFormat("he-IL", { timeZone: "UTC", weekday: "long" });

function israelParts(date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, s: +p.second };
}

/** "10:34" */
export const formatTime = (date) => timeFmt.format(new Date(date));

/** "16/10 10:34" */
export function formatDateTime(iso) {
  if (!iso) return "—";
  const p = israelParts(new Date(iso));
  return `${p.d}/${p.m} ${formatTime(iso)}`;
}

/** The date in Israel of a moment, as "2026-10-16". */
export function israelDate(date) {
  const p = israelParts(new Date(date));
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export const israelToday = () => israelDate(new Date());

/** "2026-10-16" plus [n] days. */
export function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "יום שישי, 16/10" for "2026-10-16". */
export function formatDate(day) {
  const [y, m, d] = day.split("-").map(Number);
  return `${weekdayFmt.format(new Date(Date.UTC(y, m - 1, d)))}, ${d}/${m}`;
}

/** Day of week of "2026-10-16": 0 = Sunday ... 6 = Saturday. */
export function weekday(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The moment when the clock in Israel shows [day] [hour]:[minute]. */
export function israelTime(day, hour = 0, minute = 0) {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const p = israelParts(new Date(guess));
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - guess;
  return new Date(guess - offset);
}

/** The next time the clock in Israel shows [hour]:00 (today if it's still before that, else tomorrow). */
export function nextIsraelHour(hour) {
  const today = israelTime(israelToday(), hour);
  return today > new Date() ? today : israelTime(addDays(israelToday(), 1), hour);
}

export const minutesBetween = (start, end) => Math.trunc((new Date(end) - new Date(start)) / 60000);

/** "+10" or "−17", kept left-to-right so the sign stays on the left of the number in Hebrew text. */
export const signed = (n) => `‪${n < 0 ? "−" + -n : "+" + n}‬`;

/** Screen time in words: "2 ש׳ 15 ד׳", "45 ד׳", "פחות מדקה". */
export function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return "פחות מדקה";
  if (minutes < 60) return `${minutes} ד׳`;
  if (minutes % 60 === 0) return `${minutes / 60} ש׳`;
  return `${Math.floor(minutes / 60)} ש׳ ${minutes % 60} ד׳`;
}
