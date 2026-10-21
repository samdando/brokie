import Foundation

// Shapes returned by the Brokie database functions (snake_case → camelCase).

struct ServerPosition: Decodable, Equatable {
    let id: UUID
    let market: Market
    let side: TradeSide
    let quantity: Int
    let entryPrice: Double
    let openedAt: Date

    var position: Position {
        Position(id: id, market: market, side: side, quantity: quantity, entryPrice: entryPrice, openedAt: openedAt)
    }
}

struct ServerTrade: Decodable, Equatable {
    let id: UUID
    let market: Market
    let side: TradeSide
    let quantity: Int
    let entryPrice: Double
    let exitPrice: Double
    let pnl: Double
    let closedAt: Date
    let reason: String

    var closedTrade: ClosedTrade {
        ClosedTrade(id: id, market: market, side: side, quantity: quantity, entryPrice: entryPrice,
                    exitPrice: exitPrice, pnl: pnl, closedAt: closedAt)
    }
}

struct ServerQuote: Decodable, Equatable {
    let market: Market
    let price: Double
    let quotedAt: Date
}

struct ServerState: Decodable {
    let handle: String
    let season: String
    let seasonEndsAt: Date
    let serverTime: Date
    let cash: Double
    let protectionCredit: Double
    let liquidations: Int
    let seasonNumber: Int?
    let rules: ServerRules?
    let hasBackupCode: Bool?
    let positions: [ServerPosition]
    let trades: [ServerTrade]
    let quotes: [ServerQuote]
}

struct Squad: Decodable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let inviteCode: String
    let ownerId: UUID
    let memberCount: Int
}

struct ServerRules: Decodable, Equatable {
    let status: String
    let startBalance: Double
    let peakEquity: Double
    let dayStartEquity: Double
    let dailyLossPct: Double
    let maxDdPct: Double
    let dailyFloor: Double
    let drawdownFloor: Double
    let target: Double
    let funded: Bool
    let resetsUsed: Int
    let tradingDays: Int
    let qualifyDays: Int
    var isBlown: Bool { status == "blown" }
    var isLocked: Bool { status == "locked" }
}

struct ChartBubble: Decodable, Identifiable, Equatable {
    let state: String
    let id: UUID
    let handle: String
    let isYou: Bool
    let side: TradeSide
    let quantity: Int
    let entryPrice: Double
    let exitPrice: Double?
    let pnl: Double?
    let reason: String?
    let at: Date
    let openedAt: Date
    let sizePct: Double?
    let ddFloor: Double?
    let equity: Double?
    var isOpen: Bool { state == "open" }
}

struct LifetimeStats: Decodable, Equatable {
    let totalTrades: Int
    let winRate: Double?
    let seasonsPlayed: Int
    let seasonsBlown: Int
    let seasonsFunded: Int
    let maxDrawdown: Double
}

struct LeaderRow: Decodable, Identifiable, Equatable {
    let handle: String
    let isYou: Bool
    let equity: Double
    let returnPct: Double
    let trades: Int
    let worstTrade: Double
    let openPositions: Int
    var status: String? = nil
    var funded: Bool? = nil
    var resetsUsed: Int? = nil
    var tradingDays: Int? = nil
    var qualified: Bool? = nil
    var id: String { handle }
}

struct FeedEvent: Decodable, Identifiable, Equatable {
    let kind: String
    let id: UUID
    let handle: String
    let isYou: Bool
    let market: Market
    let side: TradeSide
    let quantity: Int
    let price: Double
    let pnl: Double?
    let reason: String?
    let at: Date

    var isClose: Bool { kind == "closed" }
    var feedID: String { "\(kind)-\(id.uuidString)" }
}

struct ServerCandle: Decodable, Equatable {
    let index: Int
    let open: Double
    let high: Double
    let low: Double
    let close: Double

    var candle: Candle { Candle(index: index, open: open, high: high, low: low, close: close) }
}

struct VoiceCredentials: Decodable {
    let url: String
    let token: String
    let room: String
}

enum CandleMerge {
    /// Folds the live quote into the server's candles so the newest bar moves
    /// between fetches. Starts a new bar when the clock passes the bucket.
    static func merge(_ candles: [Candle], quote: Double, now: Date, bucketSeconds: Int) -> [Candle] {
        guard quote.isFinite, quote > 0, bucketSeconds > 0 else { return candles }
        let bucket = Int(floor(now.timeIntervalSince1970 / Double(bucketSeconds)))
        var result = candles
        if let last = result.last, last.index == bucket {
            result[result.count - 1] = Candle(index: bucket, open: last.open, high: max(last.high, quote),
                                              low: min(last.low, quote), close: quote)
        } else if let last = result.last, last.index > bucket {
            return result
        } else {
            let open = result.last?.close ?? quote
            result.append(Candle(index: bucket, open: open, high: max(open, quote), low: min(open, quote), close: quote))
        }
        return result
    }
}

struct BackupCode: Decodable { let code: String }

struct RestoreResult: Decodable {
    let ok: Bool
    let error: String?
    let handle: String?
    let code: String?
}
