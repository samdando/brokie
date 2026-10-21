// A tiny Supabase client: anonymous sign-in, token refresh, RPC and edge functions.
// Mirrors the iPhone app's BackendClient so both behave the same.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

export class BackendError extends Error {
  constructor(message: string, public code?: string) { super(message); }
  get needsHandle() { return /pick a handle/i.test(this.message); }
}

interface Session { access_token: string; refresh_token: string; expires_at: number; user_id: string }
const KEY = "brokie.session.v1";

function load(): Session | null {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Session) : null; } catch { return null; }
}
function save(s: Session | null) {
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
}

export class Backend {
  private session: Session | null = load();
  private pending: Promise<Session> | null = null;
  constructor(private base = SUPABASE_URL.replace(/\/$/, ""), private anon = SUPABASE_ANON_KEY) {}

  async ensureSession(): Promise<Session> {
    const s = this.session;
    if (s && s.expires_at * 1000 > Date.now() + 60_000) return s;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      let fresh: Session;
      if (s) {
        try { fresh = await this.refresh(s); } catch (e) {
          if (e instanceof BackendError && e.code === "auth") fresh = await this.signUpAnonymously(); else throw e;
        }
      } else fresh = await this.signUpAnonymously();
      this.session = fresh;
      save(fresh);
      return fresh;
    })();
    try { return await this.pending; } finally { this.pending = null; }
  }

  private parse(body: any): Session {
    if (!body?.access_token || !body?.user?.id) {
      throw new BackendError("Couldn't sign in. Check anonymous sign-ins are enabled in Supabase.", "auth_shape");
    }
    const expires = body.expires_at ?? Math.floor(Date.now() / 1000) + (body.expires_in ?? 3600);
    return { access_token: body.access_token, refresh_token: body.refresh_token, expires_at: expires, user_id: body.user.id };
  }

  private async signUpAnonymously() { return this.parse(await this.raw("auth/v1/signup", { data: {} }, false)); }

  private async refresh(s: Session) {
    try { return this.parse(await this.raw("auth/v1/token?grant_type=refresh_token", { refresh_token: s.refresh_token }, false)); }
    catch (e) {
      if (e instanceof BackendError && ["400", "401", "403"].includes(e.code ?? "")) throw new BackendError(e.message, "auth");
      throw e;
    }
  }

  rpc<T = unknown>(name: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.raw(`rest/v1/rpc/${name}`, params, true) as Promise<T>;
  }
  fn<T = unknown>(name: string, body: Record<string, unknown>): Promise<T> {
    return this.raw(`functions/v1/${name}`, body, true) as Promise<T>;
  }

  private async raw(path: string, body: unknown, authorized: boolean, retry = true): Promise<unknown> {
    const headers: Record<string, string> = { apikey: this.anon, "Content-Type": "application/json" };
    if (authorized) headers.Authorization = `Bearer ${(await this.ensureSession()).access_token}`;
    else if (this.anon.startsWith("eyJ")) headers.Authorization = `Bearer ${this.anon}`;
    let res: Response;
    try {
      res = await fetch(`${this.base}/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    } catch {
      throw new BackendError("Can't reach the Brokie server. Check your connection.", "network");
    }
    const text = await res.text();
    const json = text ? safeJSON(text) : null;
    if (res.ok) return json;
    if (res.status === 401 && authorized && retry && this.session) {
      this.session = { ...this.session, expires_at: 0 };
      return this.raw(path, body, authorized, false);
    }
    const msg = json?.message ?? json?.msg ?? json?.error_description ?? json?.error ?? `Server error (${res.status}).`;
    throw new BackendError(String(msg), String(json?.code ?? res.status));
  }
}

function safeJSON(text: string): any { try { return JSON.parse(text); } catch { return null; } }
