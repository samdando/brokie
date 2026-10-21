import SwiftUI

// MARK: - Shared bits

/// "4d 6h", "6h 12m", "12m" until the season resets.
func seasonCountdown(to end: Date?, now: Date = Date()) -> String {
    guard let end else { return "—" }
    let seconds = max(0, Int(end.timeIntervalSince(now)))
    let days = seconds / 86_400, hours = (seconds % 86_400) / 3_600, minutes = (seconds % 3_600) / 60
    if days > 0 { return "\(days)d \(hours)h" }
    if hours > 0 { return "\(hours)h \(minutes)m" }
    return "\(max(1, minutes))m"
}

private func points(_ value: Double) -> String { BrokieChart.format(value) }

private struct Avatar: View {
    let handle: String
    var highlighted = false
    var size: CGFloat = 35
    var body: some View {
        Text(String(handle.prefix(1)).uppercased())
            .font(.system(size: size * 0.38, weight: .bold))
            .foregroundStyle(highlighted ? Ink.background : Ink.purple)
            .frame(width: size, height: size)
            .background(highlighted ? Ink.lime : Ink.purple.opacity(0.12), in: Circle())
    }
}

private struct FieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content.font(.system(size: 17, weight: .medium)).padding(16)
            .background(Ink.background, in: RoundedRectangle(cornerRadius: 13))
            .overlay(RoundedRectangle(cornerRadius: 13).stroke(Ink.line))
    }
}

private struct PrimaryButton: View {
    let title: String
    var busy = false
    var enabled = true
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title).opacity(busy ? 0 : 1)
                if busy { ProgressView().tint(Ink.background) }
            }
            .font(.system(size: 15, weight: .bold)).frame(maxWidth: .infinity).frame(height: 52)
            .foregroundStyle(Ink.background)
            .background(enabled ? Ink.lime : Ink.lime.opacity(0.35), in: RoundedRectangle(cornerRadius: 14))
        }
        .disabled(!enabled || busy)
    }
}

// MARK: - Onboarding

/// First launch online: pick the handle your squad will see.
struct OnboardingView: View {
    @EnvironmentObject private var game: OnlineGame
    @State private var handle = ""
    @State private var error: String?
    @State private var busy = false
    @State private var showRestore = false
    @FocusState private var focused: Bool

    private var clean: String { handle.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "_" } }

    var body: some View {
        ZStack {
            Ink.background.ignoresSafeArea()
            RadialGradient(colors: [Ink.lime.opacity(0.14), .clear], center: .topTrailing, startRadius: 10, endRadius: 420)
                .ignoresSafeArea()
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    Text("brokie").font(.system(size: 44, weight: .black, design: .rounded)).tracking(-2.4)
                    Circle().fill(Ink.lime).frame(width: 11, height: 11).offset(y: 12)
                }
                .padding(.top, 40)
                Text("All the market.\nNone of the rent money.")
                    .font(.system(size: 30, weight: .semibold, design: .rounded)).tracking(-1)
                    .padding(.top, 28)
                VStack(alignment: .leading, spacing: 12) {
                    onboardingPoint("chart.xyaxis.line", "Real Gold, NAS and ES prices. Fake $100k.")
                    onboardingPoint("trophy.fill", "8-week prop challenge: don't blow 10%, hit +10%.")
                    onboardingPoint("waveform", "Talk trades live with your mates.")
                }
                .padding(.top, 26)
                Spacer()
                eyebrow("PICK YOUR HANDLE")
                HStack(spacing: 2) {
                    Text("@").foregroundStyle(Ink.muted)
                    TextField("chartgremlin", text: $handle)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .focused($focused).submitLabel(.go).onSubmit(submit)
                        .accessibilityIdentifier("onboarding-handle")
                }
                .modifier(FieldStyle()).padding(.top, 10)
                .onChange(of: handle) { _, value in if value.count > 18 { handle = String(value.prefix(18)) } }
                if let error {
                    Text(error).font(.system(size: 12)).foregroundStyle(Ink.red).padding(.top, 8)
                        .accessibilityIdentifier("onboarding-error")
                } else {
                    Text("3–18 letters, numbers or _. No email, no password.")
                        .font(.system(size: 11)).foregroundStyle(Ink.muted).padding(.top, 8)
                }
                PrimaryButton(title: "Let's go", busy: busy, enabled: clean.count >= 3, action: submit)
                    .padding(.top, 16).accessibilityIdentifier("onboarding-go")
                Button { showRestore = true } label: {
                    Text("New phone? **Restore with a backup code**").font(.system(size: 12)).foregroundStyle(Ink.muted)
                        .frame(maxWidth: .infinity).padding(.top, 14)
                }.accessibilityIdentifier("onboarding-restore")
            }
            .padding(.horizontal, 24).padding(.bottom, 16)
        }
        .foregroundStyle(.white)
        .onAppear { focused = true }
        .sheet(isPresented: $showRestore) { RestoreSheet().environmentObject(game).presentationDetents([.large]) }
    }

    private func onboardingPoint(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 12, weight: .bold)).foregroundStyle(Ink.lime)
                .frame(width: 30, height: 30).background(Ink.lime.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
            Text(text).font(.system(size: 14)).foregroundStyle(.white.opacity(0.85))
        }
    }

    private func submit() {
        guard clean.count >= 3, !busy else { return }
        busy = true
        error = nil
        Task {
            do { try await game.claimHandle(clean) } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}

// MARK: - Squad screen (online)

struct OnlineSquadScreen: View {
    @EnvironmentObject private var game: OnlineGame
    @State private var showAddSquad = false
    @State private var confirmLeave: Squad?

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            pageTitle("Good friends.\nQuestionable trades.", subtitle: "Bragging rights are the only payout.")
            if game.squads.isEmpty {
                SquadStarter()
            } else {
                squadSwitcher
                if let squad = game.selectedSquad {
                    squadCard(squad)
                    VoiceRoomCard()
                    leaderboard
                }
            }
        }
        .sheet(isPresented: $showAddSquad) {
            ScrollView { SquadStarter { showAddSquad = false }.padding(24).padding(.top, 12) }
                .background(Ink.background).presentationDetents([.large]).presentationDragIndicator(.visible)
        }
        .confirmationDialog("Leave \(confirmLeave?.name ?? "squad")?", isPresented: Binding(get: { confirmLeave != nil }, set: { if !$0 { confirmLeave = nil } }),
                            titleVisibility: .visible) {
            Button("Leave squad", role: .destructive) {
                if let squad = confirmLeave { Task { try? await game.leaveSquad(squad) } }
            }
        } message: { Text("You can rejoin any time with the invite code.") }
    }

    private var squadSwitcher: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(game.squads) { squad in
                    Button { game.selectedSquadID = squad.id } label: {
                        Text(squad.name).font(.system(size: 12, weight: .bold)).lineLimit(1)
                            .padding(.horizontal, 14).frame(height: 34)
                            .foregroundStyle(squad.id == game.selectedSquad?.id ? Ink.background : .white)
                            .background(squad.id == game.selectedSquad?.id ? Ink.lime : Ink.panel, in: Capsule())
                    }.buttonStyle(.plain)
                }
                Button { showAddSquad = true } label: {
                    Label("Squad", systemImage: "plus").font(.system(size: 12, weight: .bold))
                        .padding(.horizontal, 14).frame(height: 34).foregroundStyle(Ink.lime)
                        .overlay(Capsule().stroke(Ink.lime.opacity(0.4)))
                }.buttonStyle(.plain).accessibilityIdentifier("add-squad")
            }
        }
    }

    private func squadCard(_ squad: Squad) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                eyebrow("YOUR SQUAD · \(squad.memberCount) \(squad.memberCount == 1 ? "PLAYER" : "PLAYERS")")
                Spacer()
                Menu {
                    Button(role: .destructive) { confirmLeave = squad } label: { Label("Leave squad", systemImage: "rectangle.portrait.and.arrow.right") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 14, weight: .bold)).foregroundStyle(Ink.muted)
                        .frame(width: 32, height: 24)
                }
            }
            HStack(alignment: .top) {
                Text(squad.name).font(.system(size: 29, weight: .semibold, design: .rounded)).tracking(-1)
                    .accessibilityIdentifier("squad-title")
                Spacer()
                Image(systemName: "flag.checkered").font(.system(size: 28)).foregroundStyle(Ink.lime)
            }
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("INVITE CODE").font(.system(size: 8, weight: .bold, design: .monospaced)).tracking(1).foregroundStyle(Ink.muted)
                    Text(squad.inviteCode).font(.system(size: 24, weight: .bold, design: .monospaced)).tracking(4)
                        .textSelection(.enabled).accessibilityIdentifier("invite-code")
                }
                Spacer()
                ShareLink(item: "Join my squad on Brokie 📈 Paper-trade Gold, NAS & ES with real prices and fake money. Invite code: \(squad.inviteCode)") {
                    Label("Invite", systemImage: "square.and.arrow.up").font(.system(size: 13, weight: .bold))
                        .padding(.horizontal, 16).frame(height: 42).foregroundStyle(Ink.background)
                        .background(Ink.lime, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .padding(14).background(Ink.background, in: RoundedRectangle(cornerRadius: 14))
            if squad.memberCount == 1 {
                Text("It's just you so far. Send the code to the group chat.").font(.system(size: 12)).foregroundStyle(Ink.muted)
            }
        }
        .padding(20).background(Ink.panel, in: RoundedRectangle(cornerRadius: 20))
    }

    private var leaderboard: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("Season \(game.seasonNumber)").font(.system(size: 17, weight: .semibold, design: .rounded))
                Spacer()
                Text("ENDS IN \(seasonCountdown(to: game.seasonEndsAt, now: game.serverNow).uppercased())")
                    .font(.system(size: 8, weight: .bold, design: .monospaced)).tracking(0.8).foregroundStyle(Ink.muted)
            }.padding(.bottom, 12)
            if game.leaderboard.isEmpty {
                ProgressView().tint(Ink.lime).frame(maxWidth: .infinity).padding(30)
            }
            ForEach(Array(game.leaderboard.enumerated()), id: \.element.id) { index, row in
                HStack(spacing: 12) {
                    ZStack {
                        if index == 0 && row.returnPct > 0 {
                            Image(systemName: "crown.fill").font(.system(size: 13)).foregroundStyle(Ink.gold)
                        } else {
                            Text(String(format: "%02d", index + 1)).font(.system(size: 12, weight: .semibold, design: .monospaced)).foregroundStyle(Ink.muted)
                        }
                    }.frame(width: 22)
                    Avatar(handle: row.handle, highlighted: row.isYou)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text("@\(row.handle)").font(.system(size: 13, weight: .semibold)).lineLimit(1)
                            if row.openPositions > 0 {
                                Circle().fill(Ink.lime).frame(width: 5, height: 5).accessibilityLabel("in a trade")
                            }
                            StatusChips(row: row)
                        }
                        Text((row.qualified == false ? "\(row.tradingDays ?? 0)/5 days · " : "") + (row.trades == 0 ? (row.openPositions > 0 ? "In a trade" : "No trades yet")
                             : "\(row.trades) \(row.trades == 1 ? "trade" : "trades") · worst \(signedMoney(row.worstTrade))"))
                            .font(.system(size: 10)).foregroundStyle(Ink.muted)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 3) {
                        Text(String(format: "%+.2f%%", row.returnPct)).font(.system(size: 14, weight: .semibold, design: .monospaced))
                            .foregroundStyle(row.returnPct >= 0 ? Ink.lime : Ink.red)
                        Text(money(row.equity, decimals: 0)).font(.system(size: 9, design: .monospaced)).foregroundStyle(Ink.muted)
                    }
                }
                .padding(.vertical, 13).padding(.horizontal, 12)
                .background(row.isYou ? Ink.lime.opacity(0.06) : .clear, in: RoundedRectangle(cornerRadius: 12))
                .opacity(row.qualified == false ? 0.7 : 1).grayscale(row.status == "blown" ? 0.8 : 0)
                if index < game.leaderboard.count - 1 { Rectangle().fill(Ink.line).frame(height: 1) }
            }
            Text("Prop rules: 5% daily loss, 10% trailing drawdown, +10% to get funded. 5 trading days to qualify (faded rows haven't yet).")
                .font(.system(size: 10)).foregroundStyle(Ink.muted).padding(.top, 12).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Create a squad or join one with a code.
struct SquadStarter: View {
    @EnvironmentObject private var game: OnlineGame
    var onDone: (() -> Void)?
    @State private var name = ""
    @State private var code = ""
    @State private var busy: String?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 14) {
                eyebrow("START A SQUAD")
                Text("Name the group chat.").font(.system(size: 23, weight: .semibold, design: .rounded)).tracking(-0.6)
                TextField("The rent money club", text: $name).modifier(FieldStyle())
                    .onChange(of: name) { _, value in if value.count > 32 { name = String(value.prefix(32)) } }
                    .accessibilityIdentifier("new-squad-name")
                PrimaryButton(title: "Create squad", busy: busy == "create", enabled: !name.trimmingCharacters(in: .whitespaces).isEmpty) {
                    run("create") { try await game.createSquad(named: name.trimmingCharacters(in: .whitespaces)) }
                }.accessibilityIdentifier("create-squad-online")
            }
            .padding(20).background(Ink.panel, in: RoundedRectangle(cornerRadius: 20))

            VStack(alignment: .leading, spacing: 14) {
                eyebrow("GOT A CODE?")
                Text("Join your mates.").font(.system(size: 23, weight: .semibold, design: .rounded)).tracking(-0.6)
                TextField("ABC123", text: $code)
                    .font(.system(size: 22, weight: .bold, design: .monospaced))
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    .padding(16).background(Ink.background, in: RoundedRectangle(cornerRadius: 13))
                    .overlay(RoundedRectangle(cornerRadius: 13).stroke(Ink.line))
                    .onChange(of: code) { _, value in
                        let cleaned = String(value.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(6))
                        if cleaned != value { code = cleaned }
                    }
                    .accessibilityIdentifier("join-code")
                PrimaryButton(title: "Join squad", busy: busy == "join", enabled: code.count == 6) {
                    run("join") { try await game.joinSquad(code: code) }
                }.accessibilityIdentifier("join-squad")
            }
            .padding(20).background(Ink.panel, in: RoundedRectangle(cornerRadius: 20))

            if let error {
                Text(error).font(.system(size: 12)).foregroundStyle(Ink.red).accessibilityIdentifier("squad-error")
            }
        }
    }

    private func run(_ kind: String, _ work: @escaping @MainActor () async throws -> Void) {
        busy = kind
        error = nil
        Task {
            do { try await work(); onDone?() } catch { self.error = error.localizedDescription }
            busy = nil
        }
    }
}

// MARK: - The pit (squad feed)

struct FeedRow: View {
    let event: FeedEvent

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            Avatar(handle: event.handle, highlighted: event.isYou, size: 33)
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(event.isYou ? "You" : "@\(event.handle)").font(.system(size: 12, weight: .bold))
                    Text(event.at, style: .relative).font(.system(size: 9)).foregroundStyle(Ink.muted)
                    Spacer()
                    Text(event.kind == "rekt" || event.kind == "funded" ? "" : "\(event.market.title) \(event.side == .long ? "↑" : "↓")").font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(event.side == .long ? Ink.lime : Ink.red)
                }
                Text(headline).font(.system(size: 13)).foregroundStyle(.white.opacity(0.85))
            }
        }
        .padding(14).background(Ink.panel, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
    }

    private var headline: AttributedString {
        if event.kind == "rekt" { var t = AttributedString("💀 Blew the account. REKT."); t.foregroundColor = Color(white: 0.75); return t }
        if event.kind == "funded" { var t = AttributedString("🏆 Hit +10%. FUNDED."); t.foregroundColor = Ink.gold; return t }
        let size = "\(event.quantity) \(event.market.title)"
        if event.isClose, let pnl = event.pnl {
            var text = AttributedString(event.reason == "liquidated" ? "Got liquidated on \(size) " : "Closed \(event.side.rawValue) \(size) ")
            var result = AttributedString(signedMoney(pnl))
            result.foregroundColor = pnl >= 0 ? Ink.lime : Ink.red
            result.font = .system(size: 13, weight: .bold, design: .monospaced)
            text.append(result)
            if event.reason != "liquidated" { text.append(AttributedString(pnl >= 0 ? " 🔥" : " 💀")) }
            return text
        }
        return AttributedString("Went \(event.side.rawValue) \(size) at \(points(event.price))")
    }
}

// MARK: - Trade cards

struct TradeCardView: View {
    let trade: ClosedTrade
    let handle: String

    private var movePoints: Double { (trade.exitPrice - trade.entryPrice) * trade.side.direction }
    private var tint: Color { trade.pnl >= 0 ? Ink.lime : Ink.red }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                HStack(spacing: 4) {
                    Text("brokie").font(.system(size: 22, weight: .black, design: .rounded)).tracking(-1.2)
                    Circle().fill(Ink.lime).frame(width: 6, height: 6).offset(y: 6)
                }
                Spacer()
                Text("PAPER TRADE").font(.system(size: 8, weight: .heavy, design: .monospaced)).tracking(1.2).foregroundStyle(Ink.lime)
                    .padding(.horizontal, 9).padding(.vertical, 6).overlay(Capsule().stroke(Ink.lime.opacity(0.4)))
            }
            Spacer()
            HStack(spacing: 10) {
                marketBadge(trade.market, size: 40)
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(trade.side.title.uppercased()) \(trade.market.title) ×\(trade.quantity)")
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                    Text("\(trade.market.subtitle) · \(trade.market.symbol)").font(.system(size: 10)).foregroundStyle(Ink.muted)
                }
            }
            Text(signedMoney(trade.pnl)).font(.system(size: 54, weight: .bold, design: .rounded)).tracking(-2.5)
                .foregroundStyle(tint).minimumScaleFactor(0.5).lineLimit(1).padding(.top, 14)
            Text("\(points(trade.entryPrice)) → \(points(trade.exitPrice))  ·  \(movePoints >= 0 ? "+" : "−")\(points(abs(movePoints))) pts")
                .font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundStyle(.white.opacity(0.7))
            Spacer()
            HStack {
                Text("@\(handle)").font(.system(size: 13, weight: .bold))
                Spacer()
                Text(trade.closedAt.formatted(date: .abbreviated, time: .shortened)).font(.system(size: 10)).foregroundStyle(Ink.muted)
            }
            Text("Fake money. Real bragging rights.").font(.system(size: 9, weight: .medium)).foregroundStyle(Ink.muted).padding(.top, 6)
        }
        .padding(24)
        .frame(width: 340, height: 425)
        .background {
            ZStack {
                Ink.background
                RadialGradient(colors: [tint.opacity(0.22), .clear], center: .topTrailing, startRadius: 4, endRadius: 360)
                LinearGradient(colors: [.clear, tint.opacity(0.06)], startPoint: .top, endPoint: .bottom)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 28))
        .overlay(RoundedRectangle(cornerRadius: 28).stroke(Ink.line))
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
    }
}

struct TradeCardSheet: View {
    let trade: ClosedTrade
    let handle: String
    @Environment(\.dismiss) private var dismiss
    @State private var image: Image?

    var body: some View {
        VStack(spacing: 22) {
            HStack {
                eyebrow("TRADE CARD")
                Spacer()
                Button("Done") { dismiss() }.font(.system(size: 13, weight: .bold)).foregroundStyle(Ink.lime)
            }
            TradeCardView(trade: trade, handle: handle)
                .shadow(color: (trade.pnl >= 0 ? Ink.lime : Ink.red).opacity(0.15), radius: 30, y: 10)
            if let image {
                ShareLink(item: image, preview: SharePreview("Brokie trade card", image: image)) {
                    Label("Share to the group chat", systemImage: "square.and.arrow.up")
                        .font(.system(size: 15, weight: .bold)).frame(maxWidth: .infinity).frame(height: 52)
                        .foregroundStyle(Ink.background).background(Ink.lime, in: RoundedRectangle(cornerRadius: 14))
                }.accessibilityIdentifier("share-card")
            } else {
                ProgressView().tint(Ink.lime).frame(height: 52)
            }
            Spacer(minLength: 0)
        }
        .padding(24).background(Ink.background)
        .task { render() }
    }

    @MainActor private func render() {
        let renderer = ImageRenderer(content: TradeCardView(trade: trade, handle: handle))
        renderer.scale = 3
        if let uiImage = renderer.uiImage { image = Image(uiImage: uiImage) }
    }
}

// MARK: - Handle editor

struct HandleEditor: View {
    @EnvironmentObject private var game: OnlineGame
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            eyebrow("CHANGE YOUR HANDLE")
            Text("New name, same bad takes.").font(.system(size: 26, weight: .bold, design: .rounded)).tracking(-0.8)
            HStack(spacing: 2) {
                Text("@").foregroundStyle(Ink.muted)
                TextField("handle", text: $draft).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .onChange(of: draft) { _, value in
                        let cleaned = String(value.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "_" }.prefix(18))
                        if cleaned != value { draft = cleaned }
                    }
            }.modifier(FieldStyle())
            if let error { Text(error).font(.system(size: 12)).foregroundStyle(Ink.red) }
            PrimaryButton(title: "Save handle", busy: busy, enabled: draft.count >= 3 && draft != game.handle) {
                busy = true
                Task {
                    do { try await game.claimHandle(draft); dismiss() } catch { self.error = error.localizedDescription }
                    busy = false
                }
            }
            Spacer()
        }
        .padding(26).padding(.top, 14).background(Ink.background)
        .onAppear { draft = game.handle }
    }
}

// MARK: - Backup codes

/// Restore an account on a new phone with handle + backup code.
struct RestoreSheet: View {
    @EnvironmentObject private var game: OnlineGame
    @Environment(\.dismiss) private var dismiss
    @State private var handle = ""
    @State private var code = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            eyebrow("RESTORE YOUR ACCOUNT")
            Text("Welcome back.").font(.system(size: 28, weight: .bold, design: .rounded)).tracking(-0.8)
            Text("Enter your handle and the backup code you saved. Your stack, trades and squads come with you.")
                .font(.system(size: 13)).foregroundStyle(Ink.muted).lineSpacing(3)
            HStack(spacing: 2) {
                Text("@").foregroundStyle(Ink.muted)
                TextField("handle", text: $handle).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .accessibilityIdentifier("restore-handle")
            }.modifier(FieldStyle())
            TextField("BRK-XXXX-XXXX-XXXX", text: $code)
                .font(.system(size: 18, weight: .bold, design: .monospaced))
                .textInputAutocapitalization(.characters).autocorrectionDisabled()
                .padding(16).background(Ink.background, in: RoundedRectangle(cornerRadius: 13))
                .overlay(RoundedRectangle(cornerRadius: 13).stroke(Ink.line))
                .accessibilityIdentifier("restore-code")
            if let error { Text(error).font(.system(size: 12)).foregroundStyle(Ink.red).accessibilityIdentifier("restore-error") }
            PrimaryButton(title: "Restore account", busy: busy, enabled: handle.count >= 3 && code.filter(\.isLetter).count + code.filter(\.isNumber).count >= 15) {
                busy = true
                error = nil
                Task {
                    do { try await game.restoreAccount(handle: handle, code: code); dismiss() } catch { self.error = error.localizedDescription }
                    busy = false
                }
            }.accessibilityIdentifier("restore-go")
            Spacer()
        }
        .padding(26).padding(.top, 14).background(Ink.background).foregroundStyle(.white)
    }
}

/// Shows a just-issued backup code. It is never shown again.
struct BackupCodeSheet: View {
    let code: String
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            eyebrow("YOUR BACKUP CODE")
            Text("Save this somewhere safe.").font(.system(size: 26, weight: .bold, design: .rounded)).tracking(-0.8)
            Text("It's the only way to get your account onto a new phone. Screenshot it or put it in your notes. We can't show it again.")
                .font(.system(size: 13)).foregroundStyle(Ink.muted).lineSpacing(3)
            Text(code).font(.system(size: 24, weight: .bold, design: .monospaced)).tracking(1)
                .foregroundStyle(Ink.lime).frame(maxWidth: .infinity).padding(.vertical, 22)
                .background(Ink.panel, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Ink.lime.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
                .textSelection(.enabled).accessibilityIdentifier("backup-code")
            HStack(spacing: 10) {
                Button {
                    UIPasteboard.general.string = code
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 14, weight: .bold)).frame(maxWidth: .infinity).frame(height: 48)
                        .foregroundStyle(.white).background(Ink.panel, in: RoundedRectangle(cornerRadius: 13))
                }
                ShareLink(item: "My Brokie backup code: \(code)") {
                    Label("Save", systemImage: "square.and.arrow.down")
                        .font(.system(size: 14, weight: .bold)).frame(maxWidth: .infinity).frame(height: 48)
                        .foregroundStyle(.white).background(Ink.panel, in: RoundedRectangle(cornerRadius: 13))
                }
            }
            PrimaryButton(title: "I've saved it") { dismiss() }
            Text("Getting a new code later replaces this one.").font(.system(size: 11)).foregroundStyle(Ink.muted)
            Spacer()
        }
        .padding(26).padding(.top, 14).background(Ink.background).foregroundStyle(.white)
        .interactiveDismissDisabled()
    }
}
