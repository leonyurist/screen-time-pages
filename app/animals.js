// "🐾 החיות של ...": the child's animal album, read only (SPEC.md "אפיון: החיות שלי" in the app repo),
// like AnimalsBox and AnimalAlbum in the Android app. The server counts everything
// (child_animals_album, 0064); an animal not earned yet shows only its task and progress.

import * as api from "./api.js";
import { el } from "./ui.js";
import { openSheet } from "./mistakes.js";

const TIERS = {
  friend: { title: "חבר", emoji: "🤝", about: "הראשונות, על התחלה טובה" },
  special: { title: "מיוחד", emoji: "⭐", about: "על שבוע טוב ועל דיוק" },
  rare: { title: "נדיר", emoji: "🏆", about: "על חודש של מאמץ" },
  legend: { title: "אגדי", emoji: "💎", about: "רק לאלופים אמיתיים" },
};

/** The row in the child's card: how many animals, opening the album. */
export function animalsBox(child) {
  return el("button", { type: "button", class: "levels-row animals-row", onclick: () => animalsScreen(child) },
    el("span", { class: "levels-icon" }, "🐾"),
    el("span", { class: "levels-text" },
      el("b", {}, `החיות של ${child.name}`),
      el("span", { class: "small muted" }, child.animals === 1 ? "חיה אחת באלבום" : `${child.animals} חיות באלבום`)),
    el("span", { class: "muted" }, "›"));
}

const picture = (code, cls) => el("img", { class: cls, src: `animals/${code}.png`, alt: "", loading: "lazy" });

function openCard(a) {
  const [top, bottom] = (a.scene || "#fff3e0,#ffe0b2").split(",");
  return el("div", { class: "an-card" },
    el("div", { class: "an-inner" },
      el("div", { class: "an-scene", style: `background: linear-gradient(${top}, ${bottom})` },
        a.deco && picture(a.deco, "an-deco"),
        picture(a.image, "an-animal")),
      el("div", { class: "an-info" },
        el("div", { class: "an-name" }, a.name),
        el("div", { class: "an-got" }, el("b", {}, "קיבלת על:"), a.got),
        el("div", { class: "an-fact" }, "🧠 " + a.fact))));
}

function closedCard(a) {
  return el("div", { class: "an-card an-closed" },
    el("div", { class: "an-inner" },
      el("div", { class: "an-q" }, "?"),
      el("div", { class: "an-task" }, el("div", { class: "an-do" }, a.task), el("div", { class: "an-tip" }, a.tip)),
      a.progress && el("div", { class: "an-prog" },
        el("div", { class: "an-bar" }, el("div", { style: `width: ${a.t ? Math.round(a.n * 100 / a.t) : 0}%` })),
        el("div", { class: "an-prog-text" }, a.progress))));
}

/** The album over the whole page: one shelf per tier, earned animals first. */
export function animalsScreen(child) {
  const sheet = openSheet();
  const close = el("button", { class: "btn plain", onclick: () => sheet.close() }, "סגירה");
  const header = (count) => el("div", { class: "row top" },
    el("div", { class: "grow" }, el("h2", { class: "sheet-title" }, `🐾 החיות של ${child.name}`), count && el("p", { class: "muted small" }, count)),
    close);
  sheet.set([header(), el("p", { class: "loading" }, "טוען...")]);
  api.rpc("child_animals_album", { p_child: child.id }).then((album) => {
    const shelves = Object.entries(TIERS).map(([tier, t]) => {
      const cards = album.animals.filter((a) => a.tier === tier);
      if (!cards.length) return null;
      return el("section", { class: `an-shelf an-${tier}` },
        el("div", { class: "an-head" },
          el("span", { class: "an-medal" }, t.emoji),
          el("span", { class: "grow" }, el("b", {}, t.title), el("span", { class: "small muted block" }, t.about)),
          el("span", { class: "small muted" }, `${cards.filter((a) => a.earned).length} מתוך ${cards.length}`)),
        el("div", { class: "an-grid" }, cards.map((a) => (a.earned ? openCard(a) : closedCard(a)))));
    });
    sheet.set([header(`${album.earned} חיות מתוך ${album.total}`), ...shelves,
      el("p", { class: "small muted center" }, "ציורי החיות: Noto Emoji של Google (רישיון Apache 2.0)")]);
  }).catch((e) => sheet.set([header(), el("p", { class: "muted" }, e.message || "שגיאה")]));
}
