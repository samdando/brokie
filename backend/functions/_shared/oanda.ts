// Maps an OANDA /pricing response to Brokie quotes (mid of best bid/ask).
export const INSTRUMENTS: Record<string, "gold" | "nas" | "es" | "us30"> = {
  XAU_USD: "gold",
  NAS100_USD: "nas",
  SPX500_USD: "es",
  US30_USD: "us30",
};

export type BrokieQuote = { market: "gold" | "nas" | "es" | "us30"; price: number; quoted_at: string; source: string };

type OandaPrice = {
  instrument?: string;
  time?: string;
  status?: string;
  tradeable?: boolean;
  bids?: { price: string }[];
  asks?: { price: string }[];
};

export function toQuotes(payload: { prices?: OandaPrice[] }): BrokieQuote[] {
  const out: BrokieQuote[] = [];
  for (const p of payload?.prices ?? []) {
    const market = p.instrument ? INSTRUMENTS[p.instrument] : undefined;
    if (!market) continue;
    const tradeable = p.status ? p.status === "tradeable" : p.tradeable !== false;
    if (!tradeable) continue;
    const bid = Number(p.bids?.[0]?.price);
    const ask = Number(p.asks?.[0]?.price);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) continue;
    const when = p.time ? new Date(p.time) : new Date();
    if (Number.isNaN(when.getTime())) continue;
    out.push({ market, price: (bid + ask) / 2, quoted_at: when.toISOString(), source: "oanda" });
  }
  return out;
}
