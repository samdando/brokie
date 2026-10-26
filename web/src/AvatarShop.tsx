import { useEffect, useState } from "react";
import { Avatar, refreshAvatars } from "./Avatar";
import { game } from "./game";
interface Item { id: string; name: string; symbol: string; color: string; price: number; owned: boolean }
interface Shop { color?: string | null; balance: number; equipped: string | null; items: Item[] }
export function AvatarShop({ toast }: { toast: (s: string) => void }) {
  const [shop, setShop] = useState<Shop | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = () => game.api.rpc<Shop>("avatar_shop").then(setShop).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);
  async function pick(item: Item | null) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const next = await game.api.rpc<Shop>(item && !item.owned ? "buy_avatar" : "equip_avatar", { p_item: item?.id ?? null });
      setShop(next); refreshAvatars(); toast(item ? `${item.name} equipped` : "Letter avatar equipped");
    } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="stack avatar-shop" data-testid="avatar-shop" style={{ gap: 14 }}>
    <div className="row between"><h2 className="h2">Make it yours</h2><b className="lime mono">{shop ? `${shop.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens` : "…"}</b></div>
    <p className="muted" style={{ margin: 0, fontSize: 12 }}>Start with a free face. Unlock premium avatars with earned tokens. Your look stays with you across seasons.</p>
    {shop && <div className="avatar-grid">{shop.items.map(item => <button key={item.id} className={`avatar-item ${shop.equipped === item.id ? "equipped" : ""}`} disabled={busy || (!item.owned && shop.balance < item.price)} onClick={() => pick(item)} data-testid={`avatar-${item.id}`}>
      <Avatar handle={game.state.me!.handle} symbol={item.symbol} color={shop.color ?? item.color} style={{ width: 48, height: 48, fontSize: 26 }} /><b>{item.name}</b><span>{shop.equipped === item.id ? "Equipped ✓" : item.owned ? "Equip" : item.price === 0 ? "Free" : `${item.price} tokens`}</span>
    </button>)}</div>}
    {shop?.equipped && <button className="text-action muted" disabled={busy} onClick={() => pick(null)}>Use my letter instead</button>}
    {shop && <div className="profile-colours" role="group" aria-label="Profile colour"><span className="muted">Your colour</span>{["#D6FE59", "#73E7C3", "#7CC8FF", "#B5A0FE", "#FF7D8B", "#F2CA73", "#FF9D76", "#F2F5FF"].map(color => <button key={color} style={{ background: color }} aria-label={`Use profile colour ${color}`} aria-pressed={shop.color === color} disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const next = await game.api.rpc<Shop>("set_profile_color", { p_color: color }); setShop(next); refreshAvatars(); toast("Profile colour updated"); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }} />)}</div>}
    {error && <div className="err" role="alert">{error}<button className="text-action lime" onClick={load}>Retry</button></div>}
  </section>;
}
