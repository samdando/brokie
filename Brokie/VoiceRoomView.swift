import SwiftUI

/// Squad voice rooms: pick a room, then mute, deafen, push-to-talk or leave.
/// In this build the transport is a preview, so no audio is captured or sent.
struct VoiceRoomCard: View {
    @EnvironmentObject private var voice: VoiceSession
    @State private var pressing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("VOICE").font(.system(size: 9, weight: .bold, design: .monospaced)).tracking(1.3).foregroundStyle(Ink.muted)
                Spacer()
                if voice.isPreview {
                    Text("PREVIEW · NO AUDIO").font(.system(size: 8, weight: .bold, design: .monospaced))
                        .foregroundStyle(Ink.purple).padding(.horizontal, 8).padding(.vertical, 6)
                        .background(Ink.purple.opacity(0.1), in: Capsule())
                }
            }
            if voice.isJoined || voice.state == .connecting {
                joinedRoom
            } else {
                roomPicker
            }
            if let error = voice.errorMessage {
                Text(error).font(.system(size: 12)).foregroundStyle(Ink.red).accessibilityIdentifier("voice-error")
            }
        }
        .padding(20)
        .background(Ink.panel, in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(voice.isJoined ? Ink.lime.opacity(0.35) : Ink.line))
    }

    private var roomPicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Hop on the call.").font(.system(size: 23, weight: .semibold, design: .rounded)).tracking(-0.6)
            Text("Talk through trades live with your squad. You always join muted.")
                .font(.system(size: 12)).foregroundStyle(Ink.muted).lineSpacing(3)
            ForEach(VoiceRoom.allCases) { room in
                Button { Task { await voice.join(room: room) } } label: {
                    HStack(spacing: 12) {
                        Image(systemName: icon(for: room)).font(.system(size: 13, weight: .bold)).foregroundStyle(Ink.lime)
                            .frame(width: 34, height: 34).background(Ink.lime.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(room.title).font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                            Text(room.subtitle).font(.system(size: 11)).foregroundStyle(Ink.muted)
                        }
                        Spacer()
                        Text("JOIN").font(.system(size: 9, weight: .heavy, design: .monospaced)).foregroundStyle(Ink.lime)
                    }
                    .padding(12)
                    .background(Ink.background, in: RoundedRectangle(cornerRadius: 13))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Join \(room.title)")
                .accessibilityIdentifier("voice-join-\(room.rawValue)")
            }
        }
    }

    private var joinedRoom: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(voice.selectedRoom.title).font(.system(size: 23, weight: .semibold, design: .rounded)).tracking(-0.6)
                    HStack(spacing: 6) {
                        Circle().fill(voice.microphoneEnabled ? Ink.lime : Ink.muted).frame(width: 6, height: 6)
                        Text(voice.statusText).font(.system(size: 11, weight: .medium)).foregroundStyle(Ink.muted)
                            .accessibilityIdentifier("voice-status")
                    }
                }
                Spacer()
                if voice.state == .connecting { ProgressView().tint(Ink.lime) }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(voice.participants) { person in ParticipantBubble(person: person) }
                }
                .padding(.vertical, 4)
            }

            if voice.isJoined {
                modePicker
                if voice.mode == .pushToTalk { holdToTalk }
                HStack(spacing: 10) {
                    if voice.mode == .openMic {
                        controlButton(voice.isMuted ? "Unmute" : "Mute",
                                      icon: voice.isMuted ? "mic.slash.fill" : "mic.fill",
                                      active: !voice.isMuted, id: "voice-mute") { await voice.toggleMute() }
                            .disabled(voice.isDeafened)
                    }
                    controlButton(voice.isDeafened ? "Undeafen" : "Deafen",
                                  icon: voice.isDeafened ? "speaker.slash.fill" : "speaker.wave.2.fill",
                                  active: voice.isDeafened, id: "voice-deafen") { await voice.toggleDeafen() }
                    controlButton("Leave", icon: "phone.down.fill", active: false, destructive: true, id: "voice-leave") {
                        await voice.leave()
                    }
                }
            }
        }
    }

    private var modePicker: some View {
        HStack(spacing: 6) {
            ForEach(VoiceMode.allCases) { option in
                Button { Task { await voice.setMode(option) } } label: {
                    Text(option.title).font(.system(size: 11, weight: .bold)).frame(maxWidth: .infinity).frame(height: 32)
                        .foregroundStyle(voice.mode == option ? Ink.background : Ink.muted)
                        .background(voice.mode == option ? Ink.lime : Ink.background, in: RoundedRectangle(cornerRadius: 9))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(voice.mode == option ? .isSelected : [])
                .accessibilityIdentifier("voice-mode-\(option.rawValue)")
            }
        }
    }

    private var holdToTalk: some View {
        let holding = voice.isHoldingToTalk
        return Text(voice.isDeafened ? "Undeafen to talk" : (holding ? "Talking…" : "Hold to talk"))
            .font(.system(size: 14, weight: .bold))
            .frame(maxWidth: .infinity).frame(height: 56)
            .foregroundStyle(holding ? Ink.background : Ink.lime)
            .background(holding ? Ink.lime : Ink.lime.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Ink.lime.opacity(0.5)))
            .scaleEffect(holding ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: holding)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !pressing else { return }
                        pressing = true
                        Task { await voice.setHoldingToTalk(true) }
                    }
                    .onEnded { _ in
                        pressing = false
                        Task { await voice.setHoldingToTalk(false) }
                    }
            )
            .sensoryFeedback(.impact(weight: .light), trigger: holding)
            .accessibilityLabel("Hold to talk")
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("voice-hold")
    }

    private func controlButton(_ title: String, icon: String, active: Bool, destructive: Bool = false, id: String,
                               action: @escaping @MainActor () async -> Void) -> some View {
        Button { Task { await action() } } label: {
            VStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 15, weight: .semibold))
                Text(title).font(.system(size: 10, weight: .semibold))
            }
            .frame(maxWidth: .infinity).frame(height: 58)
            .foregroundStyle(destructive ? Ink.red : (active ? Ink.background : .white))
            .background(destructive ? Ink.red.opacity(0.11) : (active ? Ink.lime : Ink.background), in: RoundedRectangle(cornerRadius: 13))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    private func icon(for room: VoiceRoom) -> String {
        switch room { case .squad: "person.3.fill"; case .gold: "hexagon.fill"; case .indices: "chart.line.uptrend.xyaxis" }
    }
}

private struct ParticipantBubble: View {
    let person: VoiceParticipant

    var body: some View {
        VStack(spacing: 6) {
            ZStack(alignment: .bottomTrailing) {
                Text(String(person.name.prefix(1)).uppercased())
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(person.isSelf ? Ink.background : Ink.purple)
                    .frame(width: 46, height: 46)
                    .background(person.isSelf ? Ink.lime : Ink.purple.opacity(0.14), in: Circle())
                    .overlay(Circle().stroke(Ink.lime, lineWidth: person.isSpeaking ? 2.5 : 0).padding(-3))
                if person.isMuted {
                    Image(systemName: "mic.slash.fill").font(.system(size: 8, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 17, height: 17).background(Ink.red, in: Circle())
                        .overlay(Circle().stroke(Ink.panel, lineWidth: 2))
                }
            }
            Text(person.isSelf ? "You" : person.name).font(.system(size: 10, weight: .semibold)).lineLimit(1)
            if person.isDemo && !person.isSelf {
                Text("DEMO").font(.system(size: 7, weight: .bold, design: .monospaced)).foregroundStyle(Ink.muted)
            }
        }
        .frame(width: 62)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(person.isSelf ? "You" : person.name)\(person.isMuted ? ", muted" : "")\(person.isSpeaking ? ", speaking" : "")\(person.isDemo && !person.isSelf ? ", demo player" : "")")
    }
}

/// A slim "you're in voice" bar shown above the tab bar on other tabs.
struct VoiceMiniBar: View {
    @EnvironmentObject private var voice: VoiceSession
    let onOpen: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: voice.microphoneEnabled ? "waveform" : "mic.slash.fill")
                .font(.system(size: 12, weight: .bold)).foregroundStyle(voice.microphoneEnabled ? Ink.lime : Ink.muted)
                .symbolEffect(.variableColor.iterative, isActive: voice.microphoneEnabled)
            Button(action: onOpen) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(voice.selectedRoom.title).font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                        Text(voice.statusText).font(.system(size: 10)).foregroundStyle(Ink.muted)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("voice-minibar")
            if voice.mode == .openMic {
                Button { Task { await voice.toggleMute() } } label: {
                    Image(systemName: voice.isMuted ? "mic.slash.fill" : "mic.fill").font(.system(size: 13, weight: .semibold))
                        .frame(width: 36, height: 36).foregroundStyle(voice.isMuted ? .white : Ink.background)
                        .background(voice.isMuted ? Ink.background : Ink.lime, in: Circle())
                }
                .buttonStyle(.plain).disabled(voice.isDeafened)
                .accessibilityLabel(voice.isMuted ? "Unmute" : "Mute")
            }
            Button { Task { await voice.leave() } } label: {
                Image(systemName: "phone.down.fill").font(.system(size: 12, weight: .semibold))
                    .frame(width: 36, height: 36).foregroundStyle(Ink.red).background(Ink.red.opacity(0.12), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Leave voice")
        }
        .padding(.leading, 14).padding(.trailing, 8).padding(.vertical, 8)
        .background(Ink.panel, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Ink.lime.opacity(0.25)))
        .padding(.horizontal, 12).padding(.bottom, 6)
    }
}
