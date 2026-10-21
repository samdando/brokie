import Foundation

@main
struct EngineTests {
    @MainActor
    static func main() {
        var checks = 0
        func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
            checks += 1
            if !condition() { fatalError("FAIL: \(message)") }
        }
        func near(_ lhs: Double, _ rhs: Double) -> Bool { abs(lhs - rhs) < 0.000_01 }

        for market in Market.allCases {
            for side in TradeSide.allCases {
                let engine = TradingEngine(storage: nil)
                engine.selectedMarket = market
                expect(engine.openPosition(side: side, quantity: 2) == nil, "opens valid order")
                let position = engine.positions[0]
                expect(engine.updateQuote(market: market, price: position.entryPrice + 5), "accepts price")
                let expected = 5 * market.pointValue * 2 * side.direction
                expect(near(engine.pnl(for: position), expected), "\(market) \(side) multiplier")
                expect(near(engine.equity, 10_000 + expected), "marked equity")
                engine.closePosition(id: position.id)
                expect(engine.positions.isEmpty, "closes order")
                expect(near(engine.balance, 10_000 + expected), "realizes profit/loss")
                expect(near(engine.realizedPnL, expected), "net realized result")
                expect(near(engine.closedTrades[0].pnl, expected), "stores trade P&L")
                engine.closePosition(id: position.id)
                expect(engine.closedTrades.count == 1, "idempotent close")
            }
        }

        let margin = TradingEngine(storage: nil)
        expect(margin.openPosition(side: .long, quantity: 0) != nil, "rejects zero size")
        expect(margin.openPosition(side: .long, quantity: -1) != nil, "rejects negative size")
        expect(margin.openPosition(side: .long, quantity: 4) != nil, "rejects oversized trade")
        for _ in 0..<3 { expect(margin.openPosition(side: .long, quantity: 3) == nil, "reserves buying power") }
        expect(margin.openPosition(side: .short, quantity: 2) != nil, "rejects insufficient buying power")
        expect(margin.positions.count == 3, "rejection does not partially fill")
        expect(margin.openPosition(side: .short, quantity: 1) == nil, "allows exact margin")
        expect(near(margin.availableMargin, 0), "all buying power committed")
        expect(margin.openPosition(side: .long, quantity: 1) != nil, "cannot reuse committed margin")

        let losing = TradingEngine(storage: nil)
        losing.selectedMarket = .gold
        losing.openPosition(side: .long, quantity: 3)
        losing.updateQuote(market: .gold, price: Market.gold.initialPrice - 200)
        expect(near(losing.availableMargin, 1_000), "unrealized losses reduce available margin")
        expect(losing.openPosition(side: .long, quantity: 2) != nil, "cannot spend lost equity")

        let quotes = TradingEngine(storage: nil)
        expect(!quotes.updateQuote(market: .nas, price: .nan), "rejects NaN")
        expect(!quotes.updateQuote(market: .nas, price: .infinity), "rejects infinity")
        expect(!quotes.updateQuote(market: .gold, price: 0), "rejects zero quote")
        expect(!quotes.updateQuote(market: .es, price: -1), "rejects negative quote")
        expect(quotes.updateQuote(market: .es, price: 6000.13), "rounds valid quote")
        expect(near(quotes.quotes[.es]!, 6000.25), "rounds to exchange tick")
        let twin1 = TradingEngine(storage: nil)
        let twin2 = TradingEngine(storage: nil)
        for _ in 0..<500 { twin1.tick(); twin2.tick() }
        expect(twin1.quotes == twin2.quotes, "simulation is deterministic")
        expect(twin1.histories.values.allSatisfy { $0.count == TradingEngine.historyLimit && $0.allSatisfy { $0 > 0 && $0.isFinite } }, "history is bounded and positive")

        // Candles: OHLC must match the ticks they cover, and finished candles
        // must not change as the rolling window slides forward.
        let charted = TradingEngine(storage: nil)
        for size in [1, 4, 10, 20] {
            let candles = charted.candles(for: .nas, ticksPerCandle: size)
            expect(!candles.isEmpty, "builds candles at \(size) ticks")
            expect(candles.allSatisfy { $0.low <= min($0.open, $0.close) && $0.high >= max($0.open, $0.close) }, "candle bounds hold at \(size)")
            expect(zip(candles, candles.dropFirst()).allSatisfy { $1.index == $0.index + 1 }, "candle buckets are contiguous at \(size)")
            expect(abs(candles.last!.close - charted.quotes[.nas]!) < 0.000_001, "last candle closes at quote at \(size)")
        }
        let before = charted.candles(for: .es, ticksPerCandle: 10)
        for _ in 0..<7 { charted.tick() }
        let after = charted.candles(for: .es, ticksPerCandle: 10)
        let finished = before.dropLast()
        expect(finished.allSatisfy { old in after.first(where: { $0.index == old.index }).map { $0 == old } ?? true }, "finished candles are stable as ticks arrive")
        expect(after.last!.index >= before.last!.index, "newest candle advances")
        let manual = TradingEngine(storage: nil)
        let startCount = manual.tickCounts[.gold]!
        for price in [3000.0, 3004.0, 2998.0, 3001.0] { manual.updateQuote(market: .gold, price: price) }
        expect(manual.tickCounts[.gold] == startCount + 4, "tick counter advances per quote")
        let fourTick = manual.candles(for: .gold, ticksPerCandle: 4)
        if (startCount % 4) == 0 {
            let bar = fourTick.last!
            expect(bar.open == 3000 && bar.high == 3004 && bar.low == 2998 && bar.close == 3001, "aligned candle has exact OHLC")
        }
        let oneTick = manual.candles(for: .gold, ticksPerCandle: 1)
        expect(oneTick.count == TradingEngine.historyLimit, "one-tick candles mirror history")

        // Live feed boundary: refuses quotes unless connected, refuses stale data,
        // and freezes the synthetic ticker while connected.
        let live = TradingEngine(storage: nil)
        let now = Date()
        expect(!live.ingestLiveQuote(market: .es, price: 6010, timestamp: now, now: now), "rejects live quote while simulated")
        live.connectLiveFeed(provider: "test")
        expect(live.quoteSource == .live(provider: "test") && live.quoteSource.badge == "LIVE · TEST", "reports live source")
        expect(live.ingestLiveQuote(market: .es, price: 6010, timestamp: now, now: now), "accepts fresh live quote")
        expect(near(live.quotes[.es]!, 6010), "live quote marks market")
        expect(!live.ingestLiveQuote(market: .es, price: 6020, timestamp: now.addingTimeInterval(-30), now: now), "rejects stale live quote")
        expect(!live.ingestLiveQuote(market: .es, price: 6020, timestamp: now.addingTimeInterval(60), now: now), "rejects future-dated live quote")
        expect(!live.ingestLiveQuote(market: .es, price: .nan, timestamp: now, now: now), "rejects invalid live price")
        let frozen = live.quotes
        live.tick()
        expect(live.quotes == frozen, "synthetic ticker pauses while live")
        live.disconnectLiveFeed()
        live.tick()
        expect(live.quoteSource == .simulated && live.quotes != frozen, "synthetic ticker resumes after disconnect")

        let liquidation = TradingEngine(storage: nil)
        liquidation.selectedMarket = .nas
        expect(liquidation.openPosition(side: .long, quantity: 3) == nil, "opens liquidation test")
        liquidation.updateQuote(market: .nas, price: 100)
        expect(liquidation.positions.isEmpty, "liquidates exhausted wallet")
        expect(liquidation.balance == 0 && liquidation.equity == 0, "negative balance protection")
        expect(liquidation.realizedPnL == -10_000, "net loss capped at practice wallet")
        expect(near(liquidation.protectionCredit, 112_317.5), "records exact gap loss protection credit")
        expect(near(liquidation.balance, 10_000 + liquidation.closedTrades.reduce(0) { $0 + $1.pnl } + liquidation.protectionCredit), "liquidated ledger reconciles")
        expect(liquidation.liquidationCount == 1, "records liquidation")
        liquidation.tick()
        expect(near(liquidation.protectionCredit, 112_317.5) && liquidation.liquidationCount == 1, "zero wallet does not receive repeated protection credits")
        expect(liquidation.openPosition(side: .long, quantity: 1) != nil, "empty wallet cannot trade")
        liquidation.reset()
        expect(liquidation.balance == 10_000 && liquidation.closedTrades.isEmpty && liquidation.positions.isEmpty, "reset restores practice wallet")
        expect(liquidation.protectionCredit == 0, "reset clears loss protection")

        let suiteName = "BrokieEngineTests.\(UUID().uuidString)"
        let storage = UserDefaults(suiteName: suiteName)!
        defer { storage.removePersistentDomain(forName: suiteName) }
        let persisted = TradingEngine(storage: storage)
        persisted.selectedMarket = .gold
        persisted.openPosition(side: .short, quantity: 1)
        persisted.updateQuote(market: .gold, price: 2720)
        let restored = TradingEngine(storage: storage)
        expect(restored.positions.count == 1, "restores open position")
        expect(restored.selectedMarket == .gold, "restores selection")
        expect(restored.quotes == persisted.quotes && near(restored.equity, persisted.equity), "restores quote and equity consistently")
        restored.closePosition(id: restored.positions[0].id)
        let reopened = TradingEngine(storage: storage)
        expect(reopened.positions.isEmpty && reopened.closedTrades.count == 1, "restores closed ledger")
        expect(near(reopened.balance, 10_084), "restores settled balance")

        // Closing one leg of an offsetting pair may make cash negative while
        // equity stays positive. The remaining leg must survive restoration.
        reopened.reset()
        reopened.selectedMarket = .nas
        reopened.openPosition(side: .long, quantity: 3)
        reopened.openPosition(side: .short, quantity: 3)
        reopened.updateQuote(market: .nas, price: 100)
        reopened.closePosition(id: reopened.positions[0].id)
        expect(reopened.balance < 0 && near(reopened.equity, 10_000), "hedged negative cash retains positive equity")
        let hedgeRestored = TradingEngine(storage: storage)
        expect(hedgeRestored.positions.count == 1 && near(hedgeRestored.equity, 10_000), "restores negative cash with offsetting open profit")
        hedgeRestored.closePosition(id: hedgeRestored.positions[0].id)
        expect(near(hedgeRestored.balance, 10_000) && hedgeRestored.protectionCredit == 0, "hedge closes without false protection credit")

        hedgeRestored.reset()
        hedgeRestored.openPosition(side: .long, quantity: 3)
        hedgeRestored.updateQuote(market: .nas, price: 100)
        let protectedRestored = TradingEngine(storage: storage)
        expect(protectedRestored.balance == 0 && protectedRestored.closedTrades.count == 1, "restores liquidated trade ledger")
        expect(near(protectedRestored.protectionCredit, 112_317.5), "restores protection credit")

        reopened.reset()
        expect(TradingEngine(storage: storage).balance == 10_000, "persists reset")
        let validData = storage.data(forKey: TradingEngine.storageKey)!
        var brokenSnapshot = try! JSONSerialization.jsonObject(with: validData) as! [String: Any]
        brokenSnapshot["balance"] = 1e20
        storage.set(try! JSONSerialization.data(withJSONObject: brokenSnapshot), forKey: TradingEngine.storageKey)
        expect(TradingEngine(storage: storage).balance == 10_000, "rejects corrupt out-of-range numeric state")
        brokenSnapshot["balance"] = 10_100
        storage.set(try! JSONSerialization.data(withJSONObject: brokenSnapshot), forKey: TradingEngine.storageKey)
        expect(TradingEngine(storage: storage).balance == 10_000, "rejects plausible cash with mismatched ledger")
        brokenSnapshot["balance"] = 10_000
        brokenSnapshot["protectionCredit"] = -100
        storage.set(try! JSONSerialization.data(withJSONObject: brokenSnapshot), forKey: TradingEngine.storageKey)
        expect(TradingEngine(storage: storage).protectionCredit == 0, "rejects negative protection credit")
        brokenSnapshot["balance"] = 10_100
        brokenSnapshot["protectionCredit"] = 100
        storage.set(try! JSONSerialization.data(withJSONObject: brokenSnapshot), forKey: TradingEngine.storageKey)
        expect(TradingEngine(storage: storage).balance == 10_000, "rejects protection credit without liquidation")
        brokenSnapshot["version"] = 1
        brokenSnapshot.removeValue(forKey: "protectionCredit")
        storage.set(try! JSONSerialization.data(withJSONObject: brokenSnapshot), forKey: TradingEngine.storageKey)
        expect(TradingEngine(storage: storage).balance == 10_000, "unshipped version one snapshot resets safely")
        // Snapshots saved before candles existed (no tickCounts, 70-tick history) still load.
        reopened.reset()
        reopened.openPosition(side: .long, quantity: 1)
        var legacy = try! JSONSerialization.jsonObject(with: storage.data(forKey: TradingEngine.storageKey)!) as! [String: Any]
        legacy.removeValue(forKey: "tickCounts")
        if var histories = legacy["histories"] as? [Any] {
            for i in stride(from: 1, to: histories.count, by: 2) {
                if let series = histories[i] as? [Double] { histories[i] = Array(series.suffix(70)) }
            }
            legacy["histories"] = histories
        }
        storage.set(try! JSONSerialization.data(withJSONObject: legacy), forKey: TradingEngine.storageKey)
        let legacyRestored = TradingEngine(storage: storage)
        expect(legacyRestored.positions.count == 1, "loads pre-candle snapshot")
        expect(legacyRestored.histories[.nas]!.count == 70 && legacyRestored.tickCounts[.nas] == 70, "derives tick count from legacy history")
        expect(!legacyRestored.candles(for: .nas, ticksPerCandle: 10).isEmpty, "legacy history still charts")
        storage.set(Data("invalid json".utf8), forKey: TradingEngine.storageKey)
        expect(TradingEngine(storage: storage).positions.isEmpty, "corrupt storage fails safely")
        // Server-authoritative mirror: shows server state, never liquidates or persists.
        let mirror = TradingEngine(storage: storage, serverAuthoritative: true)
        let serverPosition = Position(id: UUID(), market: .nas, side: .long, quantity: 2, entryPrice: 20_000, openedAt: Date())
        mirror.applyServerState(cash: 9_500, protectionCredit: 0, liquidations: 0, positions: [serverPosition], closedTrades: [])
        expect(near(mirror.realizedPnL, -500), "default baseline is the practice $10k")
        mirror.applyServerState(cash: 103_000, protectionCredit: 0, liquidations: 0, positions: [], closedTrades: [], baseline: 100_000)
        expect(near(mirror.realizedPnL, 3_000), "online realized P&L uses the account's $100k baseline")
        mirror.applyServerState(cash: 9_500, protectionCredit: 0, liquidations: 0, positions: [serverPosition], closedTrades: [])
        mirror.applyServerQuote(market: .nas, price: 15_000.1)
        expect(near(mirror.quotes[.nas]!, 15_000), "server quote rounds to tick")
        expect(mirror.positions.count == 1 && mirror.equity == 0, "mirror shows blown equity without liquidating")
        expect(mirror.liquidationCount == 0, "mirror never liquidates locally")
        mirror.tick()
        expect(near(mirror.quotes[.nas]!, 15_000), "mirror ignores synthetic ticks")
        expect(TradingEngine(storage: storage).positions.isEmpty, "mirror never writes the practice save")
        let practice = TradingEngine(storage: nil)
        practice.applyServerState(cash: 1, protectionCredit: 0, liquidations: 0, positions: [], closedTrades: [])
        practice.applyServerQuote(market: .es, price: 1)
        expect(practice.balance == 10_000 && practice.quotes[.es] != 1, "practice engine ignores server calls")
        print("PASS: \(checks) engine assertions")
    }
}
