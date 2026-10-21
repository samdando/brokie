// Brokie · voice-token
// Gives a signed-in squad member a short-lived LiveKit token for one of the
// squad's voice rooms. Membership is checked by the database (voice_identity),
// using the caller's own login, so nobody can join another squad's call.
//
// Secrets: LIVEKIT_URL (wss://…livekit.cloud), LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
// SUPABASE_URL and SUPABASE_ANON_KEY are provided automatically.
// Deploy with "Verify JWT" ON (the default).


const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Sign in first." }, 401);

  let squadId = "", room = "";
  try {
    ({ squadId, room } = await req.json());
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(squadId) || !(ROOMS as readonly string[]).includes(room)) {
    return json({ error: "Unknown room" }, 400);
  }

  const url = Deno.env.get("LIVEKIT_URL"), key = Deno.env.get("LIVEKIT_API_KEY"), secret = Deno.env.get("LIVEKIT_API_SECRET");
  if (!url || !key || !secret) return json({ error: "Voice isn't set up on the server yet." }, 503);

  const check = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/voice_identity`, {
    method: "POST",
    // Reuse the app's own public key so this works with legacy or new-style keys.
    headers: { apikey: req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "", Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ p_squad: squadId }),
  });
  if (!check.ok) return json({ error: "You're not in that squad." }, 403);
  const who = await check.json() as { user_id: string; handle: string };

  const token = await livekitToken(key, secret, { identity: who.user_id, name: who.handle, room: roomName(squadId, room) });
  return json({ url, token, room: roomName(squadId, room) });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// ---- inlined from _shared/livekit.ts ----
// Mints a LiveKit access token (HS256 JWT) without any SDK.
type VoiceGrant = { identity: string; name: string; room: string; ttlSeconds?: number };

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function livekitToken(apiKey: string, apiSecret: string, grant: VoiceGrant, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: apiKey,
    sub: grant.identity,
    name: grant.name,
    nbf: iat - 10,
    exp: iat + (grant.ttlSeconds ?? 60 * 60),
    video: {
      room: grant.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources: ["microphone"],
    },
  };
  const body = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

const ROOMS = ["squad", "gold", "indices"] as const;
function roomName(squadId: string, room: string): string {
  return `${squadId}:${room}`;
}
