// Mints a LiveKit access token (HS256 JWT) without any SDK.
export type VoiceGrant = { identity: string; name: string; room: string; ttlSeconds?: number };

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function livekitToken(apiKey: string, apiSecret: string, grant: VoiceGrant, now = Date.now()): Promise<string> {
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

export const ROOMS = ["squad", "gold", "indices"] as const;
export function roomName(squadId: string, room: string): string {
  return `${squadId}:${room}`;
}
