import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { nativeApp } from "./config";

/** Pure donations: a gift to help run Brokie. No perks, prizes or boosts of any kind.
 *  Web only, never shown in the iOS app (App Store rules on crypto tips). */
const WALLETS = {
  sol: { label: "SOL", network: "Solana", address: "7KgR7QTeZpfzSfcqyaSq6NTguAddTfZC1w5moYvW4YQB" },
  eth: { label: "ETH", network: "Ethereum", address: "0xa15ca4b9f44FC9cd478d331eC4DADADfe5592128" },
} as const;
type Chain = keyof typeof WALLETS;

const middle = (a: string) => (a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

export function DonateCard() {
  const [chain, setChain] = useState<Chain>("sol");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();
  const w = WALLETS[chain];
  useEffect(() => {
    let live = true;
    QRCode.toString(w.address, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0C1220", light: "#FFFFFF" } })
      .then((svg) => { if (live) setQr(svg); }).catch(() => { if (live) setQr(""); });
    return () => { live = false; };
  }, [w.address]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (nativeApp) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(w.address); } catch { /* clipboard blocked; address is selectable */ }
    setCopied(true); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <section className="donate-card" data-testid="donate-card" aria-label="Support Brokie">
      <div className="donate-head">
        <span className="donate-heart" aria-hidden="true">♥</span>
        <span className="donate-text"><b>Support Brokie</b><small>Brokie is free. Tips help pay for servers.</small></span>
      </div>
      <div className="seg donate-seg" role="tablist" aria-label="Donation wallet">
        {(Object.keys(WALLETS) as Chain[]).map((c) => (
          <button key={c} role="tab" aria-selected={chain === c} className={chain === c ? "on" : ""} onClick={() => { setChain(c); setCopied(false); }} data-testid={`donate-tab-${c}`}>{WALLETS[c].label}</button>
        ))}
      </div>
      <div className="donate-body" role="tabpanel">
        <div className="donate-qr" aria-label={`QR code for the ${w.network} address`} role="img" data-testid="donate-qr" dangerouslySetInnerHTML={{ __html: qr }} />
        <div className="donate-side">
          <span className="eyebrow">{w.network} address</span>
          <span className="donate-address mono" title={w.address} data-testid="donate-address">{middle(w.address)}</span>
          <button type="button" className={`donate-copy ${copied ? "done" : ""}`} onClick={copy} data-testid="donate-copy">{copied ? "Copied ✓" : "Copy address"}</button>
          <small className="donate-note">Send {w.label} on {w.network} only.</small>
        </div>
      </div>
      <small className="donate-fine">Donations are gifts: no perks, prizes or boosts.</small>
      <span className="sr-only" role="status" aria-live="polite">{copied ? "Address copied" : ""}</span>
    </section>
  );
}
