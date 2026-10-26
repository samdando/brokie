import SwiftUI

@main
struct BrokieApp: App {
    @StateObject private var practice: TradingEngine
    @StateObject private var game: OnlineGame
    /// Real LiveKit voice when online in a squad; the audio-free preview otherwise.
    @StateObject private var voice: VoiceSession
    @State private var nativeOpen = false
    private let uiTesting: Bool
    private let preferences: UserDefaults

    init() {
        let arguments = ProcessInfo.processInfo.arguments
        let store: UserDefaults
        let uiTesting = arguments.contains("--uitesting")
        self.uiTesting = uiTesting
        if uiTesting {
            let suite = "com.brokie.papertrade.uitests"
            let isolated = UserDefaults(suiteName: suite)!
            if !arguments.contains("--preserve-ui-state") {
                isolated.removePersistentDomain(forName: suite)
            }
            store = isolated
        } else {
            store = .standard
        }
        preferences = store
        _practice = StateObject(wrappedValue: TradingEngine(storage: store))
        // UI tests always run the offline practice game.
        let game = uiTesting ? OnlineGame(client: nil, defaults: store) : OnlineGame.live()
        _game = StateObject(wrappedValue: game)
        _voice = StateObject(wrappedValue: VoiceSession(transport: SquadVoiceTransport(game: game)))
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if uiTesting {
                    RootView(practice: practice)
                } else {
                    LiveFloorView(onNative: { nativeOpen = true })
                        .fullScreenCover(isPresented: $nativeOpen) {
                            VStack(spacing: 0) {
                                HStack { Text("Original native client").font(.caption); Spacer(); Button("Back to live floor") { nativeOpen = false } }.padding()
                                RootView(practice: practice)
                            }.background(Ink.background)
                        }
                }
            }
                .environmentObject(game)
                .environmentObject(voice)
                .defaultAppStorage(preferences)
                .preferredColorScheme(.dark)
        }
    }
}

/// Picks which account the screens show: the server-mirrored season account
/// when online, the local practice account otherwise.
private struct RootView: View {
    @EnvironmentObject private var game: OnlineGame
    @EnvironmentObject private var voice: VoiceSession
    let practice: TradingEngine

    var body: some View {
        ContentView()
            .environmentObject(game.isOnline ? game.engine : practice)
            .onChange(of: game.selectedSquadID) { _, _ in
                if voice.isJoined || voice.state == .connecting { Task { await voice.leave() } }
            }
            .onChange(of: game.isOnline) { _, _ in
                if voice.isJoined || voice.state == .connecting { Task { await voice.leave() } }
            }
    }
}
