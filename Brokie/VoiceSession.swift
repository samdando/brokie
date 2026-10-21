import Foundation
import Combine

enum VoiceRoom: String, CaseIterable, Identifiable {
    case squad, gold, indices
    var id: String { rawValue }
    var title: String {
        switch self { case .squad: "Squad lounge"; case .gold: "Gold gang"; case .indices: "Index crew" }
    }
    var subtitle: String {
        switch self {
        case .squad: "Your friends. Every market."
        case .gold: "Talk Gold with your squad."
        case .indices: "NAS and ES, in good company."
        }
    }
}

enum VoiceMode: String, CaseIterable, Identifiable {
    case openMic, pushToTalk
    var id: String { rawValue }
    var title: String { self == .openMic ? "Open mic" : "Push to talk" }
}

enum VoiceConnectionState: Equatable {
    case idle, connecting, preview, connected, failed
}

struct VoiceParticipant: Identifiable, Equatable {
    let id: String
    let name: String
    var isSelf = false
    var isSpeaking = false
    var isMuted = true
    var isDemo = false
}

/// A transport must connect with the microphone disabled. Its callbacks contain
/// remote participants only and must describe the current connection, not an old room.
/// Preview transports must never activate or request access to microphone hardware.
@MainActor
protocol VoiceTransport: AnyObject {
    var isPreview: Bool { get }
    var remoteParticipantsChanged: (@MainActor ([VoiceParticipant]) -> Void)? { get set }
    var disconnected: (@MainActor (String) -> Void)? { get set }
    func connect(room: VoiceRoom) async throws
    func disconnect() async
    func setMicrophoneEnabled(_ enabled: Bool) async throws
    func setOutputEnabled(_ enabled: Bool) async throws
}

/// No audio I/O: this demonstrates the room controls without inventing a live call.
@MainActor
final class PreviewVoiceTransport: VoiceTransport {
    let isPreview = true
    var remoteParticipantsChanged: (@MainActor ([VoiceParticipant]) -> Void)?
    var disconnected: (@MainActor (String) -> Void)?
    func connect(room: VoiceRoom) async throws {}
    func disconnect() async {}
    func setMicrophoneEnabled(_ enabled: Bool) async throws {}
    func setOutputEnabled(_ enabled: Bool) async throws {}
}

@MainActor
final class VoiceSession: ObservableObject {
    @Published private(set) var state: VoiceConnectionState = .idle
    @Published private(set) var selectedRoom: VoiceRoom = .squad
    @Published private(set) var isMuted = true
    @Published private(set) var isDeafened = false
    @Published private(set) var isHoldingToTalk = false
    @Published private(set) var mode: VoiceMode = .openMic
    @Published private(set) var participants: [VoiceParticipant] = []
    @Published private(set) var errorMessage: String?
    @Published private(set) var isUpdatingControls = false

    var isJoined: Bool { state == .preview || state == .connected }
    var isLive: Bool { state == .connected }
    var isPreview: Bool { transport.isPreview }
    var microphoneEnabled: Bool {
        isJoined && !isMuted && !isDeafened && (mode == .openMic || isHoldingToTalk)
    }
    var statusText: String {
        switch state {
        case .idle: return isPreview ? "Preview only · no audio" : "Not in voice"
        case .connecting: return isPreview ? "Opening preview…" : "Connecting…"
        case .failed: return "Voice unavailable"
        case .preview:
            if isDeafened { return "Preview · deafened" }
            return microphoneEnabled ? "Preview · mic on" : "Preview · muted"
        case .connected:
            if isDeafened { return "Deafened · mic muted" }
            return microphoneEnabled ? "Mic on" : "Mic muted"
        }
    }

    private struct Controls {
        var muted = true
        var deafened = false
        var holding = false
        var mode: VoiceMode = .openMic
        var microphone: Bool { !muted && !deafened && (mode == .openMic || holding) }
    }
    private let transport: any VoiceTransport
    private var generation = 0
    private var controlRevision = 0
    private var desired = Controls()
    private var pendingOperation: Task<Void, Never>?
    private var remoteParticipants: [VoiceParticipant] = []

    /// Pass nil (the default) for the audio-free preview transport.
    init(transport: (any VoiceTransport)? = nil) {
        let transport = transport ?? PreviewVoiceTransport()
        self.transport = transport
        transport.remoteParticipantsChanged = { [weak self] participants in
            guard let self, self.isJoined else { return }
            self.remoteParticipants = participants.filter { !$0.isSelf }
            self.rebuildParticipants()
        }
        transport.disconnected = { [weak self] message in
            guard let self, self.state == .connected || self.state == .connecting else { return }
            self.generation += 1
            self.resetControls()
            self.state = .failed
            self.errorMessage = message
            self.remoteParticipants = []
            self.participants = []
            self.enqueue { [weak self] in await self?.transport.disconnect() }
        }
    }

    /// Joining or changing rooms always starts muted. Commands are serialized so
    /// a late connection cannot bring a room back after the user has left it.
    func join(room: VoiceRoom) async {
        generation += 1
        let token = generation
        selectedRoom = room
        resetControls()
        state = .connecting
        errorMessage = nil
        participants = []
        remoteParticipants = []
        await enqueue { [weak self] in
            guard let self, self.generation == token else { return }
            await self.transport.disconnect()
            guard self.generation == token else { return }
            do {
                try await self.transport.connect(room: room)
                guard self.generation == token else { await self.transport.disconnect(); return }
                try await self.transport.setMicrophoneEnabled(false)
                try await self.transport.setOutputEnabled(true)
                guard self.generation == token else { await self.transport.disconnect(); return }
                self.state = self.transport.isPreview ? .preview : .connected
                if self.transport.isPreview { self.remoteParticipants = Self.demoParticipants(for: room) }
                self.rebuildParticipants()
            } catch {
                await self.fail(error, token: token)
            }
        }.value
    }

    func leave() async {
        generation += 1
        resetControls()
        state = .idle
        errorMessage = nil
        participants = []
        remoteParticipants = []
        await enqueue { [weak self] in await self?.transport.disconnect() }.value
    }

    /// Push-to-talk uses setHoldingToTalk instead of the open-mic latch.
    func toggleMute() async {
        guard isJoined, desired.mode == .openMic, !desired.deafened else { return }
        desired.muted.toggle()
        desired.holding = false
        await updateControls().value
    }

    /// Both entering and leaving deafen retain a muted microphone.
    func toggleDeafen() async {
        guard isJoined else { return }
        desired.deafened.toggle()
        desired.muted = true
        desired.holding = false
        await updateControls().value
    }

    func setMode(_ newMode: VoiceMode) async {
        guard isJoined else { return }
        desired.mode = newMode
        desired.muted = true
        desired.holding = false
        await updateControls().value
    }

    func setHoldingToTalk(_ holding: Bool) async {
        guard isJoined, desired.mode == .pushToTalk else { return }
        desired.holding = holding && !desired.deafened
        desired.muted = !desired.holding
        await updateControls().value
    }

    /// Invoke when inactive, backgrounded, or an audio interruption begins.
    /// Returning to the app never automatically re-enables the microphone.
    func suspendMicrophone() {
        guard state == .connected || state == .preview || state == .connecting else { return }
        desired.muted = true
        desired.holding = false
        isMuted = true
        isHoldingToTalk = false
        rebuildParticipants()
        if isJoined { updateControls() }
    }

    /// Useful to deterministic tests and lifecycle cleanup; no hardware is touched here.
    func waitForPendingOperations() async { await pendingOperation?.value }

    @discardableResult
    private func updateControls() -> Task<Void, Never> {
        controlRevision += 1
        let revision = controlRevision
        let token = generation
        isUpdatingControls = true
        return enqueue { [weak self] in
            guard let self, self.generation == token, self.isJoined else { return }
            // Drop superseded presses, especially a PTT release while enable is pending.
            guard self.controlRevision == revision else { return }
            let target = self.desired
            do {
                // Mute first, then change playback, then (if still requested) enable.
                try await self.transport.setMicrophoneEnabled(false)
                guard self.generation == token, self.controlRevision == revision else { return }
                try await self.transport.setOutputEnabled(!target.deafened)
                guard self.generation == token, self.controlRevision == revision else { return }
                if target.microphone { try await self.transport.setMicrophoneEnabled(true) }
                guard self.generation == token, self.controlRevision == revision else { return }
                self.isMuted = target.muted
                self.isDeafened = target.deafened
                self.isHoldingToTalk = target.holding
                self.mode = target.mode
                self.isUpdatingControls = false
                self.rebuildParticipants()
            } catch {
                await self.fail(error, token: token)
            }
        }
    }

    private func resetControls() {
        controlRevision += 1
        desired = Controls()
        isMuted = true
        isDeafened = false
        isHoldingToTalk = false
        mode = .openMic
        isUpdatingControls = false
    }

    private func rebuildParticipants() {
        guard isJoined else { participants = []; return }
        let local = VoiceParticipant(id: "local", name: "You", isSelf: true,
                                     isSpeaking: microphoneEnabled, isMuted: !microphoneEnabled, isDemo: transport.isPreview)
        participants = [local] + remoteParticipants
    }

    private func fail(_ error: Error, token: Int) async {
        await transport.disconnect()
        guard generation == token else { return }
        generation += 1
        resetControls()
        state = .failed
        errorMessage = error.localizedDescription
        participants = []
        remoteParticipants = []
    }

    @discardableResult
    private func enqueue(_ operation: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        let previous = pendingOperation
        let task = Task { @MainActor in
            await previous?.value
            await operation()
        }
        pendingOperation = task
        return task
    }

    private static func demoParticipants(for room: VoiceRoom) -> [VoiceParticipant] {
        let names: [String]
        switch room {
        case .squad: names = ["jess.exe", "chartgremlin"]
        case .gold: names = ["goldilocks", "buyhighcry"]
        case .indices: names = ["chartgremlin", "marginmike"]
        }
        return names.enumerated().map { index, name in
            VoiceParticipant(id: "demo-\(room.rawValue)-\(index)", name: name, isMuted: index != 0, isDemo: true)
        }
    }
}
