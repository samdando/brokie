import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(Security)
import Security
#endif

/// A message from the server or network, ready to show to the player.
struct BackendError: LocalizedError, Equatable {
    let message: String
    var code: String?
    var errorDescription: String? { message }

    var needsHandle: Bool { message.localizedCaseInsensitiveContains("pick a handle") }
}

struct AuthSession: Codable, Equatable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var userID: String
}

/// Where the login lives between launches. Keychain on device, memory in tests.
protocol SessionStore: AnyObject {
    func load() -> AuthSession?
    func save(_ session: AuthSession?)
}

final class MemorySessionStore: SessionStore {
    var session: AuthSession?
    init(_ session: AuthSession? = nil) { self.session = session }
    func load() -> AuthSession? { session }
    func save(_ session: AuthSession?) { self.session = session }
}

#if canImport(Security)
final class KeychainSessionStore: SessionStore {
    private let service = "com.brokie.papertrade.session"

    func load() -> AuthSession? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(AuthSession.self, from: data)
    }

    func save(_ session: AuthSession?) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        SecItemDelete(base as CFDictionary)
        guard let session, let data = try? JSONEncoder().encode(session) else { return }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }
}
#endif

/// Moves bytes over HTTP. Swappable so tests can fake the server.
protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, Int)
}

struct URLSessionTransport: HTTPTransport {
    func send(_ request: URLRequest) async throws -> (Data, Int) {
        let (data, response) = try await URLSession.shared.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}

/// A tiny Supabase client: anonymous sign-in, token refresh, RPC calls and
/// edge functions. No SDK, so nothing extra to install.
@MainActor
final class BackendClient {
    let baseURL: URL
    let anonKey: String
    private let transport: HTTPTransport
    private let store: SessionStore
    private(set) var session: AuthSession?
    private var pendingAuth: Task<AuthSession, Error>?

    init(baseURL: URL, anonKey: String, transport: HTTPTransport = URLSessionTransport(), store: SessionStore) {
        self.baseURL = baseURL
        self.anonKey = anonKey
        self.transport = transport
        self.store = store
        self.session = store.load()
    }

    var userID: String? { session?.userID }

    // MARK: Auth

    /// Returns a valid session, refreshing or creating an anonymous one as needed.
    func ensureSession() async throws -> AuthSession {
        if let session, session.expiresAt > Date().addingTimeInterval(60) { return session }
        if let pendingAuth { return try await pendingAuth.value }
        let current = session
        let task = Task { @MainActor () throws -> AuthSession in
            if let current {
                do { return try await self.refresh(current) } catch let error as BackendError where error.code == "auth" {
                    // Refresh token is gone (revoked/expired): start a new anonymous player.
                    return try await self.signInAnonymously()
                }
            }
            return try await self.signInAnonymously()
        }
        pendingAuth = task
        defer { pendingAuth = nil }
        let fresh = try await task.value
        session = fresh
        store.save(fresh)
        return fresh
    }

    func signOut() {
        session = nil
        store.save(nil)
    }

    private func signInAnonymously() async throws -> AuthSession {
        let data = try await raw("auth/v1/signup", method: "POST", body: ["data": [String: Any]()], authorized: false)
        return try Self.parseSession(data)
    }

    private func refresh(_ old: AuthSession) async throws -> AuthSession {
        do {
            let data = try await raw("auth/v1/token?grant_type=refresh_token", method: "POST",
                                     body: ["refresh_token": old.refreshToken], authorized: false)
            return try Self.parseSession(data)
        } catch let error as BackendError where error.code == "400" || error.code == "401" || error.code == "403" {
            throw BackendError(message: error.message, code: "auth")
        }
    }

    nonisolated static func parseSession(_ data: Data) throws -> AuthSession {
        struct Response: Decodable {
            let access_token: String
            let refresh_token: String
            let expires_in: Double?
            let expires_at: Double?
            struct User: Decodable { let id: String }
            let user: User
        }
        guard let response = try? JSONDecoder().decode(Response.self, from: data) else {
            throw BackendError(message: "Couldn't sign in. Check anonymous sign-ins are enabled in Supabase.", code: "auth_shape")
        }
        let expiry = response.expires_at.map { Date(timeIntervalSince1970: $0) }
            ?? Date().addingTimeInterval(response.expires_in ?? 3600)
        return AuthSession(accessToken: response.access_token, refreshToken: response.refresh_token,
                           expiresAt: expiry, userID: response.user.id)
    }

    // MARK: Calls

    /// Calls a Postgres function and decodes its JSON result.
    func rpc<T: Decodable>(_ name: String, _ params: [String: Any] = [:], as type: T.Type = T.self) async throws -> T {
        let data = try await rpcData(name, params)
        do { return try Self.decoder.decode(T.self, from: data) } catch {
            throw BackendError(message: "The server sent something unexpected (\(name)).", code: "decode")
        }
    }

    func rpcData(_ name: String, _ params: [String: Any] = [:]) async throws -> Data {
        try await raw("rest/v1/rpc/\(name)", method: "POST", body: params, authorized: true)
    }

    /// Calls a Supabase edge function as the signed-in player.
    func function<T: Decodable>(_ name: String, body: [String: Any], as type: T.Type = T.self) async throws -> T {
        let data = try await raw("functions/v1/\(name)", method: "POST", body: body, authorized: true)
        do { return try Self.decoder.decode(T.self, from: data) } catch {
            throw BackendError(message: "The server sent something unexpected (\(name)).", code: "decode")
        }
    }

    private func raw(_ path: String, method: String, body: [String: Any]?, authorized: Bool, retry: Bool = true) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw BackendError(message: "Bad server address.") }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.httpMethod = method
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authorized {
            let session = try await ensureSession()
            request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        } else if anonKey.hasPrefix("eyJ") {
            // Legacy anon keys are JWTs and may be sent as a bearer token;
            // newer sb_publishable_ keys must only go in the apikey header.
            request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }

        let data: Data, status: Int
        do { (data, status) = try await transport.send(request) } catch {
            throw BackendError(message: "Can't reach the Brokie server. Check your connection.", code: "network")
        }
        if (200..<300).contains(status) { return data }
        if status == 401 && authorized && retry {
            // Token expired early or was rotated: force a refresh and retry once.
            if var stale = session { stale.expiresAt = .distantPast; session = stale }
            return try await raw(path, method: method, body: body, authorized: authorized, retry: false)
        }
        throw Self.error(from: data, status: status)
    }

    nonisolated static func error(from data: Data, status: Int) -> BackendError {
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let message = (object?["message"] ?? object?["msg"] ?? object?["error_description"] ?? object?["error"]) as? String
        return BackendError(message: message ?? "Server error (\(status)).", code: (object?["code"] as? String) ?? String(status))
    }

    // MARK: Decoding

    nonisolated static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            guard let date = parseTimestamp(text) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Bad date \(text)")
            }
            return date
        }
        return decoder
    }()

    /// Parses Postgres timestamps such as 2026-10-21T09:48:28.486033+10:00,
    /// trimming fractional seconds to milliseconds first.
    nonisolated static func parseTimestamp(_ text: String) -> Date? {
        var value = text
        if let dot = value.firstIndex(of: ".") {
            let digitsEnd = value[value.index(after: dot)...].firstIndex { !$0.isNumber } ?? value.endIndex
            let digits = value[value.index(after: dot)..<digitsEnd]
            let millis = String(digits.prefix(3)).padding(toLength: 3, withPad: "0", startingAt: 0)
            value.replaceSubrange(dot..<digitsEnd, with: "." + millis)
        }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return withFraction.date(from: value) ?? plain.date(from: value)
    }
}
