import type { Market } from "./types";
/** Small original vector illustrations stay crisp on every phone; labels remain readable. */
export function MarketArt({ market }: { market: Market }) {
  const id = `metal-${market}`;
  return <span className={`market-art art-${market}`} aria-hidden="true"><svg viewBox="0 0 64 42" fill="none">
    <defs><linearGradient id={id} x1="10" y1="4" x2="54" y2="42" gradientUnits="userSpaceOnUse"><stop stopColor={market === "gold" ? "#FFF2B1" : "#D7F3FF"}/><stop offset=".5" stopColor={market === "gold" ? "#E9B64C" : "#80AAFF"}/><stop offset="1" stopColor={market === "gold" ? "#9B5D16" : "#5365A5"}/></linearGradient></defs>
    {market === "gold" ? <><path d="M9 27 17 11h28l10 16-7 10H16Z" fill={`url(#${id})`}/><path d="m17 11 5 17h24l-1-17M9 27l13 1-6 9m30-9 9-1-7 10" stroke="#FFF4C1" strokeOpacity=".5"/><text x="32" y="23" textAnchor="middle" fill="#7B4C15" fontSize="9" fontFamily="serif" fontWeight="bold">Au</text></> : ["nas", "es", "us30"].includes(market) ? <>
      <defs><clipPath id={`flag-${market}`}><rect x="6" y="2" width="52" height="38" rx="3" /></clipPath></defs>
      <g clipPath={`url(#flag-${market})`}><rect x="6" y="2" width="52" height="38" fill="#F5F1E8" />
        {Array.from({length:7},(_,i)=><rect key={i} x="6" y={2+i*5.85} width="52" height="2.93" fill="#C64A56" />)}
        <rect x="6" y="2" width="23" height="21" fill="#27456F" />
        {Array.from({length:12},(_,i)=><circle key={i} cx={10+(i%4)*5} cy={6+Math.floor(i/4)*6} r="1" fill="white" />)}
        <rect x="6" y="2" width="52" height="38" fill="#081323" fillOpacity=".22" />
      </g>
      <rect x="6" y="21" width="52" height="19" rx="2" fill="#101720" fillOpacity=".88" />
      <text x="32" y="36" textAnchor="middle" fill="white" fontSize="17" fontFamily="system-ui,sans-serif" fontWeight="650">{market === "nas" ? "100" : market === "es" ? "500" : "30"}</text>
    </> : <><circle cx="32" cy="21" r="18" fill={`url(#${id})`}/><text x="32" y="29" textAnchor="middle" fill="#14233F" fontSize="24" fontFamily="monospace" fontWeight="bold">{market === "btc" ? "₿" : market === "eth" ? "Ξ" : "◎"}</text></>}
  </svg></span>;
}
