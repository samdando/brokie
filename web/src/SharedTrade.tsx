import { useEffect, useState } from "react";
import { game } from "./game";
import type { Trade } from "./types";
import { drawTradeImage, receiptURL } from "./TradeImage";
import { signedMoney } from "./ui";

export function SharedTradePage({ token }: { token: string }) {
  const [data, setData] = useState<{handle: string; trade: Trade} | null>(null);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError(""); setData(null); setImage("");
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token)) { setError("That receipt link is invalid."); return; }
    game.api.publicRPC<{handle: string; trade: Trade} | null>("shared_trade", {p_token: token}).then(async result => {
      if (!result) throw new Error("This shared receipt is no longer available.");
      const canvas = await drawTradeImage(result.trade,result.handle,receiptURL(token));
      if (live) { setData(result); setImage(canvas.toDataURL("image/png")); }
    }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [token, attempt]);
  const profile = new URL(location.origin + location.pathname);
  if (data) profile.searchParams.set("player",data.handle);
  return <main className="app stack shared-receipt">
    <div className="wordmark">brokie<i /></div>
    <h1 className="h3">The receipt.</h1>
    <p className="muted">Saved paper-trade result · no real money</p>
    {error ? <div className="panel"><p role="alert">{error}</p><button className="text-action lime" onClick={() => setAttempt(x=>x+1)}>Retry</button></div> : !data ? <span className="spinner lime" aria-label="Loading receipt" /> : <>
      <img src={image} className="card-preview" alt={`@${data.handle}: ${data.trade.side} ${data.trade.quantity} ${data.trade.market}, ${signedMoney(data.trade.pnl)}. Entry ${data.trade.entry_price}, exit ${data.trade.exit_price}.`} />
      <a className="big-btn lime" href={profile.href}>View @{data.handle}’s profile →</a>
      <div className="muted">A Brokie account is needed to browse player profiles.</div>
    </>}
    <a className="text-action lime" href={location.pathname}>Open Brokie →</a>
  </main>;
}
