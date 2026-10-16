// The parent's connection to Supabase, the same calls as the Android app's ParentApi.kt:
// sign-in with email + password, then reading/writing the family's data through the REST API.
// The database's own rules (RLS) make sure a parent only sees their own children.

const SUPABASE_URL = "https://toqrvkypugdnethvacel.supabase.co";
// The publishable key is public by design (it's in the Android app too); RLS protects the data.
const SUPABASE_KEY = "sb_publishable_ihGPy2Zh1cdKUYJLHdE42Q_1fmCUuef";

/** An error to show the parent, already in Hebrew. */
export class ApiError extends Error {}

const SESSION_KEY = "screendeal_session";
const WRONG_LOGIN = "אימייל או סיסמה שגויים";

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) } catch { return null }
}

function saveSession(res) {
  const old = loadSession();
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    access: res.access_token,
    refresh: res.refresh_token,
    expiresAt: Date.now() + (res.expires_in || 3600) * 1000,
    email: res.user?.email || old?.email || "",
  }));
}

export const isSignedIn = () => !!loadSession()?.refresh;
export const email = () => loadSession()?.email || "";
export const signOut = () => localStorage.removeItem(SESSION_KEY);

export async function signIn(mail, password) {
  saveSession(await send("POST", "/auth/v1/token?grant_type=password", { email: mail.trim(), password }));
}

/** Creates an account. Returns false if Supabase wants the email confirmed first. */
export async function signUp(mail, password) {
  const res = await send("POST", "/auth/v1/signup", { email: mail.trim(), password });
  if (!res?.access_token) return false;
  saveSession(res);
  return true;
}


/**
 * Emails the parent a link to choose a new password. The link opens the reset page, which offers
 * the Android app or this website (see ../reset/).
 */
export async function sendPasswordReset(mail) {
  await send("POST", "/auth/v1/recover", { email: mail.trim() });
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
  if (message.includes("already registered") || message.includes("already exists")) return "כבר יש חשבון עם האימייל הזה";
  if (message.includes("Password should be")) return "הסיסמה קצרה מדי (לפחות 6 תווים)";
  if (message.includes("Email not confirmed")) return "צריך לאשר את האימייל לפני ההתחברות";
  if (message.includes("should be different")) return "הסיסמה החדשה צריכה להיות שונה מהקודמת";
  if (lower.includes("rate limit")) return "יותר מדי ניסיונות, נסה שוב בעוד כמה דקות";
  if (code === 401) return "צריך להתחבר מחדש";
  if (message) return "שגיאה: " + message;
  return `שגיאה בשרת (${code})`;
}
