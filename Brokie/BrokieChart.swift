import SwiftUI
import Charts

/// Chart style the player picked. Saved between launches.
enum PriceChartStyle: String, CaseIterable, Identifiable {
    case candles, line
    var id: String { rawValue }
    var icon: String { self == .candles ? "chart.bar.fill" : "chart.xyaxis.line" }
    var title: String { self == .candles ? "Candles" : "Line" }
}

/// Candle size in ticks. Simulated ticks arrive every 1.5 s, so the labels are
/// the wall-clock length of one candle in the simulator.
enum CandleFrame: Int, CaseIterable, Identifiable {
    case fast = 4, medium = 10, slow = 20
    var id: Int { rawValue }
    var label: String { switch self { case .fast: "6s"; case .medium: "15s"; case .slow: "30s" } }
    /// With live server prices, candles are wall-clock buckets instead.
    var liveSeconds: Int { switch self { case .fast: 60; case .medium: 300; case .slow: 900 } }
    var liveLabel: String { switch self { case .fast: "1m"; case .medium: "5m"; case .slow: "15m" } }
}

/// The plain-language read of where price sits against its 20-bar average.
/// It's a moving average, not a signal, and the chart says so.
enum ChartVibe {
    case sending, dumping, chop
    var label: String { switch self { case .sending: "SENDING IT"; case .dumping: "DUMPING"; case .chop: "CHOP" } }
    var icon: String { switch self { case .sending: "flame.fill"; case .dumping: "arrow.down.to.line"; case .chop: "water.waves" } }
    var color: Color { switch self { case .sending: Ink.lime; case .dumping: Ink.red; case .chop: Ink.muted } }
}

/// One horizontal marker for an open position in the charted market.
struct ChartEntryLine: Identifiable {
    let id: UUID
    let price: Double
    let side: TradeSide
    let quantity: Int
    let pnl: Double
}

/// The Brokie price chart: candles or a line, the 20-bar average, your entry
/// lines, a live price tag, and press-and-drag to read any bar.
struct BrokieChart: View {
    let market: Market
    let candles: [Candle]
    let quote: Double
    let entries: [ChartEntryLine]
    let style: PriceChartStyle

    @State private var selectedIndex: Int?

    private struct AveragePoint: Identifiable {
        let index: Int
        let value: Double
        var id: Int { index }
    }

    private static let averageLength = 20
    private static let rightPadding = 6

    var body: some View {
        let ema = Self.ema(candles.map(\.close), length: Self.averageLength)
        let domain = yDomain
        let bodyEpsilon = (domain.upperBound - domain.lowerBound) * 0.004
        let selected = selectedIndex.flatMap { index in candles.first { $0.index == index } }
        let averagePoints = zip(candles, ema).map { AveragePoint(index: $0.index, value: $1) }

        VStack(alignment: .leading, spacing: 10) {
            readout(selected: selected, ema: ema)
            GeometryReader { geometry in
                let slots = max(1, candles.count + Self.rightPadding)
                let barWidth = max(2, min(10, geometry.size.width / CGFloat(slots) * 0.62))
                Chart {
                    if style == .line {
                        ForEach(candles) { candle in
                            LinePriceMarks(candle: candle, floor: domain.lowerBound, color: market.color)
                        }
                    } else {
                        ForEach(candles) { candle in
                            CandleMarks(candle: candle, width: barWidth, minimumBody: bodyEpsilon)
                        }
                    }
                    ForEach(averagePoints) { point in
                        LineMark(x: .value("Bar", point.index), y: .value("Average", point.value), series: .value("Series", "average"))
                            .foregroundStyle(Color.white.opacity(0.28))
                            .lineStyle(StrokeStyle(lineWidth: 1.2, dash: [2, 3]))
                            .interpolationMethod(.monotone)
                    }
                    ForEach(entries) { entry in
                        EntryLineMark(entry: entry)
                    }
                    QuoteLineMark(quote: quote, color: market.color)
                    if let selected {
                        RuleMark(x: .value("Selected", selected.index))
                            .foregroundStyle(Color.white.opacity(0.35))
                            .lineStyle(StrokeStyle(lineWidth: 1))
                    }
                }
                .chartXScale(domain: xDomain)
                .chartYScale(domain: domain)
                .chartXAxis(.hidden)
                .chartYAxis {
                    AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                        AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [3, 5])).foregroundStyle(Ink.line)
                        AxisValueLabel {
                            if let number = value.as(Double.self) {
                                Text(Self.format(number, decimals: market == .gold ? 1 : 0))
                                    .font(.system(size: 8, weight: .medium, design: .monospaced))
                                    .foregroundStyle(Ink.muted)
                            }
                        }
                    }
                }
                .chartXSelection(value: $selectedIndex)
                .chartPlotStyle { plot in plot.clipped() }
                .animation(.easeOut(duration: 0.25), value: candles.last?.close)
            }
        }
        .sensoryFeedback(.selection, trigger: selectedIndex)
    }

    // MARK: Readout

    @ViewBuilder
    private func readout(selected: Candle?, ema: [Double]) -> some View {
        if let selected {
            HStack(spacing: 10) {
                ohlc("O", selected.open)
                ohlc("H", selected.high)
                ohlc("L", selected.low)
                ohlc("C", selected.close)
                Spacer(minLength: 0)
                Text(Self.signedPoints(selected.close - selected.open))
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundStyle(selected.isUp ? Ink.lime : Ink.red)
            }
            .frame(height: 20)
            .accessibilityElement(children: .combine)
        } else {
            let vibe = Self.vibe(closes: candles.map(\.close), ema: ema)
            HStack(spacing: 8) {
                HStack(spacing: 4) {
                    Image(systemName: vibe.icon).font(.system(size: 8, weight: .bold))
                    Text(vibe.label).font(.system(size: 8, weight: .heavy, design: .monospaced)).tracking(0.6)
                }
                .foregroundStyle(vibe.color)
                .padding(.horizontal, 7).padding(.vertical, 4)
                .background(vibe.color.opacity(0.12), in: Capsule())
                .accessibilityLabel("Trend versus 20 bar average: \(vibe.label.lowercased())")
                Text("vs 20-bar avg").font(.system(size: 9)).foregroundStyle(Ink.muted)
                Spacer(minLength: 0)
                if let high = candles.map(\.high).max(), let low = candles.map(\.low).min() {
                    Text("H \(Self.format(high))  L \(Self.format(low))")
                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                        .foregroundStyle(Ink.muted)
                }
            }
            .frame(height: 20)
        }
    }

    private func ohlc(_ label: String, _ value: Double) -> some View {
        HStack(spacing: 3) {
            Text(label).foregroundStyle(Ink.muted)
            Text(Self.format(value)).foregroundStyle(.white)
        }
        .font(.system(size: 9, weight: .semibold, design: .monospaced))
        .lineLimit(1).minimumScaleFactor(0.7)
    }

    // MARK: Scales

    private var xDomain: ClosedRange<Int> {
        let first = candles.first?.index ?? 0
        let last = candles.last?.index ?? 1
        return (first - 1)...(last + Self.rightPadding)
    }

    /// Fits the bars, the live quote and any entry lines, with breathing room.
    private var yDomain: ClosedRange<Double> {
        var low = candles.map(\.low).min() ?? quote
        var high = candles.map(\.high).max() ?? quote
        low = min(low, quote); high = max(high, quote)
        for entry in entries { low = min(low, entry.price); high = max(high, entry.price) }
        let span = max(high - low, market.tickSize * 8)
        return (low - span * 0.08)...(high + span * 0.12)
    }

    // MARK: Helpers

    static func ema(_ values: [Double], length: Int) -> [Double] {
        guard let first = values.first else { return [] }
        let k = 2 / (Double(length) + 1)
        var current = first
        return values.map { value in
            current = value * k + current * (1 - k)
            return current
        }
    }

    static func vibe(closes: [Double], ema: [Double]) -> ChartVibe {
        guard closes.count >= 6, let close = closes.last, let average = ema.last else { return .chop }
        let slope = average - ema[ema.count - 6]
        let spread = (closes.max()! - closes.min()!) * 0.06
        if close > average + spread && slope > 0 { return .sending }
        if close < average - spread && slope < 0 { return .dumping }
        return .chop
    }

    static func format(_ value: Double, decimals: Int = 2) -> String {
        value.formatted(.number.precision(.fractionLength(decimals)).grouping(.never))
    }

    static func signed(_ amount: Double) -> String {
        (amount >= 0 ? "+$" : "−$") + abs(amount).formatted(.number.precision(.fractionLength(0)))
    }

    static func signedPoints(_ points: Double) -> String {
        (points >= 0 ? "+" : "−") + format(abs(points)) + " pts"
    }
}

// MARK: - Chart marks (split out to keep the chart body quick to type-check)

private struct CandleMarks: ChartContent {
    let candle: Candle
    let width: CGFloat
    let minimumBody: Double

    var body: some ChartContent {
        let tint = candle.isUp ? Ink.lime : Ink.red
        let bottom = min(candle.open, candle.close)
        let top = max(max(candle.open, candle.close), bottom + minimumBody)
        RuleMark(x: .value("Bar", candle.index), yStart: .value("Low", candle.low), yEnd: .value("High", candle.high))
            .foregroundStyle(tint.opacity(0.75))
            .lineStyle(StrokeStyle(lineWidth: 1.2))
        RectangleMark(x: .value("Bar", candle.index), yStart: .value("Body low", bottom), yEnd: .value("Body high", top),
                      width: .fixed(width))
            .foregroundStyle(tint)
            .cornerRadius(1.5)
    }
}

private struct LinePriceMarks: ChartContent {
    let candle: Candle
    let floor: Double
    let color: Color

    var body: some ChartContent {
        AreaMark(x: .value("Bar", candle.index), yStart: .value("Floor", floor), yEnd: .value("Close", candle.close))
            .foregroundStyle(LinearGradient(colors: [color.opacity(0.22), color.opacity(0.0)], startPoint: .top, endPoint: .bottom))
            .interpolationMethod(.monotone)
        LineMark(x: .value("Bar", candle.index), y: .value("Close", candle.close), series: .value("Series", "price"))
            .foregroundStyle(color)
            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            .interpolationMethod(.monotone)
    }
}

private struct EntryLineMark: ChartContent {
    let entry: ChartEntryLine

    var body: some ChartContent {
        let tint = entry.side == .long ? Ink.lime : Ink.red
        RuleMark(y: .value("Entry", entry.price))
            .foregroundStyle(tint.opacity(0.7))
            .lineStyle(StrokeStyle(lineWidth: 1, dash: [5, 4]))
            .annotation(position: .top, alignment: .leading, spacing: 2) {
                Text("\(entry.side == .long ? "LONG" : "SHORT") \(entry.quantity) · \(BrokieChart.signed(entry.pnl))")
                    .font(.system(size: 8, weight: .heavy, design: .monospaced))
                    .foregroundStyle(tint)
                    .padding(.horizontal, 5).padding(.vertical, 2)
                    .background(Ink.background.opacity(0.85), in: Capsule())
            }
    }
}

private struct QuoteLineMark: ChartContent {
    let quote: Double
    let color: Color

    var body: some ChartContent {
        RuleMark(y: .value("Price", quote))
            .foregroundStyle(color.opacity(0.5))
            .lineStyle(StrokeStyle(lineWidth: 1, dash: [1, 3]))
            .annotation(position: .overlay, alignment: .trailing) {
                Text(BrokieChart.format(quote))
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundStyle(Ink.background)
                    .padding(.horizontal, 6).padding(.vertical, 3)
                    .background(color, in: RoundedRectangle(cornerRadius: 5))
            }
    }
}

/// A compact chip row for picking chart style and candle size.
struct PriceChartControls: View {
    @Binding var style: PriceChartStyle
    @Binding var frame: CandleFrame
    let tint: Color
    var isLive = false

    var body: some View {
        HStack(spacing: 6) {
            ForEach(PriceChartStyle.allCases) { option in
                Button { style = option } label: {
                    Image(systemName: option.icon).font(.system(size: 10, weight: .bold))
                        .frame(width: 30, height: 24)
                        .foregroundStyle(style == option ? Ink.background : Ink.muted)
                        .background(style == option ? tint : Ink.background, in: RoundedRectangle(cornerRadius: 7))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(option.title) chart")
                .accessibilityAddTraits(style == option ? .isSelected : [])
                .accessibilityIdentifier("chart-style-\(option.rawValue)")
            }
            Rectangle().fill(Ink.line).frame(width: 1, height: 16).padding(.horizontal, 3)
            ForEach(CandleFrame.allCases) { option in
                Button { frame = option } label: {
                    Text(isLive ? option.liveLabel : option.label).font(.system(size: 9, weight: .bold, design: .monospaced))
                        .frame(width: 34, height: 24)
                        .foregroundStyle(frame == option ? .white : Ink.muted)
                        .background(frame == option ? Ink.line : Ink.background, in: RoundedRectangle(cornerRadius: 7))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(isLive ? option.liveLabel : option.label) candles")
                .accessibilityAddTraits(frame == option ? .isSelected : [])
                .accessibilityIdentifier("chart-frame-\(option.rawValue)")
            }
            Spacer(minLength: 0)
        }
    }
}
