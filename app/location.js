// "Where is the phone?": asks the server to wake the child's phone, waits up to 45 seconds for its
// answer, and shows the place with buttons that open a map. If the phone doesn't answer (off, no
// internet, or location not turned on there), shows the last place it sent. Ported from LocationDialog.kt.
// (The Android app also shows a street address from the phone's map service; a website has no such
// service without sending the place to another company, so here the map shows it.)

import * as api from "./api.js";
import { el, openDialog, formatDateTime } from "./ui.js";

async function latestLocation(childId) {
  const rows = await api.select(
    `child_locations?select=lat,lng,accuracy,captured_at,created_at&child_id=eq.${childId}&order=created_at.desc&limit=1`);
  const l = rows[0];
  return l ? { lat: l.lat, lng: l.lng, accuracy: l.accuracy, capturedAt: l.captured_at, receivedAt: new Date(l.created_at) } : null;
}

function ago(iso) {
  const minutes = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  return `לפני ${Math.floor(minutes / 60)} שע׳`;
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function locationDialog(child) {
  const content = el("div", { class: "stack" });
  let closed = false;
  openDialog((close) => ({
    title: `📍 איפה הטלפון של ${child.name}?`,
    body: content,
    buttons: el("button", { class: "btn plain", onclick: close }, "סגירה"),
  }), { onClose: () => { closed = true } });

  let location = null;
  let fresh = false;
  let waiting = true;
  let error = null;

  function draw() {
    const l = location;
    content.replaceChildren(
      waiting && !fresh && el("p", { class: "row" }, el("span", { class: "spinner" }), "מחפשים את הטלפון... זה לוקח עד חצי דקה."),
      !waiting && !fresh && el("p", { class: "danger-text small" },
        `הטלפון לא ענה. אולי הוא כבוי או בלי אינטרנט, או ש"איפה הטלפון?" לא הופעל בהגדרות ההורה בטלפון של ${child.name}.`),
      error && el("p", { class: "danger-text" }, error),
      l && el("b", {}, fresh ? "הטלפון נמצא:" : "המקום האחרון שהטלפון שלח:"),
      l && el("p", { class: "small muted" },
        `${ago(l.capturedAt)} (${formatDateTime(l.capturedAt)})` + (l.accuracy != null ? ` · דיוק של כ-${Math.trunc(l.accuracy)} מ׳` : "")),
      l && el("a", { class: "btn", href: `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`, target: "_blank", rel: "noopener" }, "🗺️ פתיחה ב-Google Maps"),
      l && isIos() && el("a", { class: "btn outline", href: `https://maps.apple.com/?q=${encodeURIComponent(child.name)}&ll=${l.lat},${l.lng}`, target: "_blank", rel: "noopener" }, "🗺️ פתיחה במפות של Apple"),
      !l && !waiting && el("p", { class: "muted" }, "עוד אין מיקום מהטלפון הזה."),
    );
  }

  (async () => {
    draw();
    try {
      const askedAt = new Date(Date.now() - 5000);
      location = await latestLocation(child.id);
      draw();
      await api.rpc("request_location", { p_child: child.id });
      for (let tries = 0; !fresh && tries < 15 && !closed; tries++) {
        await new Promise((r) => setTimeout(r, 3000));
        const latest = await latestLocation(child.id);
        if (!latest) continue;
        location = latest;
        fresh = latest.receivedAt > askedAt;
        draw();
      }
    } catch (e) {
      error = e.message;
    }
    waiting = false;
    draw();
  })();
}
