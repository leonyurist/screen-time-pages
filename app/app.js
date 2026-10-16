// ScreenDeal for parents on the web (and on iPhone, added to the home screen): the same screens as
// the Android app's parent mode (ParentActivity.kt), talking to the same Supabase.

import * as api from "./api.js";
import { el, openDialog } from "./ui.js";
import { childrenScreen } from "./children.js";
import { approvalsScreen } from "./approvals.js";
import { activitiesScreen } from "./activities.js";
import { historyScreen } from "./history.js";
import { rulesScreen } from "./rules.js";
import { accountMenu, familyDialog } from "./account.js";
import * as push from "./push.js";

const root = document.getElementById("root");

const TABS = [
  { id: "children", label: "ילדים", icon: "👨‍👩‍👧", show: childrenScreen },
  { id: "approvals", label: "אישורים", icon: "✅", show: approvalsScreen },
  { id: "activities", label: "פעילויות", icon: "⭐", show: activitiesScreen },
  { id: "history", label: "היסטוריה", icon: "📅", show: historyScreen },
  { id: "rules", label: "חוקים", icon: "⚙️", show: rulesScreen },
];

/** The first screen: ?tab=approvals when a notification opened the site (sw.js), else the children. */
function startTab() {
  const tab = new URLSearchParams(location.search).get("tab");
  return TABS.some((t) => t.id === tab) ? tab : "children";
}

/** Shared by the screens: the chosen child stays chosen on the others (like the Android app). */
const app = {
  tab: startTab(),
  childId: null,
  installPrompt: null, // Android/desktop Chrome's install event, kept for the "install" button
  openFamily: () => familyDialog(() => { app.childId = null; showTab(app.tab) }),
  installHint: () => installHint(),
};

let showTab = () => {};

function render() {
  const reset = new URLSearchParams(location.search).get("token_hash");
  if (reset) return root.replaceChildren(newPasswordScreen(reset));
  root.replaceChildren(api.isSignedIn() ? homeScreen() : loginScreen());
}

// --- Home: top bar, tab content, bottom tabs ---

function homeScreen() {
  const content = el("main");
  const tabsBar = el("nav", { class: "tabs" });
  const accountButton = el("button", { class: "btn plain", "aria-haspopup": "menu" }, "☰ חשבון");
  accountButton.onclick = () => accountMenu(accountButton, {
    onFamily: app.openFamily,
    onNotifications: push.notificationsDialog,
    onSignOut: async () => { await push.turnOff().catch(() => {}); api.signOut(); app.childId = null; render() },
    onDeleted: () => { app.childId = null; render() },
    onInstall: isStandalone() ? null : installDialog,
  });

  showTab = async (id) => {
    if (id !== app.tab) content.replaceChildren(); // another screen: show "loading" instead of the old one
    app.tab = id;
    tabsBar.replaceChildren(...TABS.map((t) =>
      el("button", { "aria-current": t.id === id ? "page" : null, onclick: () => { window.scrollTo(0, 0); showTab(t.id) } },
        el("span", { class: "icon" }, t.icon), t.label)));
    try {
      await TABS.find((t) => t.id === id).show(content, app);
    } catch (e) {
      if (e.signedOut) render();
    }
  };

  // Coming back to the site (e.g. from another app on the iPhone) shows fresh numbers.
  document.onvisibilitychange = () => {
    if (document.visibilityState === "visible" && api.isSignedIn() && !document.querySelector("dialog[open]")) showTab(app.tab);
  };

  showTab(app.tab);
  push.refresh();
  return el("div", {},
    el("header", { class: "topbar" },
      el("b", { class: "brand" }, "⏳ ScreenDeal"),
      el("button", { class: "btn plain", onclick: () => showTab(app.tab) }, "🔄 רענון"),
      accountButton),
    content, tabsBar);
}

// --- Sign in / sign up / forgot password ---

function loginScreen() {
  let mode = "signin"; // "signup", or "reset" after the reset email was sent
  let error = null;
  let info = null;
  const box = el("div", { class: "login" });
  const mail = el("input", { type: "email", autocomplete: "username", dir: "ltr" });
  const pass = el("input", { type: "password", autocomplete: "current-password", dir: "ltr" });
  const pass2 = el("input", { type: "password", autocomplete: "new-password", dir: "ltr" });
  const agree = el("input", { type: "checkbox" });
  const submit = el("button", { class: "btn block", type: "submit" });
  let busy = false;

  const check = () => { submit.disabled = busy || !mail.value.trim() || !pass.value || (mode === "signup" && !agree.checked) };
  [mail, pass, pass2].forEach((i) => i.addEventListener("input", check));
  agree.addEventListener("change", check);

  async function run(action) {
    busy = true;
    error = null;
    draw();
    try {
      await action();
    } catch (e) {
      error = e.message;
    }
    busy = false;
    draw();
  }

  function switchTo(m) {
    mode = m;
    error = null;
    info = null;
    pass.value = "";
    pass2.value = "";
    draw();
  }

  function draw() {
    const signup = mode === "signup";
    pass.autocomplete = signup ? "new-password" : "current-password";
    submit.textContent = busy ? "רגע..." : signup ? "הרשמה" : "התחברות";
    mail.disabled = mode === "reset";
    check();
    const form = el("form", {
      onsubmit: (e) => {
        e.preventDefault();
        if (signup && pass.value !== pass2.value) { error = "הסיסמאות לא תואמות"; return draw() }
        run(async () => {
          if (signup) {
            if (await api.signUp(mail.value, pass.value)) render();
            else info = "נשלח אליך מייל לאישור. אחרי האישור אפשר להתחבר.";
          } else {
            await api.signIn(mail.value, pass.value);
            render();
          }
        });
      },
    },
      el("label", { class: "field" }, el("span", {}, "אימייל"), mail),
      mode === "reset" && el("p", {}, "📧 שלחנו לך מייל עם קישור. פותחים את המייל בטלפון הזה, לוחצים על הקישור ובוחרים \"המשך באתר\": האתר ייפתח ויבקש סיסמה חדשה."),
      mode !== "reset" && el("label", { class: "field" }, el("span", {}, "סיסמה"), pass),
      signup && el("label", { class: "field" }, el("span", {}, "סיסמה שוב"), pass2),
      // Consent before creating an account (terms of use, privacy policy, age 18+).
      signup && el("label", { class: "check" }, agree,
        el("span", {}, "אני מעל גיל 18, הורה או אפוטרופוס, ומסכים/ה לתנאי השימוש ולמדיניות הפרטיות.")),
      signup && el("p", { class: "links-row" },
        el("a", { href: "../terms/", target: "_blank" }, "תנאי השימוש"), el("a", { href: "../privacy/", target: "_blank" }, "מדיניות הפרטיות")),
      error && el("p", { class: "error" }, error),
      info && el("p", { class: "info" }, info),
      mode !== "reset" && submit,
    );
    const links = mode === "signin" ? [
      el("button", { class: "btn plain", type: "button", onclick: () => switchTo("signup") }, "אין לך חשבון? הרשמה"),
      el("button", {
        class: "btn plain muted-text", type: "button", onclick: () => {
          if (!mail.value.trim()) { error = "קודם כותבים את האימייל"; return draw() }
          run(async () => { await api.sendPasswordReset(mail.value); switchTo("reset") });
        },
      }, "שכחתי סיסמה"),
    ] : mode === "signup" ? [
      el("button", { class: "btn plain", type: "button", onclick: () => switchTo("signin") }, "כבר יש לי חשבון: התחברות"),
    ] : [
      el("button", { class: "btn plain muted-text", type: "button", onclick: () => run(async () => { await api.sendPasswordReset(mail.value); info = "נשלח מייל חדש" }) }, "לא הגיע מייל? שליחה שוב"),
      el("button", { class: "btn plain", type: "button", onclick: () => switchTo("signin") }, "חזרה להתחברות"),
    ];
    box.replaceChildren(
      el("div", { class: "logo" }, "⏳"),
      el("h1", {}, "ScreenDeal"),
      el("p", { class: "muted" }, { signin: "התחברות לחשבון ההורה", signup: "יצירת חשבון הורה", reset: "בחירת סיסמה חדשה" }[mode]),
      form,
      el("div", { class: "links" }, links),
    );
  }
  draw();
  return box;
}

/** Opened by the link in the reset email: signs in from the link, then asks for a new password. */
function newPasswordScreen(tokenHash) {
  const box = el("div", { class: "login" });
  const pass = el("input", { type: "password", autocomplete: "new-password", dir: "ltr" });
  const pass2 = el("input", { type: "password", autocomplete: "new-password", dir: "ltr" });
  const save = el("button", { class: "btn block", type: "submit", disabled: true }, "שמירה והתחברות");
  const error = el("p", { class: "error" });
  pass.oninput = () => { save.disabled = !pass.value };
  const leave = () => { history.replaceState(null, "", location.pathname); render() };

  const head = [el("div", { class: "logo" }, "🔑"), el("h1", {}, "בחירת סיסמה חדשה")];
  box.replaceChildren(...head, el("p", { class: "muted" }, "בודקים את הקישור..."));
  api.signInFromResetCode(tokenHash, new URLSearchParams(location.search).get("type") || "recovery").then(() => {
    box.replaceChildren(...head, el("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        if (pass.value !== pass2.value) { error.textContent = "הסיסמאות לא תואמות"; return }
        save.disabled = true;
        save.textContent = "רגע...";
        error.textContent = "";
        try {
          await api.setNewPassword(pass.value);
          leave();
        } catch (err) {
          error.textContent = err.message;
          save.disabled = false;
          save.textContent = "שמירה והתחברות";
        }
      },
    },
      el("label", { class: "field" }, el("span", {}, "סיסמה חדשה"), pass),
      el("label", { class: "field" }, el("span", {}, "סיסמה שוב"), pass2),
      error, save));
    pass.focus();
  }).catch((e) => {
    // The link didn't work; whoever was signed in here stays signed in.
    box.replaceChildren(...head, el("p", { class: "error" }, e.message),
      el("button", { class: "btn plain", onclick: leave }, "חזרה להתחברות"));
  });
  return box;
}

// --- "Add to home screen" ---

const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const HINT_KEY = "screendeal_install_hint_closed";

function installSteps() {
  if (isIos()) {
    return el("p", { class: "small" }, "בספארי לוחצים על כפתור השיתוף ", el("b", {}, "⬆️"), " (למטה או למעלה), גוללים ובוחרים ",
      el("b", {}, "\"הוספה למסך הבית\""), ". אם לא רואים את הכפתור, פותחים את האתר בספארי.");
  }
  if (app.installPrompt) {
    return el("button", {
      class: "btn small", onclick: async () => {
        app.installPrompt.prompt();
        await app.installPrompt.userChoice;
        app.installPrompt = null;
      },
    }, "📲 הוספה למסך הבית");
  }
  return el("p", { class: "small" }, "בתפריט הדפדפן (⋮) בוחרים \"הוספה למסך הבית\" או \"התקנת אפליקציה\".");
}

function installDialog() {
  openDialog((close) => ({
    title: "📲 ScreenDeal במסך הבית",
    body: [el("p", {}, "כך האתר ייפתח כמו אפליקציה, באייקון משלו:"), installSteps()],
    buttons: el("button", { class: "btn plain", onclick: close }, "סגירה"),
  }));
}

/** A card above the children that explains how to add the site to the home screen (until closed). */
function installHint() {
  if (isStandalone()) return "";
  try { if (localStorage.getItem(HINT_KEY)) return "" } catch {}
  const card = el("section", { class: "card install" },
    el("div", { class: "row top" },
      el("div", { class: "grow" }, el("b", {}, "📲 ScreenDeal במסך הבית"), el("p", { class: "small" }, "כדי שזה ייפתח כמו אפליקציה:"), installSteps()),
      el("button", {
        class: "close", "aria-label": "סגירה", onclick: () => {
          try { localStorage.setItem(HINT_KEY, "1") } catch {}
          card.remove();
        },
      }, "✕")));
  return card;
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  app.installPrompt = e;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  // Tapping a notification while the site is open: sw.js asks to show that screen.
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.tab && api.isSignedIn() && TABS.some((t) => t.id === e.data.tab)) showTab(e.data.tab);
  });
}

render();
