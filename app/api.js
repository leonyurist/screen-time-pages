// The parent's connection to Supabase, the same calls as the Android app's ParentApi.kt:
// sign-in with a phone and a code on WhatsApp (email + password for accounts from before), then
// reading/writing the family's data through the REST API.
// The database's own rules (RLS) make sure a parent only sees their own children.

const SUPABASE_URL = "https://toqrvkypugdnethvacel.supabase.co";
// The publishable key is public by design (it's in the Android app too); RLS protects the data.
const SUPABASE_KEY = "sb_publishable_ihGPy2Zh1cdKUYJLHdE42Q_1fmCUuef";

/** An error to show the parent, already in Hebrew. */
export class ApiError extends Error {}

const SESSION_KEY = "screendeal_session";
const WRONG_LOGIN = "אימייל או סיסמה שגויים";
const PHONE_TAKEN = "המספר הזה כבר שייך לחשבון אחר. אפשר לפנות אלינו כדי לאחד את החשבונות";

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) } catch { return null }
}

function saveSession(res) {
  const old = loadSession();
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    access: res.access_token,
    refresh: res.refresh_token,
    expiresAt: Date.now() + (res.expires_in || 3600) * 1000,
    email: res.user ? res.user.email || "" : old?.email || "",
    phone: res.user ? res.user.phone || "" : old?.phone || "",
  }));
}

export const isSignedIn = () => !!loadSession()?.refresh;
export const email = () => loadSession()?.email || "";
/** The account's phone as Supabase keeps it ("972501234567"), or "" for an email account without one. */
export const phone = () => loadSession()?.phone || "";
/** What to call this account on screen: the phone ("050-123-4567"), or the email. */
export const accountLabel = () => (phone() ? formatPhone(phone()) : email());
export const signOut = () => localStorage.removeItem(SESSION_KEY);

// --- Phone numbers ---

/**
 * "050-123 4567", "+972 50 1234567" or "972501234567" → "+972501234567", or null if it isn't an
 * Israeli mobile number (codes are sent only to those).
 */
export function normalizePhone(input) {
  const digits = String(input).replace(/\D/g, "");
  const local = digits.startsWith("972") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return local.length === 9 && local.startsWith("5") ? "+972" + local : null;
}

/** "972501234567" or "+972501234567" → "050-123-4567" (shown inside <bdi> so it stays left-to-right). */
export function formatPhone(p) {
  const local = "0" + String(p).replace(/\D/g, "").replace(/^972/, "");
  return local.length === 10 ? `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}` : p;
}

// --- Account ---

/** Sends a sign-in code on WhatsApp. A number we don't know gets a new account once the code is checked. */
export async function sendCode(phoneNumber) {
  await send("POST", "/auth/v1/otp", { phone: phoneNumber, create_user: true });
}

/** Checks the code from WhatsApp and signs in. */
export async function verifyCode(phoneNumber, code) {
  let res;
  try {
    res = await send("POST", "/auth/v1/verify", { type: "sms", phone: phoneNumber, token: code.trim() });
  } catch (e) {
    res = await devMasterLogin(phoneNumber, code);
    if (!res) throw e;
  }
  saveSession(res);
}

/** Adds a phone to this account (an email account) or changes it: sends a code to the new number. */
export const requestPhoneChange = async (phoneNumber) => send("PUT", "/auth/v1/user", { phone: phoneNumber }, await accessToken());

/** Checks the code sent to the new number; from now on the parent can sign in with it. */
export async function verifyPhoneChange(phoneNumber, code) {
  try {
    const res = await send("POST", "/auth/v1/verify", { type: "phone_change", phone: phoneNumber, token: code.trim() }, await accessToken());
    if (res?.access_token) saveSession(res);
  } catch (e) {
    if (!(await devMasterAddPhone(phoneNumber, code))) throw e;
  }
  await refreshUser();
}

/** Reads the account's email and phone from the server (e.g. a phone added on another device). */
export async function refreshUser() {
  const user = await send("GET", "/auth/v1/user", null, await accessToken());
  const s = loadSession();
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify({ ...s, email: user.email || "", phone: user.phone || "" }));
}

// DEVELOPMENT ONLY — remove both before the Google Play release (SPEC.md in the app repo, stage ט7):
// the master code from the dev-login function, tried only after the real code check failed.
async function devMasterLogin(phoneNumber, code) {
  try { return await send("POST", "/functions/v1/dev-login", { phone: phoneNumber, code: code.trim() }) } catch { return null }
}

async function devMasterAddPhone(phoneNumber, code) {
  try {
    await send("POST", "/functions/v1/dev-login", { action: "add_phone", phone: phoneNumber, code: code.trim() }, await accessToken());
    return true;
  } catch (e) {
    if (e.message === PHONE_TAKEN) throw e;
    return false;
  }
}


/** Signs in with the one-time code from the reset link (?token_hash=...). */
export async function signInFromResetCode(tokenHash, type = "recovery") {
  let res;
  try {
    res = await send("POST", "/auth/v1/verify", { type, token_hash: tokenHash });
  } catch {
    throw new ApiError("הקישור פג תוקף או שכבר השתמשו בו. אפשר לבקש קישור חדש");
  }
  saveSession(res);
}

export const setNewPassword = async (password) => send("PUT", "/auth/v1/user", { password }, await accessToken());

/** True if no other parent is in this parent's family, so deleting the account deletes the children too. */
export const isOnlyParent = async () => (await select("family_members?select=parent_id")).length <= 1;

/** Deletes the account on the server (the delete-account function), then signs out here. */
export async function deleteAccount() {
  await send("POST", "/functions/v1/delete-account", {}, await accessToken());
  signOut();
}

/** A photo the child took (private file; the database checks it's this family's child), as a Blob. */
export async function downloadPhoto(path) {
  const token = await accessToken();
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/session-photos/${path}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + token },
    });
  } catch {
    throw new ApiError("אין חיבור לאינטרנט");
  }
  if (!response.ok) throw new ApiError(`טעינת התמונה נכשלה (${response.status})`);
  return response.blob();
}
// Several calls at once share one refresh.
let refreshing = null;

/** A valid access token, refreshed when it's about to expire. */
async function accessToken() {
  const s = loadSession();
  if (!s?.refresh) throw Object.assign(new ApiError("צריך להתחבר מחדש"), { signedOut: true });
  if (Date.now() < s.expiresAt - 60_000) return s.access;
  refreshing ??= send("POST", "/auth/v1/token?grant_type=refresh_token", { refresh_token: s.refresh })
    .then(res => { saveSession(res); return res.access_token })
    .catch(e => { if (e.message === WRONG_LOGIN) { signOut(); e.signedOut = true } throw e })
    .finally(() => { refreshing = null });
  return refreshing;
}

// --- Data (PostgREST) ---

/** GET /rest/v1/[pathAndQuery], e.g. "children?select=id,name&order=created_at". */
export const select = async (pathAndQuery) => send("GET", "/rest/v1/" + pathAndQuery, null, await accessToken());
export const rpc = async (fn, args = {}) => send("POST", "/rest/v1/rpc/" + fn, args, await accessToken());
export const insert = async (table, row) => send("POST", "/rest/v1/" + table, row, await accessToken());
/** PATCH rows matching [filter], e.g. "id=eq.123". */
export const update = async (table, filter, values) => send("PATCH", `/rest/v1/${table}?${filter}`, values, await accessToken());
export const remove = async (table, filter) => send("DELETE", `/rest/v1/${table}?${filter}`, null, await accessToken());

// --- HTTP ---

async function send(method, path, body, token) {
  const headers = { apikey: SUPABASE_KEY };
  if (token) headers.Authorization = "Bearer " + token;
  if (body) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(SUPABASE_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError("אין חיבור לאינטרנט");
  }
  const text = await response.text();
  if (!response.ok) throw new ApiError(hebrewError(response.status, text));
  return text.trim() ? JSON.parse(text) : null;
}

function hebrewError(code, body) {
  let json = null;
  try { json = JSON.parse(body) } catch {}
  const message = ["msg", "message", "error_description", "error"].map(k => json?.[k]).find(v => typeof v === "string" && v) || "";
  const lower = message.toLowerCase();
  if (message.includes("Invalid login credentials") || body.includes("invalid_grant")) return WRONG_LOGIN;
  if (body.includes("phone_exists") || message.includes("Phone number already")) return PHONE_TAKEN;
  if (message.includes("already registered") || message.includes("already exists")) return "כבר יש חשבון עם האימייל הזה";
  if (message.includes("Invalid phone") || (lower.includes("phone number") && code === 400)) return "מספר הטלפון לא תקין";
  if (lower.includes("sending") || lower.includes("hook") || (lower.includes("sms") && code >= 500)) return "שליחת הקוד נכשלה. אפשר לנסות שוב בעוד דקה";
  if (lower.includes("expired") || (lower.includes("invalid") && body.toLowerCase().includes("otp"))) return "הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש";
  if (message.includes("Password should be")) return "הסיסמה קצרה מדי (לפחות 6 תווים)";
  if (message.includes("Email not confirmed")) return "צריך לאשר את האימייל לפני ההתחברות";
  if (message.includes("should be different")) return "הסיסמה החדשה צריכה להיות שונה מהקודמת";
  if (lower.includes("rate limit")) return "יותר מדי ניסיונות, נסה שוב בעוד כמה דקות";
  if (code === 401) return "צריך להתחבר מחדש";
  if (message) return "שגיאה: " + message;
  return `שגיאה בשרת (${code})`;
}
