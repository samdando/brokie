// Brokie · voice-token
// Gives a signed-in squad member a short-lived LiveKit token for one of the
// squad's voice rooms. Membership is checked by the database (voice_identity),
// using the caller's own login, so nobody can join another squad's call.
//
// Secrets: LIVEKIT_URL (wss://…livekit.cloud), LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
// SUPABASE_URL and SUPABASE_ANON_KEY are provided automatically.
// Deploy with "Verify JWT" ON (the default).

import { livekitToken, roomName, ROOMS } from "../_shared/livekit.ts";

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
