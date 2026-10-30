import { useState } from "react";
import { Button, Eyebrow, Sheet } from "./ui";

const LESSONS = [
  { title: "Up, down, and in the game.", sub: "Long vs short · 1 minute",
    body: "A long position gains when price rises and loses when it falls. A short position does the opposite. Your result depends on how far the price moves, the contract's point value, and how many contracts you hold.",
    q: "You're short NAS. The price drops. What happens?", a: ["Your position gains", "Your position loses", "Nothing changes"], c: 0,
    why: "A short benefits from a lower price. If price rises, the short loses." },
  { title: "A point isn't just a point.", sub: "Contract sizing · 1 minute",
    body: "Brokie uses micro contracts: MNQ (NAS) is $2 per point, MES (ES) is $5, MGC (Gold) is $10, and MYM (US30) is $0.50. P&L = price movement × point value × contracts, with the direction reversed for shorts. Two contracts double both gains and losses.",
    q: "One long MNQ rises 10 points. Your gross P&L?", a: ["+$10", "+$20", "+$100"], c: 1, why: "10 points × $2 per point × 1 contract = $20 before costs." },
  { title: "Stay in the game.", sub: "Risk & practice margin · 1 minute",
    body: "Margin is collateral, not your maximum possible loss. Brokie reserves a simplified $1,000 per micro contract; real requirements vary. Smaller positions change your P&L less per point. Fills are instant with no costs, so results won't match real trading.",
    q: "You halve your contracts. Your P&L per point…", a: ["Doubles", "Stays the same", "Halves"], c: 2, why: "Position size scales losses as well as gains. Half the contracts means half the P&L per point." },
];
const LESSON_ACCENTS = ["#A8B8FF", "#91C9EE", "#C6AEEC"];

export function LearnScreen({ goTrade }: { goTrade: () => void }) {
  const [done, setDone] = useState<number[]>(() => { try { const saved: unknown = JSON.parse(localStorage.getItem("brokie.lessons") ?? "[]"); return Array.isArray(saved) ? [...new Set(saved.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < LESSONS.length))] : []; } catch { return []; } });
  const [open, setOpen] = useState<number | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const finish = (i: number) => { if (!done.includes(i)) { const d = [...done, i]; setDone(d); try { localStorage.setItem("brokie.lessons", JSON.stringify(d)); } catch { /* Progress remains available this visit. */ } } };
  const l = open !== null ? LESSONS[open] : null;
  return (
    <div className="stack learn-screen secondary-screen" style={{ gap: 24 }}>
      <div className="page-heading"><Eyebrow>Learn</Eyebrow><h1>A little more edge.</h1><p>Three minutes to get the basics.<br />A whole season to practise.</p></div>
      <section className="learn-progress" aria-label={`${done.length} of ${LESSONS.length} complete`}>
        <div className="row between"><b>{done.length === LESSONS.length ? "The essentials, understood." : "Small lessons. Better decisions."}</b><span>{done.length} / {LESSONS.length}</span></div>
        <div className="learn-progress-track" role="progressbar" aria-label="Lessons complete" aria-valuemin={0} aria-valuemax={LESSONS.length} aria-valuenow={done.length}>{LESSONS.map((_,i) => <i key={i} className={done.length > i ? "complete" : ""} />)}</div>
        <small>{done.length === LESSONS.length ? "Come back for a refresher any time." : "One idea, one quick check. Go at your pace."}</small>
      </section>
      {done.length === LESSONS.length && <Button onClick={goTrade}>Put it into practice →</Button>}
      <section className="lesson-list"><Eyebrow>Your starting point</Eyebrow>{LESSONS.map((x, i) => (
        <button key={i} className="lesson-card" style={{ ["--lesson-accent" as string]: LESSON_ACCENTS[i] }} onClick={() => { setOpen(i); setPick(null); }} data-testid={`lesson-${i}`}>
          <span className={`lesson-number ${done.includes(i) ? "complete" : ""}`}>{done.includes(i) ? "✓" : `0${i+1}`}</span><span><b>{x.title}</b><small>{x.sub}</small></span><span className="lesson-arrow" aria-hidden="true">↗</span>
        </button>
      ))}</section>
      <div className="learn-note"><span aria-hidden="true">↗</span><p>Real prices. Room to learn.<small>Practise the decision before the money is real.</small></p></div>
      <Sheet open={!!l} onClose={() => setOpen(null)}>
        {l && <div className="stack lesson-content" style={{ gap: 20, ["--lesson-accent" as string]: LESSON_ACCENTS[open!] }} data-testid="lesson-content">
          <div className="row between"><Eyebrow>The essentials / 0{open! + 1}</Eyebrow><button className="lime" style={{ fontWeight: 700 }} onClick={() => setOpen(null)}>Done</button></div>
          <h3 className="h3" style={{ fontSize: 28 }}>{l.title}</h3>
          <div className="muted" style={{ fontSize: 15, lineHeight: 1.6 }}>{l.body}</div>
          <div className="sep" />
          <b style={{ fontSize: 17 }}>{l.q}</b>
          {l.a.map((a, i) => (
            <button key={i} className="lesson-answer" aria-pressed={pick === i} style={{ borderColor: pick === i ? (i === l.c ? "var(--lime)" : "var(--red)") : "var(--line)", color: pick === i ? (i === l.c ? "var(--lime)" : "var(--red)") : undefined }}
              onClick={() => { setPick(i); if (i === l.c) finish(open!); }}>{a}</button>
          ))}
          {pick !== null && <div role="status" className={`lesson-result ${pick === l.c ? "lime" : "red"}`}>{pick === l.c ? `That's it. ${l.why}` : "Not quite. Give it another go."}</div>}
          {pick === l.c && <Button onClick={() => { if (open! < LESSONS.length-1) { setOpen(open!+1); setPick(null); } else setOpen(null); }}>{open! < LESSONS.length-1 ? "Next lesson →" : "Essentials complete ✓"}</Button>}
        </div>}
      </Sheet>
    </div>
  );
}
