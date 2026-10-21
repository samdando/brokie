import QRCode from "qrcode";
import { MARKETS, Trade } from "./types";
import { px, signedMoney } from "./ui";

export function receiptURL(token: string) {
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set("trade", token);
  return url.href;
}

/** Exact fill prices, not an invented candle history. The QR resolves to a saved server receipt. */
export async function drawTradeImage(t: Trade, handle: string, url: string): Promise<HTMLCanvasElement> {
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
  text("YOUR FILLS · ENTRY → EXIT", 72, 625, 23, muted);
  // A two-point fill diagram is intentionally labelled; it doesn't imply historical intratrade prices.
  const entryY = t.entry_price === t.exit_price ? 755 : t.exit_price > t.entry_price ? 790 : 700;
  const exitY = t.entry_price === t.exit_price ? 755 : t.exit_price > t.entry_price ? 700 : 790;
  g.strokeStyle = "#2C3028"; g.lineWidth = 2;
  for (const y of [675, 735, 795, 855]) { g.beginPath(); g.moveTo(90, y); g.lineTo(990, y); g.stroke(); }
  g.strokeStyle = tint; g.lineWidth = 5; g.setLineDash([10, 9]); g.beginPath(); g.moveTo(170, entryY); g.lineTo(910, exitY); g.stroke(); g.setLineDash([]);
  for (const [x,y] of [[170,entryY],[910,exitY]]) { g.fillStyle = tint; g.beginPath(); g.arc(x,y,11,0,Math.PI*2); g.fill(); }
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
