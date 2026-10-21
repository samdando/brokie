import { useState } from "react";
import { Button, Eyebrow, Sheet } from "./ui";

const LESSONS = [
  { title: "Up, down, and in the game.", sub: "Long vs short · 1 minute",
    body: "A long position gains when price rises and loses when it falls. A short position does the opposite. Your result depends on how far the price moves, the contract's point value, and how many contracts you hold.",
    q: "You're short NAS. The price drops. What happens?", a: ["Your position gains", "Your position loses", "Nothing changes"], c: 0,
    why: "A short benefits from a lower price. If price rises, the short loses." },
  { title: "A point isn't just a point.", sub: "Contract sizing · 1 minute",
    body: "Brokie uses micro contracts: MNQ (NAS) is $2 per point, MES (ES) is $5, and MGC (Gold) is $10. P&L = price movement × point value × contracts, with the direction reversed for shorts. Two contracts double both gains and losses.",
    q: "One long MNQ rises 10 points. Your gross P&L?", a: ["+$10", "+$20", "+$100"], c: 1, why: "10 points × $2 per point × 1 contract = $20 before costs." },
  { title: "Stay in the game.", sub: "Risk & practice margin · 1 minute",
    body: "Margin is collateral, not your maximum possible loss. Brokie reserves a simplified $1,000 per micro contract; real requirements vary. Smaller positions change your P&L less per point. Fills are instant with no costs, so results won't match real trading.",
    q: "You halve your contracts. Your P&L per point…", a: ["Doubles", "Stays the same", "Halves"], c: 2, why: "Position size scales losses as well as gains. Half the contracts means half the P&L per point." },
];

export function LearnScreen() {
  const [done, setDone] = useState<number[]>(() => { try { return JSON.parse(localStorage.getItem("brokie.lessons") ?? "[]"); } catch { return []; } });
  const [open, setOpen] = useState<number | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const finish = (i: number) => { if (!done.includes(i)) { const d = [...done, i]; setDone(d); localStorage.setItem("brokie.lessons", JSON.stringify(d)); } };
  const l = open !== null ? LESSONS[open] : null;
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div><h1 className="title">{"Less guessing.\nMore getting it."}</h1><div className="muted" style={{ fontSize: 13 }}>Tiny lessons. Fewer expensive habits.</div></div>
      <div className="panel row" style={{ gap: 16 }}>
        <span style={{ width: 48, height: 48, borderRadius: "50%", border: "5px solid var(--line)", borderTopColor: done.length ? "var(--lime)" : "var(--line)", display: "grid", placeItems: "center" }}>⚡</span>
        <div><b style={{ fontSize: 14 }}>Build your market brain</b><div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{done.length} of 3 essentials complete</div></div>
      </div>
      {LESSONS.map((x, i) => (
        <button key={i} className="panel" style={{ textAlign: "left", border: "1px solid var(--line)" }} onClick={() => { setOpen(i); setPick(null); }}>
          <div className="row between"><span className="eyebrow">0{i + 1} / The essentials</span><span className="lime">{done.includes(i) ? "✓" : "↗"}</span></div>
          <div style={{ font: "600 23px var(--round)", letterSpacing: -0.5, margin: "18px 0" }}>{x.title}</div>
          <div className="muted" style={{ fontSize: 12 }}>{x.sub}</div>
        </button>
      ))}
      <Sheet open={!!l} onClose={() => setOpen(null)}>
        {l && <div className="stack" style={{ gap: 20 }}>
          <div className="row between"><Eyebrow>The essentials / 0{open! + 1}</Eyebrow><button className="lime" style={{ fontWeight: 700 }} onClick={() => setOpen(null)}>Done</button></div>
          <h3 className="h3" style={{ fontSize: 28 }}>{l.title}</h3>
          <div className="muted" style={{ fontSize: 15, lineHeight: 1.6 }}>{l.body}</div>
          <div className="sep" />
          <b style={{ fontSize: 17 }}>{l.q}</b>
          {l.a.map((a, i) => (
            <button key={i} className="panel" style={{ padding: 17, borderRadius: 12, textAlign: "left", border: `1px solid ${pick === i ? (i === l.c ? "var(--lime)" : "var(--red)") : "var(--line)"}`, color: pick === i ? (i === l.c ? "var(--lime)" : "var(--red)") : "#fff" }}
              onClick={() => { setPick(i); if (i === l.c) finish(open!); }}>{a}</button>
          ))}
          {pick !== null && <div className={pick === l.c ? "lime" : "red"} style={{ fontSize: 13 }}>{pick === l.c ? `Nailed it. ${l.why}` : "Not quite. Give it another go."}</div>}
          {pick === l.c && <Button onClick={() => setOpen(null)}>Next</Button>}
        </div>}
      </Sheet>
    </div>
  );
}
