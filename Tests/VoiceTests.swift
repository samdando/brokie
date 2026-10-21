import Foundation

/// Records every hardware-facing call so tests can check the mic is never
/// enabled when it should not be.
@MainActor
final class RecordingTransport: VoiceTransport {
    let isPreview: Bool
    var remoteParticipantsChanged: (@MainActor ([VoiceParticipant]) -> Void)?
    var disconnected: (@MainActor (String) -> Void)?
    var micEnabled = false
    var outputEnabled = false
    var connectedRoom: VoiceRoom?
    var failNextConnect = false
    var connectDelay: Duration = .zero
    init(isPreview: Bool) { self.isPreview = isPreview }
    func connect(room: VoiceRoom) async throws {
        if failNextConnect { failNextConnect = false; throw URLError(.cannotConnectToHost) }
        if connectDelay > .zero { try await Task.sleep(for: connectDelay) }
        connectedRoom = room
    }
    func disconnect() async { connectedRoom = nil; micEnabled = false }
    func setMicrophoneEnabled(_ enabled: Bool) async throws { micEnabled = enabled }
    func setOutputEnabled(_ enabled: Bool) async throws { outputEnabled = enabled }
}

@main
struct VoiceTests {
    @MainActor
    static func main() async {
        var checks = 0
        func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
            checks += 1
            if !condition() { fatalError("FAIL: \(message)") }
        }

        let preview = VoiceSession()
        expect(preview.isPreview && preview.state == .idle && preview.statusText == "Preview only · no audio", "starts idle preview")
        await preview.join(room: .gold)
        expect(preview.state == .preview && preview.selectedRoom == .gold, "joins preview room")
        expect(preview.isMuted && !preview.microphoneEnabled, "joins muted")
        expect(preview.participants.first?.isSelf == true && preview.participants.count == 3, "lists you plus demo players")
        expect(preview.participants.dropFirst().allSatisfy(\.isDemo), "demo players are labeled demo")
        await preview.toggleMute()
        expect(preview.microphoneEnabled && preview.statusText == "Preview · mic on", "unmutes open mic")
        await preview.toggleDeafen()
        expect(preview.isDeafened && !preview.microphoneEnabled, "deafen mutes mic")
        await preview.toggleMute()
        expect(!preview.microphoneEnabled, "cannot unmute while deafened")
        await preview.toggleDeafen()
        expect(!preview.isDeafened && preview.isMuted, "undeafen stays muted")
        await preview.leave()
        expect(preview.state == .idle && preview.participants.isEmpty, "leaves room")

        let transport = RecordingTransport(isPreview: false)
        let live = VoiceSession(transport: transport)
        await live.join(room: .squad)
        expect(live.state == .connected && transport.connectedRoom == .squad, "connects real transport")
        expect(!transport.micEnabled && transport.outputEnabled, "connects with mic off and audio on")
        await live.toggleMute()
        expect(transport.micEnabled, "open mic enables hardware mic")
        live.suspendMicrophone()
        await live.waitForPendingOperations()
        expect(!transport.micEnabled && live.isMuted, "backgrounding mutes mic")
        await live.setMode(.pushToTalk)
        expect(live.mode == .pushToTalk && !transport.micEnabled, "push-to-talk starts released")
        await live.toggleMute()
        expect(!transport.micEnabled, "mute toggle ignored in push-to-talk")
        await live.setHoldingToTalk(true)
        expect(transport.micEnabled && live.isHoldingToTalk, "holding enables mic")
        await live.setHoldingToTalk(false)
        expect(!transport.micEnabled && !live.isHoldingToTalk, "release disables mic")
        await live.toggleDeafen()
        await live.setHoldingToTalk(true)
        expect(!transport.micEnabled && live.isDeafened, "deafened push-to-talk stays silent")
        await live.toggleDeafen()

        await live.join(room: .indices)
        expect(transport.connectedRoom == .indices && live.isMuted && live.mode == .openMic, "switching rooms resets to muted open mic")
        transport.remoteParticipantsChanged?([VoiceParticipant(id: "r1", name: "remote", isMuted: false)])
        expect(live.participants.count == 2 && live.participants[1].name == "remote", "shows remote participants")
        transport.disconnected?("Connection lost")
        await live.waitForPendingOperations()
        expect(live.state == .failed && live.errorMessage == "Connection lost" && live.participants.isEmpty, "surfaces dropped connection")

        transport.failNextConnect = true
        await live.join(room: .gold)
        expect(live.state == .failed && !transport.micEnabled, "failed connect leaves mic off")
        await live.join(room: .gold)
        expect(live.state == .connected, "can rejoin after failure")

        // A late join must not resurrect a room the user already left.
        let slow = RecordingTransport(isPreview: false)
        slow.connectDelay = .milliseconds(80)
        let racer = VoiceSession(transport: slow)
        let joining = Task { await racer.join(room: .squad) }
        while racer.state != .connecting { await Task.yield() }
        await racer.leave()
        await joining.value
        await racer.waitForPendingOperations()
        expect(racer.state == .idle && slow.connectedRoom == nil && !slow.micEnabled, "leave wins over in-flight join")

        print("PASS: \(checks) voice assertions")
    }
}
