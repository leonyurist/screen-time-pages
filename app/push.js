// "🔔 התראות": notifications on the website, the same ones the Android app gets ("מיכל סיימה
// חשבון, מחכה לאישור"). Web Push: the browser gives us an address at its push service (Apple's on
// iPhone), we keep it on the server (register_web_push, migration 0031), and the notify function
// sends there. On iPhone this works only from iOS 16.4, and only when the site is on the home screen.

import * as api from "./api.js";
import { el, toast, openDialog } from "./ui.js";

// The public half of the server's VAPID key (the same as in supabase/functions/notify/webpush.ts).
const VAPID_PUBLIC_KEY = "BCays5IGEuSqrEdWQGjD4iEPnGufZDxVx0FQaNUFCENIj2FT-ZmpLVd3vtXSHgQjcJSuh11jm5mqoyxXP4WD4Fw";

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

async function subscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function register(sub) {
  const { endpoint, keys } = sub.toJSON();
  return api.rpc("register_web_push", { p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth });
}

async function turnOn() {
  if (await Notification.requestPermission() !== "granted") return false;
  const reg = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(VAPID_PUBLIC_KEY.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const sub = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await register(sub);
  return true;
}

/** Stops notifications on this browser (on sign-out too, before the session is gone). */
export async function turnOff() {
  if (!supported()) return;
  const sub = await subscription();
  if (!sub) return;
  try { await api.rpc("unregister_web_push", { p_endpoint: sub.endpoint }) } catch {}
  await sub.unsubscribe();
}

/** On each visit: tells the server this browser's address again, in case the browser renewed it. */
export async function refresh() {
  if (!supported() || Notification.permission !== "granted") return;
  try {
    const sub = await subscription();
    if (sub) await register(sub);
  } catch {}
}

/** The dialog from the account menu: on / off, or how to make it possible on this phone. */
export function notificationsDialog() {
  const body = el("div", { class: "stack" }, el("p", { class: "muted" }, "בודקים..."));
  const buttons = el("div", { style: "display: contents" }); // lays out like the dialog's own buttons
  let close;

  const show = (texts, ...actions) => {
    body.replaceChildren(...texts.map((t) => typeof t === "string" ? el("p", {}, t) : t));
    buttons.replaceChildren(...actions, el("button", { class: "btn plain", onclick: () => close() }, "סגירה"));
  };

  async function update() {
    if (!supported()) {
      if (isIphone() && !standalone()) {
        return show(["באייפון ההתראות עובדות רק כשהאתר נפתח מהאייקון במסך הבית.",
          el("p", { class: "small" }, "בספארי לוחצים על כפתור השיתוף ", el("b", {}, "⬆️"), " ובוחרים ", el("b", {}, "\"הוספה למסך הבית\""),
            ". אחר כך פותחים את ScreenDeal מהאייקון, ושוב \"☰ חשבון\" ← \"🔔 התראות\"."),
          el("p", { class: "small muted" }, "צריך iOS 16.4 ומעלה.")]);
      }
      return show(["הדפדפן הזה לא תומך בהתראות. באייפון: iOS 16.4 ומעלה, והאתר במסך הבית."]);
    }
    if (Notification.permission === "denied") {
      return show(["ההתראות חסומות לאתר הזה.",
        el("p", { class: "small" }, isIphone()
          ? "כדי לאפשר: הגדרות ← התראות ← ScreenDeal ← אפשר התראות."
          : "כדי לאפשר: בהגדרות האתר בדפדפן (🔒 ליד הכתובת) ← התראות ← לאפשר.")]);
    }
    const on = Notification.permission === "granted" && !!(await subscription());
    if (on) {
      return show(["🔔 ההתראות פועלות בטלפון הזה.",
        el("p", { class: "small muted" }, "תקבל/י הודעה כשילד מסיים פעילות, צובר דקות, או כשההגנה בטלפון שלו כבויה.")],
        el("button", { class: "btn outline", onclick: () => act(turnOff, "ההתראות כבויות") }, "🔕 כיבוי"));
    }
    show(["רוצה לקבל הודעה כשילד מסיים פעילות ומחכה לאישור? כמו באפליקציה לאנדרואיד.",
      el("p", { class: "small muted" }, "בלחיצה על \"הפעלה\" הטלפון ישאל אם לאפשר התראות. בוחרים \"אפשר\".")],
      el("button", {
        class: "btn", onclick: () => act(async () => {
          if (!await turnOn()) throw new Error("ההתראות לא אושרו");
        }, "🔔 ההתראות פועלות"),
      }, "הפעלה"));
  }

  async function act(action, success) {
    buttons.querySelectorAll("button").forEach((b) => { b.disabled = true });
    try {
      await action();
      toast(success);
    } catch (e) {
      toast(e.message || "שגיאה");
    }
    update();
  }

  openDialog((c) => {
    close = c;
    return { title: "🔔 התראות", body, buttons };
  });
  update();
}
