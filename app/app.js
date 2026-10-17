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
  { id: "activities", label: "משימות", icon: "⭐", show: activitiesScreen },
  { id: "history", label: "היסטוריה", icon: "🕘", show: historyScreen },
  { id: "rules", label: "הגדרות", icon: "⚙️", show: rulesScreen },
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
  if (!api.isSignedIn()) return root.replaceChildren(loginScreen());
  if (api.phone()) return root.replaceChildren(homeScreen());
  // Email accounts from before phones add one first (checked on the server, in case it was added
  // on another device).
  root.replaceChildren(el("div", { class: "login" }, el("p", { class: "muted" }, "טוען...")));
  api.refreshUser().catch(() => {}).finally(() => {
    if (!api.isSignedIn()) return render();
    root.replaceChildren(api.phone() ? homeScreen() : addPhoneScreen({ onDone: render, onSignOut: signOut }));
  });
}

async function signOut() {
  await push.turnOff().catch(() => {});
  api.signOut();
  app.childId = null;
  render();
}

/** "📱 Change phone number" from the account menu. */
function changePhone() {
  root.replaceChildren(addPhoneScreen({ onDone: render, onSignOut: signOut, onCancel: render }));
}

// --- Home: top bar, tab content, bottom tabs ---

function homeScreen() {
  const content = el("main");
  const tabsBar = el("nav", { class: "tabs" });
  const accountButton = el("button", { class: "btn plain", "aria-haspopup": "menu" }, "☰ חשבון");
  accountButton.onclick = () => accountMenu(accountButton, {
    onFamily: app.openFamily,
    onNotifications: push.notificationsDialog,
    onChangePhone: changePhone,
    onSignOut: signOut,
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
      el("span", { class: "brand" }, el("img", { src: "icons/logo.svg", alt: "ScreenDeal", class: "brand-logo" })),
      el("button", { class: "btn plain", onclick: () => showTab(app.tab) }, "🔄 רענון"),
      accountButton),
    content, tabsBar);
}

// --- Sign in and sign up in one: a phone and a code by SMS (a new number gets an account) ---

function loginScreen() {
  return el("div", { class: "login" },
    el("img", { src: "icons/logo.svg", alt: "ScreenDeal", class: "login-logo" }),
    el("p", { class: "muted" }, "כניסה או הרשמה"),
    phoneAndCode({
      sendCode: (p) => api.sendCode(p),
      verify: async (p, code) => { await api.verifyCode(p, code); render() },
      askConsent: true,
    }));
}

/**
 * Two steps: the phone number, then the code that came by SMS. Used for signing in and for
 * adding or changing the account's phone. sendCode and verify get the number as "+972...".
 */
function phoneAndCode({ sendCode, verify, askConsent = false }) {
  const box = el("div", {});
  const number = el("input", { type: "tel", autocomplete: "tel", dir: "ltr", placeholder: "050-1234567" });
  const code = el("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", dir: "ltr", maxlength: "6", class: "code-input" });
  const agree = el("input", { type: "checkbox" });
  const sendButton = el("button", { class: "btn block", type: "submit" });
  const okButton = el("button", { class: "btn block", type: "submit" });
  const resend = el("button", { class: "btn plain muted-text", type: "button" });
  let phone = null; // set once the code was sent
  let busy = false;
  let error = null;
  let info = null;
  let resendAt = 0;
  let timer = null;

  const check = () => {
    sendButton.disabled = busy || !number.value.trim() || (askConsent && !agree.checked);
    okButton.disabled = busy || code.value.length < 5;
    const wait = Math.ceil((resendAt - Date.now()) / 1000);
    resend.disabled = busy || wait > 0;
    resend.textContent = wait > 0 ? `שליחה שוב (בעוד ${wait} שניות)` : "לא הגיע קוד? שליחה שוב";
  };
  number.addEventListener("input", check);
  agree.addEventListener("change", check);
  code.addEventListener("input", () => { code.value = code.value.replace(/\D/g, "").slice(0, 6); check() });

  async function run(action) {
    busy = true;
    error = null;
    info = null;
    draw();
    try {
      await action();
    } catch (e) {
      error = e.message;
    }
    busy = false;
    draw();
  }

  // "Send again" waits a minute, like Supabase does.
  const send = (p) => run(async () => {
    await sendCode(p);
    phone = p;
    code.value = "";
    resendAt = Date.now() + 60_000;
    clearInterval(timer);
    timer = setInterval(() => { check(); if (Date.now() > resendAt) clearInterval(timer) }, 1000);
  });

  resend.onclick = () => { send(phone).then(() => { if (!error) { info = "שלחנו קוד חדש"; draw() } }) };

  function draw() {
    sendButton.textContent = busy ? "רגע..." : "שליחת קוד ב-SMS";
    okButton.textContent = busy ? "רגע..." : "אישור";
    check();
    if (!phone) {
      box.replaceChildren(el("form", {
        onsubmit: (e) => {
          e.preventDefault();
          const p = api.normalizePhone(number.value);
          if (!p) { error = "צריך מספר נייד ישראלי, למשל 050-1234567"; return draw() }
          send(p);
        },
      },
        el("label", { class: "field" }, el("span", {}, "מספר טלפון"), number),
        // Signing up and signing in are the same steps: a new number gets an account after its code.
        askConsent && el("p", { class: "small muted" }, "פעם ראשונה? אחרי הקוד ניצור לך חשבון חדש."),
        // Consent before an account is created (terms of use, privacy policy, age 18+).
        askConsent && el("label", { class: "check" }, agree,
          el("span", {}, "אני מעל גיל 18, הורה או אפוטרופוס, ומסכים/ה לתנאי השימוש ולמדיניות הפרטיות.")),
        askConsent && el("p", { class: "links-row" },
          el("a", { href: "../terms/", target: "_blank" }, "תנאי השימוש"), el("a", { href: "../privacy/", target: "_blank" }, "מדיניות הפרטיות")),
        error && el("p", { class: "error" }, error),
        sendButton));
    } else {
      box.replaceChildren(el("form", {
        onsubmit: (e) => { e.preventDefault(); run(() => verify(phone, code.value)) },
      },
        el("p", {}, "שלחנו קוד ב-SMS ל-", el("bdi", {}, api.formatPhone(phone))),
        el("label", { class: "field" }, el("span", {}, "הקוד מה-SMS"), code),
        error && el("p", { class: "error" }, error),
        info && el("p", { class: "info" }, info),
        okButton),
        el("div", { class: "links" }, resend,
          el("button", { class: "btn plain muted-text", type: "button", onclick: () => { phone = null; error = null; info = null; draw() } }, "שינוי מספר")));
      code.focus();
    }
  }
  draw();
  return box;
}

/**
 * For accounts without a phone (they signed up with email): add one before going on. Also opened
 * from the account menu to change the number (onCancel is then shown).
 */
function addPhoneScreen({ onDone, onSignOut, onCancel = null }) {
  const changing = !!onCancel;
  return el("div", { class: "login" },
    el("div", { class: "logo" }, "📱"),
    el("h1", {}, changing ? "החלפת מספר טלפון" : "מוסיפים מספר טלפון"),
    el("p", { class: "muted" }, changing
      ? "הקוד יישלח למספר החדש. אחרי האישור נכנסים רק עם המספר החדש."
      : "מעכשיו נכנסים ל-ScreenDeal עם מספר הטלפון וקוד ב-SMS, בלי סיסמה. הילדים, המשפחה וההיסטוריה נשארים כמו שהם."),
    phoneAndCode({
      sendCode: (p) => api.requestPhoneChange(p),
      verify: async (p, code) => { await api.verifyPhoneChange(p, code); onDone() },
    }),
    el("div", { class: "links" }, changing
      ? el("button", { class: "btn plain", type: "button", onclick: onCancel }, "ביטול")
      : el("button", { class: "btn plain muted-text", type: "button", onclick: onSignOut }, "התנתקות")));
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
