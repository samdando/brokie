import Foundation
import LiveKit

/// Real squad voice over LiveKit when you're online and in a squad; otherwise
/// behaves exactly like the audio-free preview. VoiceSession re-reads
/// `isPreview` on every join, so going online upgrades the next call.
@MainActor
final class SquadVoiceTransport: VoiceTransport {
    weak var game: OnlineGame?
    var remoteParticipantsChanged: (@MainActor ([VoiceParticipant]) -> Void)?
    var disconnected: (@MainActor (String) -> Void)?

    private var room: Room?
    private var relay: RoomRelay?
    private var outputEnabled = true

    init(game: OnlineGame?) { self.game = game }

    var isPreview: Bool {
        guard let game else { return true }
        return !(game.isOnline && game.selectedSquad != nil)
    }

    func connect(room voiceRoom: VoiceRoom) async throws {
        guard !isPreview, let game else { return }
        let credentials = try await game.voiceCredentials(room: voiceRoom)
        let relay = RoomRelay(owner: self)
        let room = Room(delegate: relay)
        self.relay = relay
        self.room = room
        do {
            try await room.connect(url: credentials.url, token: credentials.token)
        } catch {
            self.room = nil
            self.relay = nil
            throw BackendError(message: "Couldn't join voice. \(error.localizedDescription)")
        }
        publishParticipants()
    }

    func disconnect() async {
        guard let room else { return }
        self.room = nil
        relay = nil
        await room.disconnect()
    }

    func setMicrophoneEnabled(_ enabled: Bool) async throws {
        guard let room else { return }
        try await room.localParticipant.setMicrophone(enabled: enabled)
    }

    func setOutputEnabled(_ enabled: Bool) async throws {
        outputEnabled = enabled
        guard let room else { return }
        for participant in room.remoteParticipants.values {
            for case let publication as RemoteTrackPublication in participant.audioTracks {
                try? await publication.set(enabled: enabled)
            }
        }
    }

    fileprivate func publishParticipants() {
        guard let room else { return }
        let people = room.remoteParticipants.values.map { participant in
            VoiceParticipant(id: participant.identity?.stringValue ?? UUID().uuidString,
                             name: participant.name ?? "player",
                             isSpeaking: participant.isSpeaking,
                             isMuted: !participant.isMicrophoneEnabled())
        }.sorted { $0.name < $1.name }
        remoteParticipantsChanged?(people)
    }

    fileprivate func applyOutput(to publication: RemoteTrackPublication) {
        guard !outputEnabled else { return }
        Task { try? await publication.set(enabled: false) }
    }

    fileprivate func roomDropped(_ error: Error?) {
        guard room != nil else { return }
        room = nil
        relay = nil
        disconnected?(error.map { "Voice dropped: \($0.localizedDescription)" } ?? "Voice dropped.")
    }
}

/// LiveKit calls its delegate off the main thread; hop back before touching UI state.
private final class RoomRelay: NSObject, RoomDelegate, @unchecked Sendable {
    weak var owner: SquadVoiceTransport?
    init(owner: SquadVoiceTransport) { self.owner = owner }

    private func refresh() {
        Task { @MainActor [weak self] in self?.owner?.publishParticipants() }
    }

    func room(_ room: Room, participantDidConnect participant: RemoteParticipant) { refresh() }
    func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) { refresh() }
    func room(_ room: Room, didUpdateSpeakingParticipants participants: [Participant]) { refresh() }
    func room(_ room: Room, participant: Participant, trackPublication: TrackPublication, didUpdateIsMuted isMuted: Bool) { refresh() }

    func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) {
        Task { @MainActor [weak self] in
            self?.owner?.applyOutput(to: publication)
            self?.owner?.publishParticipants()
        }
    }

    func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        Task { @MainActor [weak self] in self?.owner?.roomDropped(error) }
    }
}
