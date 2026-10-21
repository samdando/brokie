import Foundation
import Combine

/// The online season: signs the player in, mirrors their server account into a
/// display-only engine, and keeps squads, the leaderboard, the pit feed and
/// candles fresh. Every trade goes through the server; this class never
/// decides a fill or a balance.
@MainActor
final class OnlineGame: ObservableObject {
    enum Phase: Equatable {
        case offline            // no backend configured: practice only
        case connecting
        case needsHandle
        case ready
        case failed(String)
    }

    @Published private(set) var phase: Phase
    @Published private(set) var handle = ""
    @Published private(set) var seasonEndsAt: Date?
    @Published private(set) var squads: [Squad] = []
    @Published private(set) var leaderboard: [LeaderRow] = []
    @Published private(set) var feed: [FeedEvent] = []
    @Published private(set) var serverCandles: [Market: [Candle]] = [:]
    @Published private(set) var marketOpen: [Market: Bool] = [:]
    @Published private(set) var hasBackupCode = true
    @Published private(set) var rules: ServerRules?
    @Published private(set) var seasonNumber = 1
    @Published private(set) var bubbles: [ChartBubble] = []
    @Published private(set) var lifetime: LifetimeStats?
    /// A code the player has just been given and must save (shown once).
    @Published var freshBackupCode: String?
    @Published var selectedSquadID: UUID? {
        didSet {
            guard oldValue != selectedSquadID else { return }
            defaults.set(selectedSquadID?.uuidString, forKey: Self.squadKey)
            leaderboard = []
            feed = []
            Task { await refreshSquadBoard() }
        }
    }
    /// Candle size in seconds for the chart while online.
    var candleSeconds = 60 {
        didSet { if oldValue != candleSeconds { Task { await refreshCandles() } } }
    }

    let engine = TradingEngine(storage: nil, serverAuthoritative: true)
    let client: BackendClient?
    private let defaults: UserDefaults
    private var loop: Task<Void, Never>?
    private var serverClockOffset: TimeInterval = 0
    private static let squadKey = "brokie.online.squad"

    init(client: BackendClient?, defaults: UserDefaults = .standard) {
        self.client = client
        self.defaults = defaults
        self.phase = client == nil ? .offline : .connecting
        self.selectedSquadID = defaults.string(forKey: Self.squadKey).flatMap(UUID.init(uuidString:))
        engine.connectLiveFeed(provider: "oanda")
    }

    static func live() -> OnlineGame {
        guard BrokieConfig.isConfigured, let url = URL(string: BrokieConfig.supabaseURL) else { return OnlineGame(client: nil) }
        #if canImport(Security)
        let store: SessionStore = KeychainSessionStore()
        #else
        let store: SessionStore = MemorySessionStore()
        #endif
        return OnlineGame(client: BackendClient(baseURL: url, anonKey: BrokieConfig.supabaseAnonKey, store: store))
    }

    var isOnline: Bool { phase == .ready }
    var selectedSquad: Squad? { squads.first { $0.id == selectedSquadID } ?? squads.first }
    var serverNow: Date { Date().addingTimeInterval(serverClockOffset) }

    // MARK: Lifecycle

    func start() async {
        guard let client, phase != .ready else { return }
        phase = .connecting
        do {
            _ = try await client.ensureSession()
            try await refreshState()
            phase = .ready
            await refreshSquads()
            startLoop()
        } catch let error as BackendError where error.needsHandle {
            phase = .needsHandle
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    /// Call when the app goes to the background / comes back.
    func setActive(_ active: Bool) {
        if active {
            if phase == .ready { startLoop() } else if case .failed = phase { Task { await start() } }
        } else {
            loop?.cancel()
            loop = nil
        }
    }

    private func startLoop() {
        loop?.cancel()
        loop = Task { [weak self] in
            var beat = 0
            while !Task.isCancelled {
                guard let self else { return }
                try? await self.refreshState()
                await self.refreshBubbles()
                if beat % 3 == 0 {
                    await self.refreshSquadBoard()
                    await self.refreshCandles()
                }
                if beat % 12 == 0 { await self.refreshSquads() }
                beat += 1
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    // MARK: Account

    func claimHandle(_ text: String) async throws {
        guard let client else { return }
        _ = try await client.rpcData("claim_handle", ["p_handle": text])
        try await refreshState()
        if phase != .ready {
            phase = .ready
            await refreshSquads()
            startLoop()
        }
    }

    /// Issues a new backup code (replacing any old one) and shows it.
    func issueBackupCode() async throws {
        guard let client else { return }
        let result: BackupCode = try await client.rpc("issue_backup_code")
        hasBackupCode = true
        freshBackupCode = result.code
    }

    /// On a new phone: takes over the account that owns `handle` + `code`.
    func restoreAccount(handle: String, code: String) async throws {
        guard let client else { return }
        _ = try await client.ensureSession()
        let result: RestoreResult = try await client.rpc("restore_account", ["p_handle": handle, "p_code": code])
        guard result.ok else { throw BackendError(message: result.error ?? "Couldn't restore that account.") }
        try await refreshState()
        freshBackupCode = result.code
        if phase != .ready {
            phase = .ready
            await refreshSquads()
            startLoop()
        }
    }

    func refreshState() async throws {
        guard let client else { return }
        let state: ServerState = try await client.rpc("my_state")
        apply(state)
    }

    func apply(_ state: ServerState) {
        handle = state.handle
        seasonEndsAt = state.seasonEndsAt
        hasBackupCode = state.hasBackupCode ?? true
        rules = state.rules
        seasonNumber = state.seasonNumber ?? 1
        serverClockOffset = state.serverTime.timeIntervalSinceNow
        for quote in state.quotes {
            engine.applyServerQuote(market: quote.market, price: quote.price)
            marketOpen[quote.market] = state.serverTime.timeIntervalSince(quote.quotedAt) < 45
        }
        engine.applyServerState(cash: state.cash, protectionCredit: state.protectionCredit, liquidations: state.liquidations,
                                positions: state.positions.map(\.position), closedTrades: state.trades.map(\.closedTrade))
    }

    // MARK: Trading (server fills)

    /// Returns nil on success, or a message to show.
    func open(market: Market, side: TradeSide, quantity: Int) async -> String? {
        guard let client else { return "Offline." }
        do {
            _ = try await client.rpcData("open_position", ["p_market": market.rawValue, "p_side": side.rawValue, "p_quantity": quantity])
            try await refreshState()
            Task { await refreshSquadBoard() }
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    /// Returns the realized P&L on success.
    func close(positionID: UUID) async -> Result<Double, BackendError> {
        guard let client else { return .failure(BackendError(message: "Offline.")) }
        do {
            let trade: ServerTrade = try await client.rpc("close_position", ["p_id": positionID.uuidString])
            try await refreshState()
            Task { await refreshSquadBoard() }
            return .success(trade.pnl)
        } catch let error as BackendError {
            return .failure(error)
        } catch {
            return .failure(BackendError(message: error.localizedDescription))
        }
    }

    // MARK: Squads

    func refreshSquads() async {
        guard let client else { return }
        guard let list: [Squad] = try? await client.rpc("my_squads") else { return }
        squads = list
        if selectedSquadID == nil || !list.contains(where: { $0.id == selectedSquadID }) {
            selectedSquadID = list.first?.id
        }
    }

    func createSquad(named name: String) async throws {
        guard let client else { return }
        let squad: Squad = try await client.rpc("create_squad", ["p_name": name])
        await refreshSquads()
        selectedSquadID = squad.id
    }

    func joinSquad(code: String) async throws {
        guard let client else { return }
        let squad: Squad = try await client.rpc("join_squad", ["p_code": code])
        await refreshSquads()
        selectedSquadID = squad.id
    }

    func leaveSquad(_ squad: Squad) async throws {
        guard let client else { return }
        _ = try await client.rpcData("leave_squad", ["p_squad": squad.id.uuidString])
        if selectedSquadID == squad.id { selectedSquadID = nil }
        await refreshSquads()
    }

    func refreshSquadBoard() async {
        guard let client, let squad = selectedSquad else { return }
        if let rows: [LeaderRow] = try? await client.rpc("squad_leaderboard", ["p_squad": squad.id.uuidString]) {
            leaderboard = rows
        }
        if let events: [FeedEvent] = try? await client.rpc("squad_feed", ["p_squad": squad.id.uuidString, "p_limit": 30]) {
            feed = events
        }
    }

    // MARK: Chart

    func refreshCandles(_ market: Market? = nil) async {
        guard let client else { return }
        let target = market ?? engine.selectedMarket
        let params: [String: Any] = ["p_market": target.rawValue, "p_bucket_seconds": candleSeconds, "p_limit": 60]
        if let bars: [ServerCandle] = try? await client.rpc("candles", params) {
            serverCandles[target] = bars.map(\.candle)
        }
    }

    /// Server candles with the live quote folded into the newest bar.
    func liveCandles(for market: Market) -> [Candle] {
        CandleMerge.merge(serverCandles[market] ?? [], quote: engine.quotes[market] ?? 0,
                          now: serverNow, bucketSeconds: candleSeconds)
    }

    // MARK: Prop rules & bubbles

    func refreshBubbles() async {
        guard let client else { return }
        let market = engine.selectedMarket
        var params: [String: Any] = ["p_market": market.rawValue]
        if let squad = selectedSquad { params["p_squad"] = squad.id.uuidString }
        if let list: [ChartBubble] = try? await client.rpc("chart_bubbles", params), engine.selectedMarket == market {
            bubbles = list
        }
    }

    func buyBack() async throws {
        guard let client else { return }
        _ = try await client.rpcData("buy_back")
        try await refreshState()
    }

    func refreshLifetime() async {
        guard let client else { return }
        lifetime = try? await client.rpc("lifetime_stats")
    }

    // MARK: Voice

    func voiceCredentials(room: VoiceRoom) async throws -> VoiceCredentials {
        guard let client, let squad = selectedSquad else { throw BackendError(message: "Join a squad to use voice.") }
        return try await client.function("voice-token", body: ["squadId": squad.id.uuidString.lowercased(), "room": room.rawValue])
    }
}
