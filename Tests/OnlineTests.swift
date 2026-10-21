import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Stands in for Supabase's HTTP layer: auth endpoints hand out fake tokens,
/// and /rest/v1/rpc/* runs the real SQL function in a local Postgres loaded
/// with backend/schema.sql, as the signed-in player. This tests the Swift
/// client, models and OnlineGame against the real database logic.
final class PsqlTransport: HTTPTransport, @unchecked Sendable {
    let database: String
    let lock = NSLock()
    var users: [String: String] = [:]   // access token -> user id
    var calls: [String] = []
    init(database: String) { self.database = database }

    func send(_ request: URLRequest) async throws -> (Data, Int) {
        let path = request.url!.path + (request.url!.query.map { "?" + $0 } ?? "")
        lock.withLock { calls.append(path) }
        if path.hasSuffix("/auth/v1/signup") {
            let uid = UUID().uuidString.lowercased()
            _ = try psql("insert into auth.users values ('\(uid)')")
            let token = "token-\(uid)"
            lock.withLock { users[token] = uid }
            return (json(["access_token": token, "refresh_token": "refresh-\(uid)", "expires_in": 3600, "user": ["id": uid]]), 200)
        }
        if path.contains("/auth/v1/token") {
            return (json(["message": "refresh not supported in test"]), 400)
        }
        if path.contains("/rest/v1/rpc/") {
            let name = String(path.split(separator: "/").last!)
            let bearer = request.value(forHTTPHeaderField: "Authorization")!.replacingOccurrences(of: "Bearer ", with: "")
            let uid = lock.withLock { users[bearer] }
            guard let uid else { return (json(["message": "JWT invalid"]), 401) }
            let params = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data())) as? [String: Any] ?? [:]
            let args = params.keys.sorted().map { key -> String in
                let value = "\(params[key]!)".replacingOccurrences(of: "'", with: "''")
                return "\(key) := '\(value)'"
            }.joined(separator: ", ")
            let sql = "set role authenticated; select set_config('request.jwt.claim.sub', '\(uid)', false) \\g /dev/null\nselect coalesce(to_jsonb(public.\(name)(\(args)))::text, 'null');"
            do {
                return (Data(try psql(sql).utf8), 200)
            } catch let error as BackendError {
                return (json(["message": error.message, "code": "P0001"]), 400)
            }
        }
        return (json(["message": "not found"]), 404)
    }

    func psql(_ sql: String) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/psql")
        process.arguments = ["-h", "/tmp", "-p", "5544", "-U", "postgres", "-d", database, "-qtA", "-v", "ON_ERROR_STOP=1", "-f", "-"]
        let input = Pipe(), output = Pipe(), errors = Pipe()
        process.standardInput = input; process.standardOutput = output; process.standardError = errors
        try process.run()
        input.fileHandleForWriting.write(Data(sql.utf8)); input.fileHandleForWriting.closeFile()
        let out = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        let err = String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        process.waitUntilExit()
        if process.terminationStatus != 0 {
            let message = err.components(separatedBy: "ERROR:").last?.components(separatedBy: "\n").first?.trimmingCharacters(in: .whitespaces) ?? err
            throw BackendError(message: message)
        }
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func json(_ object: Any) -> Data { try! JSONSerialization.data(withJSONObject: object) }
}

@main
struct OnlineTests {
    @MainActor
    static func main() async {
        var checks = 0
        func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
            checks += 1
            if !condition() { fatalError("FAIL: \(message)") }
        }
        let db = ProcessInfo.processInfo.environment["BROKIE_TEST_DB"] ?? "brokie_swift"
        let transport = PsqlTransport(database: db)
        func ingest(_ quotes: [(String, Double)]) {
            let items = quotes.map { "jsonb_build_object('market','\($0.0)','price',\($0.1),'quoted_at',now())" }.joined(separator: ",")
            _ = try! transport.psql("set role service_role; select public.ingest_quotes(jsonb_build_array(\(items)));")
        }
        ingest([("gold", 4012.37), ("nas", 20100), ("es", 6000)])

        // Timestamp parsing for Postgres formats.
        expect(BackendClient.parseTimestamp("2026-10-21T09:48:28.486033+10:00") != nil, "parses microsecond timestamps")
        expect(BackendClient.parseTimestamp("2026-10-26T00:00:00+10:00") != nil, "parses whole-second timestamps")
        expect(BackendClient.parseTimestamp("2026-10-20T23:48:28.4Z") != nil, "parses short fractions")
        expect(BackendClient.parseTimestamp("nope") == nil, "rejects junk timestamps")

        // Player A signs up anonymously and must pick a handle.
        let storeA = MemorySessionStore()
        let clientA = BackendClient(baseURL: URL(string: "https://test.supabase.co/")!, anonKey: "anon", transport: transport, store: storeA)
        let gameA = OnlineGame(client: clientA, defaults: UserDefaults(suiteName: "online-a-\(UUID())")!)
        expect(gameA.phase == .connecting, "starts connecting")
        await gameA.start()
        expect(gameA.phase == .needsHandle, "new player must pick a handle")
        expect(storeA.session != nil, "anonymous session saved")
        do { try await gameA.claimHandle("x"); expect(false, "short handle should fail") } catch {
            expect(error.localizedDescription.contains("3–18"), "short handle error is readable")
        }
        try! await gameA.claimHandle("Jess_Exe")
        gameA.setActive(false)
        expect(gameA.phase == .ready && gameA.handle == "jess_exe", "handle claimed, game ready")
        expect(gameA.engine.balance == 10_000 && gameA.seasonEndsAt != nil, "season account mirrored")
        expect(abs(gameA.engine.quotes[.gold]! - 4012.4) < 0.0001, "server quote mirrored and rounded")
        expect(gameA.marketOpen[.nas] == true, "fresh quote marks market open")

        // Trading through the server.
        let openA = await gameA.open(market: .nas, side: .long, quantity: 2)
        expect(openA == nil, "opens long NAS on server")
        expect(gameA.engine.positions.count == 1 && gameA.engine.positions[0].entryPrice == 20_100, "position mirrored with server fill price")
        let tooBig = await gameA.open(market: .nas, side: .long, quantity: 9)
        expect(tooBig?.contains("1, 2, or 3") == true, "server rejection surfaces as message")
        ingest([("nas", 20150)])
        try! await gameA.refreshState()
        expect(abs(gameA.engine.unrealizedPnL - 200) < 0.001, "open P&L marks to new server quote (50 pts × $2 × 2)")
        let closed = await gameA.close(positionID: gameA.engine.positions[0].id)
        expect((try? closed.get()) == 200, "close returns realized P&L")
        expect(gameA.engine.balance == 10_200 && gameA.engine.closedTrades.count == 1, "balance and receipts mirrored")
        let again = await gameA.close(positionID: UUID())
        if case .failure(let error) = again { expect(error.message.contains("already closed"), "closing unknown position fails cleanly") } else { expect(false, "should fail") }

        // Squads: A creates, B joins with the code.
        try! await gameA.createSquad(named: "Rent Money Club")
        expect(gameA.squads.count == 1 && gameA.selectedSquad?.name == "Rent Money Club", "squad created and selected")
        let code = gameA.selectedSquad!.inviteCode
        expect(code.count == 6, "invite code")

        let clientB = BackendClient(baseURL: URL(string: "https://test.supabase.co/")!, anonKey: "anon", transport: transport, store: MemorySessionStore())
        let gameB = OnlineGame(client: clientB, defaults: UserDefaults(suiteName: "online-b-\(UUID())")!)
        await gameB.start()
        try! await gameB.claimHandle("chartgremlin")
        gameB.setActive(false)
        do { try await gameB.joinSquad(code: "ZZZZZZ"); expect(false, "bad code should fail") } catch {
            expect(error.localizedDescription.contains("No squad"), "bad invite code message")
        }
        try! await gameB.joinSquad(code: code.lowercased())
        expect(gameB.selectedSquad?.id == gameA.selectedSquad?.id && gameB.selectedSquad?.memberCount == 2, "B joined A's squad")
        let openB = await gameB.open(market: .gold, side: .short, quantity: 1)
        expect(openB == nil, "B opens a trade")

        await gameA.refreshSquadBoard()
        expect(gameA.leaderboard.count == 2, "leaderboard has both players")
        expect(gameA.leaderboard[0].handle == "jess_exe" && gameA.leaderboard[0].isYou && abs(gameA.leaderboard[0].returnPct - 2) < 0.001, "A leads at +2%")
        expect(gameA.leaderboard[1].handle == "chartgremlin" && gameA.leaderboard[1].openPositions == 1, "B shows an open position")
        expect(gameA.feed.contains { $0.handle == "chartgremlin" && !$0.isClose && $0.market == .gold }, "feed shows B's open")
        expect(gameA.feed.contains { $0.handle == "jess_exe" && $0.isClose && $0.pnl == 200 }, "feed shows A's close with P&L")

        // Candles from server ticks, with the live quote folded in.
        await gameA.refreshCandles(.nas)
        expect(!(gameA.serverCandles[.nas] ?? []).isEmpty, "server candles load")
        let live = gameA.liveCandles(for: .nas)
        expect(abs(live.last!.close - gameA.engine.quotes[.nas]!) < 0.0001, "live candle closes at current quote")
        let merged = CandleMerge.merge([Candle(index: 10, open: 1, high: 2, low: 1, close: 2)], quote: 3, now: Date(timeIntervalSince1970: 10 * 60 + 5), bucketSeconds: 60)
        expect(merged.count == 1 && merged[0].high == 3 && merged[0].close == 3 && merged[0].open == 1, "merge updates current bar")
        let rolled = CandleMerge.merge([Candle(index: 10, open: 1, high: 2, low: 1, close: 2)], quote: 3, now: Date(timeIntervalSince1970: 11 * 60 + 1), bucketSeconds: 60)
        expect(rolled.count == 2 && rolled[1].open == 2 && rolled[1].close == 3, "merge starts a new bar from last close")

        // Session persists: a relaunch with the same store is the same player.
        let relaunch = OnlineGame(client: BackendClient(baseURL: URL(string: "https://test.supabase.co/")!, anonKey: "anon", transport: transport, store: storeA),
                                  defaults: UserDefaults(suiteName: "online-a2-\(UUID())")!)
        await relaunch.start()
        relaunch.setActive(false)
        expect(relaunch.phase == .ready && relaunch.handle == "jess_exe" && relaunch.engine.balance == 10_200, "relaunch restores the same player")

        // Backup code: B saves a code, "loses the phone", restores on a fresh login.
        expect(gameB.hasBackupCode == false, "new player has no backup code")
        try! await gameB.issueBackupCode()
        let codeB = gameB.freshBackupCode!
        try! await gameB.refreshState()
        expect(gameB.hasBackupCode && codeB.hasPrefix("BRK-"), "backup code issued")
        let newPhone = OnlineGame(client: BackendClient(baseURL: URL(string: "https://test.supabase.co/")!, anonKey: "anon", transport: transport, store: MemorySessionStore()),
                                  defaults: UserDefaults(suiteName: "online-b2-\(UUID())")!)
        await newPhone.start()
        expect(newPhone.phase == .needsHandle, "new phone starts at onboarding")
        do { try await newPhone.restoreAccount(handle: "chartgremlin", code: "BRK-AAAA-AAAA-AAAA"); expect(false, "wrong code must fail") } catch {
            expect(error.localizedDescription.contains("don't match"), "wrong code message")
        }
        try! await newPhone.restoreAccount(handle: "ChartGremlin", code: codeB.lowercased())
        newPhone.setActive(false)
        expect(newPhone.phase == .ready && newPhone.handle == "chartgremlin", "restored onto new phone")
        expect(newPhone.engine.positions.count == 1 && newPhone.squads.count == 1, "trade and squad came with it")
        expect(newPhone.freshBackupCode != nil && newPhone.freshBackupCode != codeB, "restore hands out a fresh code")
        await gameB.refreshSquads()
        let oldPhoneState = try? await gameB.refreshState()
        expect(oldPhoneState == nil, "old phone no longer has the account")

        // Leaving the squad.
        try! await newPhone.leaveSquad(newPhone.selectedSquad!)
        expect(newPhone.squads.isEmpty && newPhone.selectedSquad == nil, "B left the squad")

        // Offline mode never touches the network.
        let offline = OnlineGame(client: nil)
        await offline.start()
        expect(offline.phase == .offline && !offline.isOnline, "no config means practice-only")

        expect(!transport.calls.contains { $0.contains("refresh_token") }, "no needless token refreshes")
        print("PASS: \(checks) online assertions")
    }
}
