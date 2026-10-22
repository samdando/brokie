import QRCode from "qrcode";
import { Candle, MARKETS, Trade } from "./types";
import { px, signedMoney } from "./ui";

export function receiptURL(token: string) {
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set("trade", token);
  return url.href;
}

/** Real OHLC history and exact fills; missing history is explicitly labelled. */
export async function drawTradeImage(t: Trade, handle: string, url: string, candles: Candle[] = [], bucketSeconds = 60): Promise<HTMLCanvasElement> {
  const c = document.createElement("canvas"); c.width = 1080; c.height = 1350;
  const g = c.getContext("2d")!;
  const green = "#D6FE59", red = "#FF7D8B", muted = "#969D8D", tint = t.pnl >= 0 ? green : red;
  g.fillStyle = "#0C0E0B"; g.fillRect(0, 0, c.width, c.height);
  const glow = g.createRadialGradient(950, 150, 0, 950, 150, 800); glow.addColorStop(0, tint + "28"); glow.addColorStop(1, "#0C0E0B00"); g.fillStyle = glow; g.fillRect(0, 0, c.width, c.height);
  const text = (s: string, x: number, y: number, size: number, color = "#fff", weight = 600) => { g.fillStyle = color; g.font = `${weight} ${size}px system-ui`; g.fillText(s, x, y); };
  text("brokie.", 72, 130, 68, green, 900); text("PAPER TRADE", 745, 120, 24, muted);
  text(`@${handle}`, 72, 220, 32); text(`${t.side.toUpperCase()} ${MARKETS[t.market].title} ×${t.quantity}`, 72, 330, 48);
  text(MARKETS[t.market].subtitle, 72, 382, 28, muted);
  const result = signedMoney(t.pnl); let fontSize = 116;
  do { g.font = `700 ${fontSize}px system-ui`; if (g.measureText(result).width <= 936) break; fontSize -= 4; } while (fontSize > 32);
  text(result, 65, 535, fontSize, tint, 700);
  const entryTime = Date.parse(t.opened_at ?? "") / 1000;
  const exitTime = Date.parse(t.closed_at) / 1000;
  const bars = candles.filter(b => [b.index,b.open,b.high,b.low,b.close].every(Number.isFinite) && b.index * bucketSeconds <= exitTime + bucketSeconds * 3 && (!Number.isFinite(entryTime) || (b.index + 1) * bucketSeconds >= entryTime - bucketSeconds * 3)).sort((a,b) => a.index - b.index);
  text(bars.length ? "PRICE CANDLES · ENTRY → EXIT" : "PRICE HISTORY UNAVAILABLE · EXACT FILLS BELOW", 72, 625, 23, muted);
  g.strokeStyle = "#2C3028"; g.lineWidth = 2;
  for (const y of [675, 735, 795, 855]) { g.beginPath(); g.moveTo(90, y); g.lineTo(990, y); g.stroke(); }
  if (bars.length) {
    const low = Math.min(t.entry_price,t.exit_price,...bars.map(b => b.low));
    const high = Math.max(t.entry_price,t.exit_price,...bars.map(b => b.high));
    const range = Math.max(high-low, MARKETS[t.market].tick);
    const y = (price: number) => 835 - (price-low)/range*140;
    const start = Math.min(bars[0].index * bucketSeconds, Number.isFinite(entryTime) ? entryTime : exitTime);
    const end = Math.max((bars[bars.length-1].index+1)*bucketSeconds,exitTime);
    const x = (time: number) => 110 + (time-start)/Math.max(bucketSeconds,end-start)*860;
    const width = Math.max(1, Math.min(18, 860*bucketSeconds/Math.max(bucketSeconds,end-start)*0.65));
    for (const b of bars) {
      const cx = x((b.index+0.5)*bucketSeconds);
      g.strokeStyle = g.fillStyle = b.close >= b.open ? green : red;
      g.lineWidth = 2; g.beginPath(); g.moveTo(cx,y(b.high)); g.lineTo(cx,y(b.low)); g.stroke();
      g.fillRect(cx-width/2,Math.min(y(b.open),y(b.close)),width,Math.max(2,Math.abs(y(b.open)-y(b.close))));
    }
    for (const [label,time,price] of [["ENTRY",entryTime,t.entry_price],["EXIT",exitTime,t.exit_price]] as const) {
      if (!Number.isFinite(time)) continue;
      const cx=x(time), cy=y(price);
      g.strokeStyle="#fff"; g.lineWidth=3; g.beginPath(); g.arc(cx,cy,8,0,Math.PI*2); g.stroke();
      const labelY=label === "ENTRY" ? 670 : 875;
      g.beginPath(); g.moveTo(cx,cy+(label === "ENTRY" ? -10 : 10)); g.lineTo(cx,labelY+(label === "ENTRY" ? 5 : -22)); g.stroke();
      text(label,Math.max(90,Math.min(910,cx-30)),labelY,18);
    }
  }
  text(px(t.entry_price), 72, 910, 32); text(px(t.exit_price), 760, 910, 32);
  text("Entry", 72, 950, 22, muted); text("Exit", 760, 950, 22, muted);
  text(new Date(t.closed_at).toLocaleDateString(undefined, {day:"numeric",month:"short",year:"numeric"}),72,1060,28,muted);
  text("Fake money.",72,1140,36); text("Real bragging rights.",72,1190,36);
  text("Scan to check the receipt →",72,1270,26,green);
  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr,url,{width:240,margin:4,errorCorrectionLevel:"M",color:{dark:"#0C0E0B",light:"#FFFFFF"}});
  g.drawImage(qr,768,1020,240,240);
  return c;
}
