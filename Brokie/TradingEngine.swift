import Foundation
import Combine

enum Market: String, Codable, CaseIterable, Identifiable {
    case gold, nas, es

    var id: String { rawValue }
    var title: String {
        switch self { case .gold: return "Gold"; case .nas: return "NAS"; case .es: return "ES" }
    }
    var subtitle: String {
        switch self { case .gold: return "Micro Gold"; case .nas: return "Micro Nasdaq-100"; case .es: return "Micro S&P 500" }
    }
    var symbol: String {
        switch self { case .gold: return "MGC"; case .nas: return "MNQ"; case .es: return "MES" }
    }
    var initialPrice: Double {
        switch self { case .gold: return 2728.4; case .nas: return 20486.25; case .es: return 5872.5 }
    }
    var tickSize: Double { self == .gold ? 0.1 : 0.25 }
    var pointValue: Double {
        switch self { case .gold: return 10; case .nas: return 2; case .es: return 5 }
    }
}

enum TradeSide: String, Codable, CaseIterable {
    case long, short
    var title: String { rawValue.capitalized }
    var direction: Double { self == .long ? 1 : -1 }
}

struct Position: Identifiable, Codable {
    let id: UUID
    let market: Market
    let side: TradeSide
    let quantity: Int
    let entryPrice: Double
    let openedAt: Date
}

/// One OHLC bar built from consecutive ticks. `index` is an absolute bucket
/// number, so bars stay put as the rolling history window slides.
struct Candle: Identifiable, Equatable {
    let index: Int
    let open: Double
    let high: Double
    let low: Double
    let close: Double
    var id: Int { index }
    var isUp: Bool { close >= open }
}

/// Where quotes come from. Only `.live` accepts `ingestLiveQuote`; the synthetic
/// ticker stops while a live feed is connected.
enum QuoteSource: Equatable {
    case simulated
    case live(provider: String)

    var badge: String {
        switch self {
        case .simulated: return "SIMULATED"
        case .live(let provider): return "LIVE · \(provider.uppercased())"
        }
    }
}

struct ClosedTrade: Identifiable, Codable {
    let id: UUID
    let market: Market
    let side: TradeSide
    let quantity: Int
    let entryPrice: Double
    let exitPrice: Double
    let pnl: Double
    let closedAt: Date
}

/// A fully local practice engine. Prices are synthetic, fills are immediate,
/// and the fixed $1,000 margin is a game rule, not an exchange requirement.
@MainActor
final class TradingEngine: ObservableObject {
    nonisolated static let startingBalance: Double = 10_000
    nonisolated static let marginPerContract: Double = 1_000
    nonisolated static let storageKey = "brokie.practice.v1"
    /// Rolling tick window kept per market (about six minutes at 1.5 s ticks).
    nonisolated static let historyLimit = 240
    /// Live quotes older than this are refused rather than filled against.
    nonisolated static let maxQuoteAge: TimeInterval = 10

    @Published var selectedMarket: Market = .nas
    @Published private(set) var quotes: [Market: Double] = [:]
    @Published private(set) var histories: [Market: [Double]] = [:]
    @Published private(set) var positions: [Position] = []
    @Published private(set) var closedTrades: [ClosedTrade] = []
    @Published private(set) var balance: Double = startingBalance
    @Published private(set) var realizedPnL: Double = 0
    @Published private(set) var protectionCredit: Double = 0
    @Published private(set) var liquidationCount = 0
    @Published private(set) var quoteSource: QuoteSource = .simulated
    /// Total ticks ever appended per market; anchors candle buckets.
    @Published private(set) var tickCounts: [Market: Int] = [:]

    private let storage: UserDefaults?
    private var randomState: UInt64 = 0xB0C1_E123
    /// When true the server owns balances, fills and liquidation; this engine
    /// only mirrors server state for display and never persists locally.
    let serverAuthoritative: Bool

    var unrealizedPnL: Double { positions.reduce(0) { $0 + pnl(for: $1) } }
    var equity: Double { max(0, balance + unrealizedPnL) }
    var usedMargin: Double { Double(positions.reduce(0) { $0 + $1.quantity }) * Self.marginPerContract }
    var availableMargin: Double { max(0, equity - usedMargin) }
    var totalTrades: Int { closedTrades.count }
    /// Percentage from 0 to 100; breakeven trades count as non-wins.
    var winRate: Double {
        guard !closedTrades.isEmpty else { return 0 }
        return Double(closedTrades.filter { $0.pnl > 0 }.count) / Double(closedTrades.count) * 100
    }

    init(storage: UserDefaults? = .standard, serverAuthoritative: Bool = false) {
        self.storage = serverAuthoritative ? nil : storage
        self.serverAuthoritative = serverAuthoritative
        seedMarkets()
        if let data = storage?.data(forKey: Self.storageKey),
           let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data),
           snapshot.isValid {
            balance = snapshot.balance
            realizedPnL = balance - Self.startingBalance
            protectionCredit = snapshot.protectionCredit
            positions = snapshot.positions
            closedTrades = snapshot.closedTrades
            quotes = snapshot.quotes
            histories = snapshot.histories
            selectedMarket = snapshot.selectedMarket
            randomState = snapshot.randomState
            liquidationCount = snapshot.liquidationCount
            if let counts = snapshot.tickCounts {
                for market in Market.allCases {
                    tickCounts[market] = max(counts[market] ?? 0, histories[market]?.count ?? 0)
                }
            } else {
                for market in Market.allCases { tickCounts[market] = histories[market]?.count ?? 0 }
            }
            liquidateIfNeeded()
        }
    }

    func pnl(for position: Position) -> Double {
        let mark = quotes[position.market] ?? position.entryPrice
        return (mark - position.entryPrice) * position.market.pointValue * Double(position.quantity) * position.side.direction
    }

    /// Returns an explanation on rejection, nil on success.
    @discardableResult
    func openPosition(side: TradeSide, quantity: Int) -> String? {
        guard (1...3).contains(quantity) else { return "Choose 1, 2, or 3 contracts." }
        let required = Double(quantity) * Self.marginPerContract
        guard availableMargin + 0.000_001 >= required else {
            return "Not enough practice buying power. Close a position or choose fewer contracts."
        }
        guard let price = quotes[selectedMarket], price.isFinite, price > 0 else {
            return "This market has no valid quote yet."
        }
        positions.append(Position(id: UUID(), market: selectedMarket, side: side, quantity: quantity, entryPrice: price, openedAt: Date()))
        persist()
        return nil
    }

    func closePosition(id: UUID) {
        guard let index = positions.firstIndex(where: { $0.id == id }) else { return }
        settlePosition(at: index)
        liquidateIfNeeded()
        realizedPnL = balance - Self.startingBalance
        persist()
    }

    /// Groups the rolling tick history into OHLC candles of `ticksPerCandle` ticks.
    /// Buckets are aligned to the absolute tick count so finished candles never
    /// change; a partial leading bucket cut off by the window is dropped.
    func candles(for market: Market, ticksPerCandle: Int) -> [Candle] {
        let size = max(1, ticksPerCandle)
        let values = histories[market] ?? []
        guard !values.isEmpty else { return [] }
        let firstAbsolute = (tickCounts[market] ?? values.count) - values.count
        var result: [Candle] = []
        var bucket: Int?
        var open = 0.0, high = 0.0, low = 0.0, close = 0.0, count = 0
        func flush() {
            guard let bucket else { return }
            result.append(Candle(index: bucket, open: open, high: high, low: low, close: close))
        }
        for (offset, value) in values.enumerated() {
            let absolute = firstAbsolute + offset
            let current = absolute / size
            if current != bucket {
                flush()
                bucket = current
                open = value; high = value; low = value; close = value
                count = 0
            }
            high = max(high, value); low = min(low, value); close = value
            count += 1
        }
        flush()
        if firstAbsolute % size != 0, result.count > 1 { result.removeFirst() }
        return result
    }

    /// Marks a licensed live feed as connected. The synthetic ticker pauses.
    func connectLiveFeed(provider: String) {
        quoteSource = .live(provider: provider)
    }

    /// Returns to synthetic quotes, continuing from the last known prices.
    func disconnectLiveFeed() {
        quoteSource = .simulated
    }

    /// Entry point for a real feed adapter. Refuses quotes when no live feed is
    /// connected, and refuses stale or future-dated quotes.
    @discardableResult
    func ingestLiveQuote(market: Market, price: Double, timestamp: Date, now: Date = Date()) -> Bool {
        guard case .live = quoteSource else { return false }
        let age = now.timeIntervalSince(timestamp)
        guard age <= Self.maxQuoteAge, age >= -2 else { return false }
        return updateQuote(market: market, price: price)
    }

    /// Mirrors a server quote. No local liquidation: the server decides.
    func applyServerQuote(market: Market, price: Double) {
        guard serverAuthoritative, price.isFinite, price >= market.tickSize, price <= 10_000_000 else { return }
        let mark = rounded(price, for: market)
        guard quotes[market] != mark else { return }
        quotes[market] = mark
        appendHistory(mark, for: market)
    }

    /// Replaces the account with the server's copy (the source of truth online).
    /// `baseline` is the account's real starting balance ($100k in online seasons).
    func applyServerState(cash: Double, protectionCredit: Double, liquidations: Int,
                          positions: [Position], closedTrades: [ClosedTrade], baseline: Double? = nil) {
        guard serverAuthoritative else { return }
        balance = cash
        self.protectionCredit = protectionCredit
        liquidationCount = liquidations
        self.positions = positions
        self.closedTrades = closedTrades
        realizedPnL = cash - (baseline ?? Self.startingBalance)
    }

    /// Advances one synthetic tick. The caller owns the timer and scene lifecycle.
    /// Does nothing while a live feed is connected.
    func tick() {
        guard quoteSource == .simulated, !serverAuthoritative else { return }
        for market in Market.allCases {
            let steps = Int(nextRandom() % 13) - 6
            let oldPrice = quotes[market] ?? market.initialPrice
            let nextPrice = rounded(max(market.tickSize, oldPrice + Double(steps) * market.tickSize), for: market)
            quotes[market] = nextPrice
            appendHistory(nextPrice, for: market)
        }
        liquidateIfNeeded()
        persist()
    }

    /// A validated quote boundary for deterministic tests and future feed adapters.
    /// A production adapter must also enforce feed timestamps and stale-data rules.
    @discardableResult
    func updateQuote(market: Market, price: Double) -> Bool {
        guard price.isFinite, price >= market.tickSize, price <= 1_000_000 else { return false }
        let mark = rounded(price, for: market)
        quotes[market] = mark
        appendHistory(mark, for: market)
        liquidateIfNeeded()
        persist()
        return true
    }

    func reset() {
        positions = []
        closedTrades = []
        balance = Self.startingBalance
        realizedPnL = 0
        protectionCredit = 0
        liquidationCount = 0
        randomState = 0xB0C1_E123
        tickCounts = [:]
        seedMarkets()
        persist()
    }

    private func settlePosition(at index: Int) {
        let position = positions[index]
        let mark = quotes[position.market] ?? position.entryPrice
        let profit = pnl(for: position)
        balance += profit
        closedTrades.insert(ClosedTrade(id: position.id, market: position.market, side: position.side, quantity: position.quantity,
                                       entryPrice: position.entryPrice, exitPrice: mark, pnl: profit, closedAt: Date()), at: 0)
        positions.remove(at: index)
    }

    private func liquidateIfNeeded() {
        guard !serverAuthoritative, balance + unrealizedPnL <= 0 else { return }
        if !positions.isEmpty {
            while !positions.isEmpty { settlePosition(at: positions.count - 1) }
            liquidationCount += 1
        }
        // Track the game-only floor adjustment explicitly so cash reconciles
        // with the raw trade ledger and the credit can be shown in the UI.
        protectionCredit += max(0, -balance)
        balance = max(0, balance)
        realizedPnL = balance - Self.startingBalance
    }

    private func seedMarkets() {
        for market in Market.allCases {
            var value = market.initialPrice
            var series: [Double] = []
            for _ in 0..<Self.historyLimit {
                let steps = Int(nextRandom() % 11) - 4
                value = rounded(max(market.tickSize, value + Double(steps) * market.tickSize), for: market)
                series.append(value)
            }
            // Anchor the final demo quote at its declared placeholder price.
            let offset = market.initialPrice - (series.last ?? market.initialPrice)
            histories[market] = series.map { rounded($0 + offset, for: market) }
            quotes[market] = market.initialPrice
            tickCounts[market] = series.count
        }
    }

    private func appendHistory(_ price: Double, for market: Market) {
        var values = histories[market] ?? []
        values.append(price)
        if values.count > Self.historyLimit { values.removeFirst(values.count - Self.historyLimit) }
        histories[market] = values
        tickCounts[market, default: values.count - 1] += 1
    }

    private func rounded(_ price: Double, for market: Market) -> Double {
        (price / market.tickSize).rounded() * market.tickSize
    }

    private func nextRandom() -> UInt64 {
        randomState = randomState &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        return randomState
    }

    private func persist() {
        guard let storage else { return }
        let snapshot = Snapshot(version: 2, balance: balance, protectionCredit: protectionCredit, positions: positions, closedTrades: closedTrades,
                                quotes: quotes, histories: histories, selectedMarket: selectedMarket,
                                randomState: randomState, liquidationCount: liquidationCount, tickCounts: tickCounts)
        if let data = try? JSONEncoder().encode(snapshot) { storage.set(data, forKey: Self.storageKey) }
    }

    private struct Snapshot: Codable {
        let version: Int
        let balance: Double
        let protectionCredit: Double
        let positions: [Position]
        let closedTrades: [ClosedTrade]
        let quotes: [Market: Double]
        let histories: [Market: [Double]]
        let selectedMarket: Market
        let randomState: UInt64
        let liquidationCount: Int
        /// Optional so snapshots saved before candles existed still load.
        let tickCounts: [Market: Int]?

        var isValid: Bool {
            guard version == 2, balance.isFinite, abs(balance) <= 1_000_000_000,
                  protectionCredit.isFinite, protectionCredit >= 0, protectionCredit <= 1_000_000_000,
                  liquidationCount > 0 || protectionCredit == 0,
                  positions.count <= 10_000, closedTrades.count <= 100_000,
                  liquidationCount >= 0,
                  Set(positions.map(\.id)).count == positions.count,
                  Set(closedTrades.map(\.id)).count == closedTrades.count,
                  Set(positions.map(\.id)).isDisjoint(with: Set(closedTrades.map(\.id))) else { return false }
            for market in Market.allCases {
                guard let quote = quotes[market], validPrice(quote, market: market),
                      let history = histories[market], !history.isEmpty, history.count <= TradingEngine.historyLimit,
                      history.allSatisfy({ validPrice($0, market: market) }),
                      let last = history.last, abs(last - quote) < 0.000_001 else { return false }
            }
            guard positions.allSatisfy({ (1...3).contains($0.quantity) && validPrice($0.entryPrice, market: $0.market) && $0.openedAt.timeIntervalSince1970.isFinite }) else { return false }
            guard closedTrades.allSatisfy({
                (1...3).contains($0.quantity) && validPrice($0.entryPrice, market: $0.market) && validPrice($0.exitPrice, market: $0.market)
                    && $0.pnl.isFinite && $0.closedAt.timeIntervalSince1970.isFinite
                    && abs($0.pnl - ($0.exitPrice - $0.entryPrice) * $0.market.pointValue * Double($0.quantity) * $0.side.direction) < 0.001
            }) else { return false }
            let ledgerBalance = TradingEngine.startingBalance + closedTrades.reduce(0) { $0 + $1.pnl } + protectionCredit
            return ledgerBalance.isFinite && abs(balance - ledgerBalance) < 0.001
        }

        private func validPrice(_ value: Double, market: Market) -> Bool {
            value.isFinite && value >= market.tickSize && value <= 1_000_000
                && abs(value / market.tickSize - (value / market.tickSize).rounded()) < 0.000_001
        }
    }
}
