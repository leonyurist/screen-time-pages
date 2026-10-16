// "☰ חשבון": the account menu, family members (invite / join), and deleting the account.
// Ported from ParentActivity.kt (the menu), FamilyDialog.kt and DeleteAccountDialog.kt.

import * as api from "./api.js";
import { el, toast, openDialog } from "./ui.js";

/**
 * The menu under "☰ חשבון", like the Android app's: the email, family, terms, privacy, sign out and
 * delete account. On the web there's also "notifications" (push.js), and "add to the home screen"
 * while the site isn't installed.
 */
export function accountMenu(anchor, { onFamily, onNotifications, onSignOut, onDeleted, onInstall }) {
  const close = () => { menu.remove(); document.removeEventListener("click", outside, true) };
  const outside = (e) => { if (!menu.contains(e.target) && e.target !== anchor) close() };
  const item = (text, onclick, cls = "") => el("button", { type: "button", class: "menu-item " + cls, onclick: () => { close(); onclick() } }, text);
  const menu = el("div", { class: "menu", role: "menu" },
    el("div", { class: "menu-item muted ltr-email" }, el("bdi", {}, api.email())),
    item("👨‍👩‍👧 בני המשפחה", onFamily),
    item("🔔 התראות", onNotifications),
    onInstall && item("📲 הוספה למסך הבית", onInstall),
    el("a", { class: "menu-item", href: "../terms/", target: "_blank", onclick: () => close() }, "תנאי שימוש"),
    el("a", { class: "menu-item", href: "../privacy/", target: "_blank", onclick: () => close() }, "מדיניות פרטיות"),
    el("hr"),
    item("התנתקות", onSignOut),
    item("מחיקת החשבון", () => deleteAccountDialog(onDeleted), "danger"));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${Math.max(8, r.left)}px`;
  setTimeout(() => document.addEventListener("click", outside, true));
}

/**
 * The parents in this family, plus "invite a parent" (makes a code to send) and "join a family"
 * (type a code you got). [onFamilyChanged] reloads the screens after joining.
 */
export function familyDialog(onFamilyChanged) {
  const me = api.email();
  const members = el("div", {}, el("p", { class: "muted" }, "טוען..."));
  const invite = el("div", {});
  const join = el("div", { class: "stack" });

  api.select("family_members?select=joined_at,parents(email)&order=joined_at").then((rows) => {
    let emails = rows.map((r) => r.parents?.email).filter(Boolean);
    if (!emails.length) emails = [me];
    members.replaceChildren(...emails.map((e) => el("p", {}, "• ", el("bdi", {}, e), e === me ? " (את/ה)" : "")));
  }).catch((e) => members.replaceChildren(el("p", { class: "danger-text" }, e.message)));

  invite.append(el("button", {
    class: "btn block", onclick: async () => {
      try {
        showInvite(await api.rpc("create_family_invite"));
      } catch (e) {
        toast(e.message || "שגיאה");
      }
    },
  }, "➕ הזמנת הורה"));

  function showInvite(code) {
    const text = `הצטרפו למשפחה שלנו באפליקציה ScreenDeal: נרשמים באפליקציה, בוחרים "בני המשפחה" ← "הצטרפות למשפחה", ומקלידים את הקוד ${code}`;
    invite.replaceChildren(el("div", { class: "pair-box" },
      el("p", { class: "small muted" }, "קוד הזמנה (בתוקף 7 ימים, לשימוש אחד):"),
      el("div", { class: "pair-code ltr" }, code),
      el("p", { class: "small muted" }, "ההורה השני מתקין את האפליקציה, נרשם, ובוחר \"הצטרפות למשפחה\"."),
      el("button", {
        class: "btn plain", onclick: async () => {
          if (navigator.share) {
            try { await navigator.share({ text }) } catch {}
          } else {
            await navigator.clipboard?.writeText(text);
            toast("הקוד הועתק. אפשר להדביק אותו בוואטסאפ או במייל");
          }
        },
      }, "📤 שליחה (וואטסאפ, מייל...)")));
  }

  join.append(el("button", { class: "btn outline block", onclick: showJoin }, "🔑 יש לי קוד: הצטרפות למשפחה"));

  let dialog;
  function showJoin() {
    const input = el("input", { type: "text", dir: "ltr", autocapitalize: "characters", autocomplete: "off", "aria-label": "קוד הזמנה" });
    const error = el("p", { class: "danger-text small" });
    const go = el("button", { class: "btn block", disabled: true }, "הצטרפות");
    input.oninput = () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      go.disabled = input.value.length !== 6;
    };
    go.onclick = async () => {
      error.textContent = "";
      try {
        const res = await api.rpc("join_family", { p_code: input.value });
        if (!res?.error) {
          toast("הצטרפת למשפחה 🎉");
          dialog.close();
          onFamilyChanged();
        } else {
          error.textContent = res.error === "already_member" ? "את/ה כבר במשפחה הזו" : "הקוד לא נכון, כבר שומש, או שפג תוקפו";
        }
      } catch (e) {
        toast(e.message || "שגיאה");
      }
    };
    join.replaceChildren(
      el("p", { class: "small muted" }, "הצטרפות למשפחה של הורה אחר. אם יש לך ילדים באפליקציה, הם יעברו איתך למשפחה המשותפת."),
      el("label", { class: "field" }, el("span", {}, "קוד הזמנה"), input),
      error, go);
    input.focus();
  }

  dialog = openDialog((close) => ({
    title: "👨‍👩‍👧 בני המשפחה",
    body: [
      el("p", { class: "muted small" }, "כל ההורים במשפחה רואים את אותם ילדים, מאשרים ורואים היסטוריה."),
      members, el("hr"), invite, join,
    ],
    buttons: el("button", { class: "btn plain", onclick: close }, "סגירה"),
  }));
}

const CONFIRM_WORD = "מחק";

/**
 * "Delete account": explains what will be deleted (everything, or only this parent when another
 * parent is in the family), and asks the parent to type a word so it can't happen by mistake.
 */
function deleteAccountDialog(onDeleted) {
  const me = api.email();
  const what = el("div", {}, el("p", { class: "muted" }, "בודקים..."));
  const typed = el("input", { type: "text" });
  const error = el("p", { class: "danger-text small" });
  const del = el("button", { class: "btn plain danger", disabled: true }, "מחיקה לצמיתות");
  let known = false;
  let busy = false;
  const check = () => { del.disabled = busy || !known || typed.value.trim() !== CONFIRM_WORD };
  typed.oninput = check;

  api.isOnlyParent().catch((e) => { error.textContent = e.message; return true }).then((only) => {
    known = true;
    what.replaceChildren(...(only ? [
      el("b", { class: "block" }, "אין הורים נוספים במשפחה, ולכן יימחקו לצמיתות:"),
      el("p", {}, "• החשבון (", el("bdi", {}, me), ")", el("br"), "• כל הילדים, החוקים והפעילויות", el("br"), "• כל ההיסטוריה, היתרות והתמונות"),
      el("p", { class: "small muted" }, "הטלפונים של הילדים יפסיקו לחסום אפליקציות אחרי הסנכרון הבא."),
    ] : [
      el("b", { class: "block" }, "יש עוד הורה במשפחה, ולכן יימחק רק החשבון (", el("bdi", {}, me), ")."),
      el("p", { class: "small muted" }, "הילדים, ההיסטוריה והחוקים נשארים אצל ההורים האחרים."),
    ]));
    check();
  });

  openDialog((close) => {
    del.onclick = async () => {
      busy = true;
      check();
      del.textContent = "מוחק...";
      error.textContent = "";
      try {
        await api.deleteAccount();
        close();
        onDeleted();
      } catch (e) {
        error.textContent = e.message;
        busy = false;
        del.textContent = "מחיקה לצמיתות";
        check();
      }
    };
    return {
      title: "מחיקת החשבון",
      body: [what, el("p", {}, `אי אפשר לבטל את המחיקה. כדי לאשר, יש לכתוב: ${CONFIRM_WORD}`), typed, error],
      buttons: [el("button", { class: "btn plain", onclick: () => { if (!busy) close() } }, "ביטול"), del],
    };
  });
}
