import SwiftUI

/// Daily-loss, drawdown and funded meters for the prop challenge.
struct RuleMeters: View {
    let rules: ServerRules
    let equity: Double

    var body: some View {
        let dailyRoom = max(0, equity - rules.dailyFloor), dailyMax = rules.dayStartEquity - rules.dailyFloor
        let ddRoom = max(0, equity - rules.drawdownFloor), ddMax = rules.peakEquity - rules.drawdownFloor
        let progress = min(1, max(0, (equity - rules.startBalance) / max(1, rules.target - rules.startBalance)))
        let df = dailyMax > 0 ? dailyRoom / dailyMax : 0, dd = ddMax > 0 ? ddRoom / ddMax : 0
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                meter("DAILY LEFT · \(Int(rules.dailyLossPct))%", money(dailyRoom, decimals: 0), df, tone(df)).accessibilityIdentifier("meter-daily")
                meter("DD LEFT · \(Int(rules.maxDdPct))%", money(ddRoom, decimals: 0), dd, tone(dd)).accessibilityIdentifier("meter-dd")
                meter("TO FUNDED", rules.funded ? "🏆 Done" : "\(Int(progress * 100))%", rules.funded ? 1 : progress, Ink.gold)
            }
            Text(rules.tradingDays >= rules.qualifyDays ? "✓ Qualified for the season leaderboard"
                 : "\(rules.tradingDays) of \(rules.qualifyDays) trading days to qualify for the leaderboard")
                .font(.system(size: 10)).foregroundStyle(Ink.muted)
        }
    }

    private func tone(_ f: Double) -> Color { f > 0.5 ? Ink.lime : f > 0.2 ? Ink.gold : Ink.red }

    private func meter(_ label: String, _ value: String, _ fraction: Double, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 7, weight: .bold, design: .monospaced)).tracking(0.5).foregroundStyle(Ink.muted).lineLimit(1)
            Text(value).font(.system(size: 13, weight: .bold, design: .monospaced)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.7)
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Ink.line)
                    Capsule().fill(color).frame(width: max(2, g.size.width * fraction))
                }
            }.frame(height: 5)
        }
        .padding(11).frame(maxWidth: .infinity, alignment: .leading)
        .background(Ink.panel, in: RoundedRectangle(cornerRadius: 13))
        .animation(.easeOut(duration: 0.3), value: fraction)
    }
}

/// Locked (daily limit) or REKT (drawdown) banner, with the one-time buy-back.
struct RuleStatusCard: View {
    @EnvironmentObject private var game: OnlineGame
    let rules: ServerRules
    let notify: (String) -> Void
    @State private var busy = false

    var body: some View {
        if rules.isLocked {
            HStack(spacing: 12) {
                Text("🔒").font(.system(size: 26))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Daily loss limit hit.").font(.system(size: 14, weight: .bold))
                    Text("Positions closed. Trading unlocks at midnight Brisbane time.").font(.system(size: 12)).foregroundStyle(Ink.muted)
                }
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(Ink.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Ink.red.opacity(0.35)))
        } else if rules.isBlown {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    Text("💀").font(.system(size: 30)).grayscale(1)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("REKT.").font(.system(size: 17, weight: .heavy))
                        Text("You hit the \(Int(rules.maxDdPct))% max drawdown. Account blown for this season.")
                            .font(.system(size: 12)).foregroundStyle(Ink.muted)
                    }
                }
                if rules.resetsUsed == 0 {
                    Button {
                        busy = true
                        Task {
                            do { try await game.buyBack(); notify("Back in. Tighter rules: 4% daily, 8% drawdown.") }
                            catch { notify(error.localizedDescription) }
                            busy = false
                        }
                    } label: {
                        ZStack {
                            Text("Use your one buy-back (4% / 8% rules)").opacity(busy ? 0 : 1)
                            if busy { ProgressView().tint(Ink.background) }
                        }
                        .font(.system(size: 14, weight: .bold)).frame(maxWidth: .infinity).frame(height: 48)
                        .foregroundStyle(Ink.background).background(Ink.lime, in: RoundedRectangle(cornerRadius: 13))
                    }.disabled(busy).accessibilityIdentifier("buy-back")
                } else {
                    Text("Buy-back used. See you next season.").font(.system(size: 12)).foregroundStyle(Ink.muted)
                }
            }
            .padding(16).background(Color(white: 0.1), in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(white: 0.27)))
        }
    }
}

/// Status chips for leaderboard rows.
struct StatusChips: View {
    let row: LeaderRow
    var body: some View {
        HStack(spacing: 4) {
            if row.status == "blown" { chip("💀 REKT", Color(white: 0.2), Color(white: 0.8)) }
            if row.status == "locked" { chip("🔒 LOCKED", Ink.red.opacity(0.12), Ink.red) }
            if row.funded == true { chip("🏆 FUNDED", Ink.gold.opacity(0.15), Ink.gold) }
            if (row.resetsUsed ?? 0) > 0 && row.status != "blown" { chip("BUY-BACK", Ink.line, Ink.muted) }
        }
    }
    private func chip(_ text: String, _ bg: Color, _ fg: Color) -> some View {
        Text(text).font(.system(size: 7, weight: .heavy, design: .monospaced)).foregroundStyle(fg)
            .padding(.horizontal, 5).padding(.vertical, 3).background(bg, in: Capsule())
    }
}

// MARK: - Chart bubbles

/// A squad mate's trade placed on the chart.
struct PlacedBubble: Identifiable {
    let bubble: ChartBubble
    let point: CGPoint
    let radius: CGFloat
    let pct: Double
    let danger: Bool
    var id: UUID { bubble.id }
}

struct BubbleOverlay: View {
    let placed: [PlacedBubble]
    let exits: [ChartBubbleExit]
    var onTap: (ChartBubble) -> Void

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(placed) { p in
                BubbleView(p: p).position(p.point).onTapGesture { onTap(p.bubble) }
                    .transition(.scale(scale: 0.1).combined(with: .opacity))
            }
            ForEach(exits) { e in ExitBurst(exit: e).position(e.point) }
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.55), value: placed.map(\.id))
    }
}

struct ChartBubbleExit: Identifiable, Equatable {
    let id: UUID
    let handle: String
    let kind: Kind
    let pnl: Double
    let point: CGPoint
    enum Kind { case win, loss, rekt }
}

private struct BubbleView: View {
    let p: PlacedBubble
    @State private var shake = false

    var body: some View {
        let long = p.bubble.side == .long
        let ring = p.danger ? Color(hex: 0xFF3D57) : (long ? Ink.lime : Ink.red)
        ZStack {
            Circle().fill(Ink.panel)
            Circle().stroke(ring, lineWidth: 2)
            Text(String(p.bubble.handle.prefix(1)).uppercased())
                .font(.system(size: p.radius * 0.8, weight: .heavy)).foregroundStyle(p.bubble.isYou ? Ink.lime : .white)
            Text(long ? "▲" : "▼").font(.system(size: 8)).foregroundStyle(ring).offset(x: p.radius * 0.85, y: -p.radius * 0.85)
            Text("\(p.pct >= 0 ? "+" : "−")\(String(format: "%.2f", abs(p.pct)))%")
                .font(.system(size: 7, weight: .bold, design: .monospaced)).foregroundStyle(p.pct >= 0 ? Ink.lime : Ink.red)
                .padding(.horizontal, 3).background(Ink.background.opacity(0.85), in: RoundedRectangle(cornerRadius: 4))
                .fixedSize().offset(y: p.radius + 8)
        }
        .frame(width: p.radius * 2, height: p.radius * 2)
        .shadow(color: ring.opacity(0.35), radius: 6)
        .offset(x: shake ? -2 : 0)
        .onAppear {
            if p.danger { withAnimation(.easeInOut(duration: 0.12).repeatForever(autoreverses: true)) { shake = true } }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(p.bubble.handle) \(p.bubble.side.rawValue) \(p.bubble.quantity)")
        .accessibilityIdentifier("bubble")
    }
}

private struct ExitBurst: View {
    let exit: ChartBubbleExit
    @State private var go = false

    var body: some View {
        let color: Color = exit.kind == .win ? Ink.lime : exit.kind == .loss ? Ink.red : Color(white: 0.6)
        ZStack {
            if exit.kind == .win {
                ForEach(0..<12, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 1).fill(i % 3 == 0 ? .white : (i % 4 == 0 ? Ink.gold : Ink.lime))
                        .frame(width: 5, height: 5)
                        .offset(y: go ? -CGFloat(26 + (i % 3) * 10) : 0).rotationEffect(.degrees(Double(i) * 30))
                        .opacity(go ? 0 : 1)
                }
            }
            Circle().fill(Ink.panel).overlay(Circle().stroke(color, lineWidth: 2))
                .overlay(Text(exit.kind == .rekt ? "💀" : String(exit.handle.prefix(1)).uppercased()).font(.system(size: 11, weight: .heavy)))
                .frame(width: 26, height: 26)
                .grayscale(exit.kind == .rekt ? 1 : 0)
                .scaleEffect(go ? (exit.kind == .win ? 0.01 : 0.3) : 1)
                .rotationEffect(.degrees(go && exit.kind == .rekt ? 25 : 0))
                .offset(y: go && exit.kind == .rekt ? 110 : 0)
                .opacity(go ? (exit.kind == .loss ? 0.3 : 0) : 1)
            Text(exit.kind == .rekt ? "💀 REKT" : "\(exit.pnl >= 0 ? "+" : "−")$\(Int(abs(exit.pnl)))\(exit.pnl >= 0 ? " 🚀" : "")")
                .font(.system(size: 11, weight: .heavy, design: .monospaced)).foregroundStyle(color).fixedSize()
                .offset(y: go ? -32 : -18).opacity(go ? 0 : 1)
        }
        .onAppear { withAnimation(.easeOut(duration: 1.6)) { go = true } }
        .allowsHitTesting(false)
    }
}

/// Details sheet when a bubble is tapped.
struct BubbleSheet: View {
    let bubble: ChartBubble
    let market: Market
    let quote: Double
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let pnl = (quote - bubble.entryPrice) * market.pointValue * Double(bubble.quantity) * bubble.side.direction
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Text(String(bubble.handle.prefix(1)).uppercased()).font(.system(size: 16, weight: .bold))
                    .frame(width: 46, height: 46).background(Ink.panel, in: Circle())
                    .overlay(Circle().stroke(bubble.side == .long ? Ink.lime : Ink.red, lineWidth: 2))
                VStack(alignment: .leading, spacing: 3) {
                    Text(bubble.isYou ? "You" : "@\(bubble.handle)").font(.system(size: 18, weight: .bold))
                    Text("\(bubble.side == .long ? "Long ▲" : "Short ▼") \(market.title) × \(bubble.quantity)").font(.system(size: 12)).foregroundStyle(Ink.muted)
                }
            }
            detailRow("Entry", BrokieChart.format(bubble.entryPrice))
            detailRow("Open P&L", signedMoney(pnl))
            detailRow("Size", String(format: "%.1f%% of account", bubble.sizePct ?? 0))
            if let eq = bubble.equity, let floor = bubble.ddFloor { detailRow("Drawdown room left", money(eq - floor, decimals: 0)) }
            Spacer()
        }
        .padding(26).padding(.top, 10).background(Ink.background).foregroundStyle(.white)
    }
}
