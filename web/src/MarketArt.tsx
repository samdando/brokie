import type { Market } from "./types";
/** Small original vector illustrations stay crisp on every phone; labels remain readable. */
export function MarketArt({ market }: { market: Market }) {
  const id = `metal-${market}`;
  return <span className={`market-art art-${market}`} aria-hidden="true"><svg viewBox="0 0 64 42" fill="none">
    <defs><linearGradient id={id} x1="10" y1="4" x2="54" y2="42" gradientUnits="userSpaceOnUse"><stop stopColor={market === "gold" ? "#FFF2B1" : "#D7F3FF"}/><stop offset=".5" stopColor={market === "gold" ? "#E9B64C" : "#80AAFF"}/><stop offset="1" stopColor={market === "gold" ? "#9B5D16" : "#5365A5"}/></linearGradient></defs>
    {market === "gold" ? <><path d="M9 27 17 11h28l10 16-7 10H16Z" fill={`url(#${id})`}/><path d="m17 11 5 17h24l-1-17M9 27l13 1-6 9m30-9 9-1-7 10" stroke="#FFF4C1" strokeOpacity=".5"/><path d="m26 18 3-3h8l3 5-2 3h-9Z" stroke="#7B4C15" strokeWidth="1.5"/></> : market === "nas" ? <><path d="M9 34V20h9v14m5 0V12h9v22m5 0V5h9v29" fill={`url(#${id})`}/><path d="m9 15 15-9 11 4L53 2m-7 0h7v7" stroke="#A7E7FF" strokeWidth="2.5" strokeLinecap="round"/></> : market === "es" ? <><path d="M7 18 31 4l25 14H7Zm6 17h38M8 39h48M16 20v12m10-12v12m11-12v12m10-12v12" stroke={`url(#${id})`} strokeWidth="4" strokeLinejoin="round"/><circle cx="31" cy="13" r="3" fill="#DFEDFF"/></> : market === "us30" ? <><path d="M10 37V19l12-7v25m4 0V6l13-3v34m4 0V16l11 5v16" fill={`url(#${id})`}/><path d="M15 24h3m-3 6h3m13-18h3m-3 7h3m-3 7h3m14 1h3" stroke="#F1F5FF" strokeWidth="2"/></> : <><circle cx="32" cy="21" r="18" fill={`url(#${id})`}/><text x="32" y="29" textAnchor="middle" fill="#14233F" fontSize="24" fontFamily="monospace" fontWeight="bold">{market === "btc" ? "₿" : market === "eth" ? "Ξ" : "◎"}</text></>}
  </svg></span>;
}
