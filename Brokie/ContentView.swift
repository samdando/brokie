import SwiftUI
import Combine

enum Ink {
    static let background = Color(hex: 0x0C0E0B)
    static let panel = Color(hex: 0x171A15)
    static let line = Color(hex: 0x2C3028)
    static let muted = Color(hex: 0x969D8D)
    static let lime = Color(hex: 0xD6FE59)
    static let red = Color(hex: 0xFF7D8B)
    static let gold = Color(hex: 0xF2CA73)
    static let purple = Color(hex: 0xB5A0FE)
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255)
    }
}

extension Market {
    var color: Color { switch self { case .gold: Ink.gold; case .nas: Ink.lime; case .es: Ink.purple } }
    var icon: String { switch self { case .gold: "hexagon.fill"; case .nas: "waveform.path"; case .es: "square.stack.3d.up.fill" } }
}

func money(_ amount: Double, decimals: Int = 2) -> String {
    amount.formatted(.currency(code: "USD").precision(.fractionLength(decimals)).locale(Locale(identifier: "en_US")))
}
func signedMoney(_ amount: Double) -> String { (amount >= 0 ? "+" : "−") + money(abs(amount)) }
private func price(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(2))) }

private enum Destination: String, CaseIterable {
    case trade = "Trade", squad = "Squad", learn = "Learn", you = "You"
    var icon: String { switch self { case .trade: "chart.xyaxis.line"; case .squad: "person.2.fill"; case .learn: "bolt.fill"; case .you: "person.crop.circle" } }
}

private struct IdentifiedCode: Identifiable {
    let code: String
    var id: String { code }
}

private struct Ticket: Identifiable {
    let id = UUID()
    let side: TradeSide
}

struct ContentView: View {
    @EnvironmentObject private var engine: TradingEngine
    @EnvironmentObject private var voice: VoiceSession
    @EnvironmentObject private var game: OnlineGame
    @Environment(\.scenePhase) private var scenePhase
    @State private var destination: Destination = .trade
    @State private var ticket: Ticket?
    @State private var selectedLesson: Lesson?
    @State private var showRules = false
    @State private var showLeague = false
    @State private var showReset = false
    @State private var paused = false
    @State private var toast: String?
    @State private var sharedTrade: ClosedTrade?
    @State private var showHandleEditor = false
    @State private var closingID: UUID?
    @AppStorage("brokie.league") private var leagueName = "The rent money club"
    @AppStorage("brokie.handle") private var handle = "you"
    @AppStorage("brokie.lessons") private var completedLessons = ""
    @AppStorage("brokie.chart.style") private var chartStyle: PriceChartStyle = .candles
    @AppStorage("brokie.chart.frame") private var chartFrame: CandleFrame = .medium
    private let ticker = Timer.publish(every: 1.5, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack(alignment: .top) {
            Ink.background.ignoresSafeArea()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    switch destination {
                    case .trade: tradingScreen
                    case .squad: squadScreen
                    case .learn: learningScreen
                    case .you: profileScreen
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
            if let toast {
                Text(toast).font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Ink.background).padding(.horizontal, 20).padding(.vertical, 13)
                    .background(Ink.lime, in: Capsule()).padding(.top, 60)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .accessibilityIdentifier("toast")
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                if voice.isJoined && destination != .squad {
                    VoiceMiniBar { destination = .squad }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                navigation
            }
            .animation(.easeOut(duration: 0.2), value: voice.isJoined)
        }
        .sheet(item: $ticket) { value in
            OrderSheet(side: value.side, isOnline: game.isOnline, marketOpen: game.isOnline ? (game.marketOpen[engine.selectedMarket] ?? false) : true,
                       submit: { side, quantity in
                           if game.isOnline { return await game.open(market: engine.selectedMarket, side: side, quantity: quantity) }
                           return engine.openPosition(side: side, quantity: quantity)
                       }) { message in notify(message) }
                .environmentObject(engine).presentationDetents([.height(550)])
                .presentationDragIndicator(.visible).presentationCornerRadius(30)
        }
        .sheet(item: $selectedLesson) { lesson in
            LessonSheet(lesson: lesson, alreadyComplete: isComplete(lesson)) {
                if !isComplete(lesson) { completedLessons += "\(lesson.id)," }
            }
            .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showRules) { rulesSheet }
        .sheet(item: $sharedTrade) { trade in
            TradeCardSheet(trade: trade, handle: game.isOnline ? game.handle : handle)
                .presentationDetents([.large]).presentationDragIndicator(.visible)
        }
        .sheet(item: Binding(get: { game.freshBackupCode.map(IdentifiedCode.init) }, set: { if $0 == nil { game.freshBackupCode = nil } })) { item in
            BackupCodeSheet(code: item.code).presentationDetents([.large])
        }
        .sheet(isPresented: $showHandleEditor) { HandleEditor().environmentObject(game).presentationDetents([.medium]) }
        .fullScreenCover(isPresented: Binding(get: { game.phase == .needsHandle }, set: { _ in })) {
            OnboardingView().environmentObject(game)
        }
        .task { await game.start() }
        .onChange(of: scenePhase) { _, phase in game.setActive(phase == .active) }
        .onChange(of: engine.selectedMarket) { _, market in if game.isOnline { Task { await game.refreshCandles(market) } } }
        .onChange(of: chartFrame) { _, frame in game.candleSeconds = frame.liveSeconds }
        .onAppear { game.candleSeconds = chartFrame.liveSeconds }
        .sheet(isPresented: $showLeague) { LeagueSheet(name: $leagueName) }
        .confirmationDialog("Start a fresh paper account?", isPresented: $showReset, titleVisibility: .visible) {
            Button("Reset to $10,000", role: .destructive) { engine.reset(); notify("Fresh stack. Fresh start.") }
        } message: { Text("Your open positions and trade history will be cleared. Your lessons and squad name stay saved.") }
        .onReceive(ticker) { _ in if scenePhase == .active && !paused && !game.isOnline { engine.tick() } }
        .onChange(of: scenePhase) { _, phase in if phase != .active { voice.suspendMicrophone() } }
        .onChange(of: engine.liquidationCount) { _, newValue in
            if newValue > 0 {
                notify(game.isOnline ? "Liquidated. Fresh $10k drops Monday." : "Paper account liquidated. Reset in You to practice again.")
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center) {
            HStack(spacing: 5) {
                Text("brokie").font(.system(size: 30, weight: .black, design: .rounded)).tracking(-1.6)
                Circle().fill(Ink.lime).frame(width: 8, height: 8).offset(y: 8)
            }
            Spacer()
            Button { showRules = true } label: {
                Text(game.isOnline ? "WEEK ENDS \(seasonCountdown(to: game.seasonEndsAt, now: game.serverNow).uppercased())" : "PAPER CLUB")
                    .font(.system(size: 9, weight: .heavy, design: .monospaced)).tracking(1.1)
                    .foregroundStyle(Ink.lime).padding(.horizontal, 11).padding(.vertical, 8)
                    .overlay(Capsule().stroke(Ink.lime.opacity(0.35)))
            }.accessibilityLabel("How Brokie works")
            Button { destination = .you } label: {
                Text(String((game.isOnline ? game.handle : handle).prefix(1)).uppercased()).font(.system(size: 13, weight: .bold))
                    .frame(width: 34, height: 34).background(Ink.panel, in: Circle())
                    .overlay(Circle().stroke(Ink.line))
            }.padding(.leading, 7).accessibilityLabel("Your profile")
        }
        .foregroundStyle(.white)
    }

    private var tradingScreen: some View {
        VStack(alignment: .leading, spacing: 20) {
            connectionBanner
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 7) {
                    eyebrow(game.isOnline ? "THIS WEEK'S STACK · USD" : "YOUR PAPER STACK · USD")
                    Text(money(engine.equity)).font(.system(size: 39, weight: .semibold, design: .rounded)).tracking(-1.8)
                        .monospacedDigit().minimumScaleFactor(0.7).lineLimit(1).accessibilityIdentifier("equity")
                    HStack(spacing: 5) {
                        Image(systemName: engine.equity >= 10_000 ? "arrow.up.right" : "arrow.down.right").font(.system(size: 10, weight: .bold))
                        Text("\(signedMoney(engine.equity - 10_000)) all time").font(.system(size: 12, weight: .medium)).monospacedDigit()
                    }.foregroundStyle(engine.equity >= 10_000 ? Ink.lime : Ink.red)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 5) {
                    Text("100% fake money.").foregroundStyle(.white.opacity(0.9))
                    Text("100% real bragging rights.").foregroundStyle(Ink.muted)
                }.font(.system(size: 10, weight: .medium)).padding(.bottom, 7)
            }.padding(.top, 5)

            HStack(spacing: 10) {
                ForEach(Market.allCases) { market in
                    Button { engine.selectedMarket = market } label: {
                        VStack(alignment: .leading, spacing: 9) {
                            HStack(spacing: 6) {
                                Image(systemName: market.icon).foregroundStyle(market.color).font(.system(size: 11, weight: .bold))
                                Text(market.title).font(.system(size: 13, weight: .bold))
                                Spacer(minLength: 0)
                                if engine.selectedMarket == market { Circle().fill(market.color).frame(width: 4, height: 4) }
                            }
                            Text(price(engine.quotes[market] ?? 0)).font(.system(size: 13, weight: .medium, design: .monospaced))
                                .minimumScaleFactor(0.8).lineLimit(1)
                        }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(engine.selectedMarket == market ? market.color.opacity(0.09) : Ink.panel, in: RoundedRectangle(cornerRadius: 14))
                            .overlay(RoundedRectangle(cornerRadius: 14).stroke(engine.selectedMarket == market ? market.color.opacity(0.65) : Ink.line))
                    }.buttonStyle(.plain).accessibilityIdentifier("market-\(market.rawValue)")
                }
            }

            marketChart

            HStack(spacing: 12) {
                tradeButton(.long)
                tradeButton(.short)
            }
            HStack(spacing: 5) {
                Image(systemName: "sparkle")
                Text("Real point math. Zero rent money at risk.")
            }.font(.system(size: 10, weight: .medium)).foregroundStyle(Ink.muted).frame(maxWidth: .infinity).padding(.top, -8)

            positionsSection
            pitSection
        }
    }

    private var marketChart: some View {
        let market = engine.selectedMarket
        let online = game.isOnline
        let candles = online ? game.liveCandles(for: market) : engine.candles(for: market, ticksPerCandle: chartFrame.rawValue)
        let quote = engine.quotes[market] ?? 0
        let change = quote - (candles.first?.open ?? quote)
        let entries = engine.positions.filter { $0.market == market }.map {
            ChartEntryLine(id: $0.id, price: $0.entryPrice, side: $0.side, quantity: $0.quantity, pnl: engine.pnl(for: $0))
        }
        let isLive = online
        let open = game.marketOpen[market] ?? false
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 7) {
                    HStack(spacing: 7) {
                        Text(market.subtitle).font(.system(size: 13, weight: .semibold))
                        Text(market.symbol).font(.system(size: 9, weight: .bold, design: .monospaced)).foregroundStyle(Ink.muted)
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(price(quote)).font(.system(size: 29, weight: .medium, design: .rounded)).tracking(-0.8).monospacedDigit()
                            .contentTransition(.numericText(value: quote))
                            .animation(.easeOut(duration: 0.2), value: quote)
                        Text("\(change >= 0 ? "+" : "−")\(price(abs(change)))").font(.system(size: 11, weight: .semibold, design: .monospaced))
                            .foregroundStyle(change >= 0 ? Ink.lime : Ink.red)
                    }
                }
                Spacer()
                if online {
                    HStack(spacing: 5) {
                        Circle().fill(open ? Ink.red : Ink.muted).frame(width: 5, height: 5)
                        Text(open ? "LIVE" : "MARKET CLOSED").font(.system(size: 8, weight: .bold, design: .monospaced)).tracking(0.5)
                    }.foregroundStyle(open ? .white : Ink.muted).padding(.vertical, 6).padding(.horizontal, 8)
                        .background(Ink.background, in: Capsule()).accessibilityIdentifier("live-badge")
                } else {
                Button { paused.toggle() } label: {
                    HStack(spacing: 5) {
                        Circle().fill(paused ? Ink.muted : (isLive ? Ink.red : Ink.lime)).frame(width: 5, height: 5)
                        Text(paused ? "PAUSED" : engine.quoteSource.badge).font(.system(size: 8, weight: .bold, design: .monospaced)).tracking(0.5)
                        Image(systemName: paused ? "play.fill" : "pause.fill").font(.system(size: 7))
                    }.foregroundStyle(Ink.muted).padding(.vertical, 6).padding(.horizontal, 7)
                        .background(Ink.background, in: Capsule())
                }.accessibilityLabel(paused ? "Resume demo prices" : "Pause demo prices").accessibilityIdentifier("toggle-prices")
                }
            }
            BrokieChart(market: market, candles: candles, quote: quote, entries: entries, style: chartStyle)
                .frame(height: 236)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("\(isLive ? "Live" : "Simulated") \(market.title) \(chartStyle.title.lowercased()) chart. Current price \(price(quote)). Press and drag to read a bar.")
            PriceChartControls(style: $chartStyle, frame: $chartFrame, tint: market.color, isLive: online)
            Text(isLive ? (open ? "Live prices · OANDA practice feed · \(chartFrame.liveLabel) candles" : "Market's closed. New trades open when prices are live again.")
                        : "Simulated prices · not market data · drag the chart to read a bar")
                .font(.system(size: 9)).foregroundStyle(Ink.muted)
        }.padding(18).background(Ink.panel, in: RoundedRectangle(cornerRadius: 21))
            .overlay(RoundedRectangle(cornerRadius: 21).stroke(Ink.line))
    }

    private func tradeButton(_ side: TradeSide) -> some View {
        Button { ticket = Ticket(side: side) } label: {
            HStack(spacing: 9) {
                Image(systemName: side == .long ? "arrow.up.right" : "arrow.down.right").font(.system(size: 14, weight: .bold))
                Text(side == .long ? "Go long" : "Go short").font(.system(size: 15, weight: .bold))
            }.frame(maxWidth: .infinity).frame(height: 52)
                .foregroundStyle(side == .long ? Ink.background : Ink.red)
                .background(side == .long ? Ink.lime : Ink.red.opacity(0.11), in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(side == .long ? .clear : Ink.red.opacity(0.4)))
        }.accessibilityIdentifier(side == .long ? "go-long" : "go-short")
    }

    private var positionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeading("Your positions", detail: "\(engine.positions.count) OPEN")
            if engine.positions.isEmpty {
                HStack(spacing: 13) {
                    Image(systemName: "viewfinder").font(.system(size: 22, weight: .light)).foregroundStyle(Ink.lime)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("No bags. Yet.").font(.system(size: 13, weight: .semibold))
                        Text("Pick a market and make your first paper trade.").font(.system(size: 11)).foregroundStyle(Ink.muted)
                    }
                }.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(Ink.panel, in: RoundedRectangle(cornerRadius: 15))
            } else {
                ForEach(engine.positions) { position in
                    HStack(spacing: 11) {
                        marketBadge(position.market, size: 34)
                        VStack(alignment: .leading, spacing: 5) {
                            Text("\(position.market.title) · \(position.side.title)").font(.system(size: 13, weight: .bold))
                            Text("\(position.quantity) micro · at \(price(position.entryPrice))").font(.system(size: 10)).foregroundStyle(Ink.muted)
                        }
                        Spacer()
                        Text(signedMoney(engine.pnl(for: position))).font(.system(size: 13, weight: .semibold, design: .monospaced))
                            .foregroundStyle(engine.pnl(for: position) >= 0 ? Ink.lime : Ink.red)
                        Button { close(position) } label: {
                            ZStack {
                                if closingID == position.id { ProgressView().controlSize(.small).tint(Ink.muted) }
                                else { Image(systemName: "xmark").font(.system(size: 11, weight: .bold)) }
                            }.frame(width: 34, height: 40).foregroundStyle(Ink.muted)
                        }.disabled(closingID != nil)
                            .accessibilityLabel("Close \(position.market.title) \(position.side.title) position").accessibilityIdentifier("close-position")
                    }.padding(.leading, 13).padding(.trailing, 4).padding(.vertical, 12)
                        .background(Ink.panel, in: RoundedRectangle(cornerRadius: 15))
                }
            }
        }
    }

    @ViewBuilder private var pitSection: some View {
        if game.isOnline {
            VStack(alignment: .leading, spacing: 12) {
                sectionHeading("The pit", detail: game.selectedSquad?.name.uppercased() ?? "YOUR SQUAD")
                if game.selectedSquad == nil {
                    Button { destination = .squad } label: {
                        HStack { Text("Start or join a squad to see your mates' trades."); Spacer(); Image(systemName: "arrow.up.right") }
                            .font(.system(size: 12, weight: .medium)).foregroundStyle(Ink.lime).padding(16)
                            .background(Ink.panel, in: RoundedRectangle(cornerRadius: 16))
                    }
                } else if game.feed.isEmpty {
                    Text("Quiet in here. Be the first to make a move.").font(.system(size: 12)).foregroundStyle(Ink.muted).padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading).background(Ink.panel, in: RoundedRectangle(cornerRadius: 16))
                } else {
                    ForEach(game.feed.prefix(5), id: \.feedID) { FeedRow(event: $0) }
                }
            }
        } else {
            samplePit
        }
    }

    private var samplePit: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeading("The pit", detail: "SAMPLE FEED")
            HStack(alignment: .top, spacing: 11) {
                Text("J").font(.system(size: 13, weight: .heavy)).foregroundStyle(Ink.purple)
                    .frame(width: 33, height: 33).background(Ink.purple.opacity(0.12), in: Circle())
                VStack(alignment: .leading, spacing: 7) {
                    HStack { Text("jess.exe").font(.system(size: 12, weight: .bold)); Text("DEMO").font(.system(size: 8, weight: .bold)).foregroundStyle(Ink.muted); Spacer(); Text("NAS ↑").font(.system(size: 10, weight: .semibold)).foregroundStyle(Ink.lime) }
                    Text("My stop loss is the only boundary I respect.").font(.system(size: 13)).foregroundStyle(.white.opacity(0.85))
                    HStack(spacing: 14) { Label("12", systemImage: "heart"); Label("3", systemImage: "bubble") }.font(.system(size: 10)).foregroundStyle(Ink.muted)
                }
            }.padding(16).background(Ink.panel, in: RoundedRectangle(cornerRadius: 16))
            Button { destination = .squad } label: {
                HStack { Text("Your group chat has a leaderboard now."); Spacer(); Image(systemName: "arrow.up.right") }
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(Ink.lime)
            }
        }
    }

    @ViewBuilder private var squadScreen: some View {
        if game.isOnline { OnlineSquadScreen() } else { practiceSquadScreen }
    }

    private var practiceSquadScreen: some View {
        VStack(alignment: .leading, spacing: 24) {
            pageTitle("Good friends.\nQuestionable trades.", subtitle: "Bragging rights are the only payout.")
            VStack(alignment: .leading, spacing: 20) {
                HStack { eyebrow("YOUR SQUAD"); Spacer(); labelPill("LOCAL PREVIEW", color: Ink.purple) }
                HStack(alignment: .top) {
                    Text(leagueName).font(.system(size: 29, weight: .semibold, design: .rounded)).tracking(-1)
                    Spacer()
                    Image(systemName: "flag.checkered").font(.system(size: 30)).foregroundStyle(Ink.lime)
                }
                Text("Fresh $10k. Same bad takes.").font(.system(size: 13)).foregroundStyle(Ink.muted)
                Button { showLeague = true } label: {
                    HStack { Text("Make it your squad"); Spacer(); Image(systemName: "arrow.right") }
                        .font(.system(size: 13, weight: .bold)).foregroundStyle(Ink.background).padding(15)
                        .background(Ink.lime, in: RoundedRectangle(cornerRadius: 12))
                }.accessibilityIdentifier("create-squad")
            }.padding(20).background(Ink.panel, in: RoundedRectangle(cornerRadius: 20))

            VoiceRoomCard()

            VStack(spacing: 0) {
                sectionHeading("The leaderboard", detail: "DEMO RIVALS").padding(.bottom, 12)
                ForEach(Array(leagueRows.enumerated()), id: \.element.name) { index, row in
                    HStack(spacing: 13) {
                        Text(String(format: "%02d", index + 1)).font(.system(size: 12, weight: .semibold, design: .monospaced)).foregroundStyle(Ink.muted).frame(width: 22)
                        Text(String(row.name.prefix(1)).uppercased()).font(.system(size: 13, weight: .bold))
                            .foregroundStyle(row.isYou ? Ink.background : Ink.purple)
                            .frame(width: 35, height: 35).background(row.isYou ? Ink.lime : Ink.purple.opacity(0.12), in: Circle())
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.isYou ? "@\(handle)" : row.name).font(.system(size: 13, weight: .semibold))
                            Text(row.isYou ? "Your paper account" : "Demo player").font(.system(size: 10)).foregroundStyle(Ink.muted)
                        }
                        Spacer()
                        Text(String(format: "%+.2f%%", row.profit)).font(.system(size: 14, weight: .semibold, design: .monospaced))
                            .foregroundStyle(row.profit >= 0 ? Ink.lime : Ink.red)
                    }.padding(.vertical, 15).padding(.horizontal, 12)
                        .background(row.isYou ? Ink.lime.opacity(0.06) : .clear, in: RoundedRectangle(cornerRadius: 12))
                    if index < leagueRows.count - 1 { Rectangle().fill(Ink.line).frame(height: 1) }
                }
            }
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "person.2.badge.gearshape").foregroundStyle(Ink.purple)
                Text("Your account is real practice; these rivals and voice-room members are examples. Online invites, live voice, and weekly leagues need the online backend.").font(.system(size: 12)).foregroundStyle(Ink.muted).lineSpacing(4)
            }.padding(17).background(Ink.panel, in: RoundedRectangle(cornerRadius: 15))
        }
    }

    private struct LeagueRow { let name: String; let profit: Double; let isYou: Bool }
    private var leagueRows: [LeagueRow] {
        [LeagueRow(name: "jess.exe", profit: 12.48, isYou: false), LeagueRow(name: "chartgremlin", profit: 8.32, isYou: false),
         LeagueRow(name: "buyhighcry", profit: 4.21, isYou: false), LeagueRow(name: "you", profit: (engine.equity - 10_000) / 100, isYou: true),
         LeagueRow(name: "marginmike", profit: -2.73, isYou: false)].sorted { $0.profit > $1.profit }
    }

    private var learningScreen: some View {
        VStack(alignment: .leading, spacing: 24) {
            pageTitle("Less guessing.\nMore getting it.", subtitle: "Tiny lessons. Fewer expensive habits.")
            HStack(spacing: 16) {
                ZStack {
                    Circle().stroke(Ink.line, lineWidth: 5)
                    Circle().trim(from: 0, to: Double(Lesson.all.filter { isComplete($0) }.count) / 3)
                        .stroke(Ink.lime, style: StrokeStyle(lineWidth: 5, lineCap: .round)).rotationEffect(.degrees(-90))
                    Image(systemName: "bolt.fill").foregroundStyle(Ink.lime)
                }.frame(width: 48, height: 48)
                VStack(alignment: .leading, spacing: 5) {
                    Text("Build your market brain").font(.system(size: 14, weight: .bold))
                    Text("\(Lesson.all.filter { isComplete($0) }.count) of 3 essentials complete").font(.system(size: 12)).foregroundStyle(Ink.muted)
                }
                Spacer()
            }.padding(20).background(Ink.panel, in: RoundedRectangle(cornerRadius: 18))
            ForEach(Lesson.all) { lesson in
                Button { selectedLesson = lesson } label: {
                    VStack(alignment: .leading, spacing: 18) {
                        HStack {
                            Text("0\(lesson.id + 1) / THE ESSENTIALS").font(.system(size: 9, weight: .bold, design: .monospaced)).tracking(1).foregroundStyle(Ink.muted)
                            Spacer()
                            Image(systemName: isComplete(lesson) ? "checkmark.circle.fill" : lesson.icon).foregroundStyle(Ink.lime)
                        }
                        Text(lesson.title).font(.system(size: 23, weight: .semibold, design: .rounded)).tracking(-0.5)
                        HStack { Text(lesson.subtitle).font(.system(size: 12)).foregroundStyle(Ink.muted); Spacer(); Image(systemName: "arrow.up.right").foregroundStyle(Ink.lime) }
                    }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Ink.panel, in: RoundedRectangle(cornerRadius: 18)).overlay(RoundedRectangle(cornerRadius: 18).stroke(Ink.line))
                }.buttonStyle(.plain).accessibilityIdentifier("lesson-\(lesson.id)")
            }
        }
    }

    private var profileScreen: some View {
        VStack(alignment: .leading, spacing: 24) {
            pageTitle("Your trading arc.", subtitle: "Every great trader starts somewhere.")
            HStack(spacing: 16) {
                Text(String(handle.prefix(1)).uppercased()).font(.system(size: 26, weight: .bold, design: .rounded))
                    .foregroundStyle(Ink.background).frame(width: 60, height: 60).background(Ink.lime, in: RoundedRectangle(cornerRadius: 20))
                VStack(alignment: .leading, spacing: 5) {
                    if game.isOnline {
                        Button { showHandleEditor = true } label: {
                            HStack(spacing: 6) {
                                Text("@\(game.handle)").foregroundStyle(.white)
                                Image(systemName: "pencil").font(.system(size: 13, weight: .bold)).foregroundStyle(Ink.muted)
                            }.font(.system(size: 23, weight: .bold, design: .rounded))
                        }.accessibilityIdentifier("edit-handle")
                    } else {
                    HStack(spacing: 0) {
                        Text("@").foregroundStyle(Ink.muted)
                        TextField("you", text: $handle).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .onChange(of: handle) { _, value in
                                let filtered = String(value.filter { $0.isLetter || $0.isNumber || $0 == "_" }.prefix(18))
                                if filtered != value { handle = filtered }
                            }.accessibilityLabel("Your handle")
                    }.font(.system(size: 23, weight: .bold, design: .rounded))
                    }
                    Text(game.isOnline ? "FOUNDING BROKIE · SEASON \(seasonLabel)" : "FOUNDING BROKIE · LOCAL ACCOUNT").font(.system(size: 8, weight: .bold, design: .monospaced)).tracking(0.6).foregroundStyle(Ink.muted)
                }
            }
            HStack(spacing: 10) {
                metric("CLOSED TRADES", value: "\(engine.totalTrades)")
                metric("WIN RATE", value: engine.totalTrades == 0 ? "—" : "\(Int(engine.winRate))%")
                metric("NET RESULT", value: signedMoney(engine.realizedPnL))
            }
            VStack(spacing: 14) {
                detailRow("Paper cash", money(engine.balance))
                detailRow("Open P&L", signedMoney(engine.unrealizedPnL))
                detailRow("Available practice margin", money(engine.availableMargin))
                if engine.protectionCredit > 0 {
                    detailRow("Practice loss protection credit", money(engine.protectionCredit))
                    Text("This game-only credit floors your cash at zero after liquidation. It is included in your net result; trade receipts show the original fill P&L.")
                        .font(.system(size: 11)).foregroundStyle(Ink.muted)
                }
            }.padding(18).background(Ink.panel, in: RoundedRectangle(cornerRadius: 16))
            VStack(alignment: .leading, spacing: 14) {
                sectionHeading("The receipts", detail: "TRADE HISTORY")
                if engine.closedTrades.isEmpty {
                    Text("Close your first trade and it will land here. Wins, losses, character development.").font(.system(size: 13)).foregroundStyle(Ink.muted).lineSpacing(4).padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading).background(Ink.panel, in: RoundedRectangle(cornerRadius: 15))
                }
                ForEach(engine.closedTrades.prefix(30)) { trade in
                    Button { sharedTrade = trade } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("\(trade.market.title) · \(trade.side.title) · \(trade.quantity) micro").font(.system(size: 13, weight: .semibold))
                            Text("\(price(trade.entryPrice)) → \(price(trade.exitPrice))").font(.system(size: 10, design: .monospaced)).foregroundStyle(Ink.muted)
                        }
                        Spacer()
                        Text(signedMoney(trade.pnl)).font(.system(size: 13, weight: .bold, design: .monospaced)).foregroundStyle(trade.pnl >= 0 ? Ink.lime : Ink.red)
                        Image(systemName: "square.and.arrow.up").font(.system(size: 11, weight: .semibold)).foregroundStyle(Ink.muted).padding(.leading, 6)
                    }.padding(15).background(Ink.panel, in: RoundedRectangle(cornerRadius: 13))
                    }.buttonStyle(.plain).accessibilityIdentifier("receipt-\(trade.id.uuidString)")
                }
            }
            Button { showRules = true } label: { settingsRow("How this prototype works", icon: "info.circle", color: Ink.muted) }
            if game.isOnline {
                Button { Task { try? await game.issueBackupCode() } } label: {
                    if game.hasBackupCode {
                        settingsRow("Get a new backup code", icon: "key.fill", color: Ink.muted)
                    } else {
                        HStack(spacing: 12) {
                            Image(systemName: "key.fill").foregroundStyle(Ink.background).frame(width: 34, height: 34)
                                .background(Ink.lime, in: RoundedRectangle(cornerRadius: 10))
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Save your account").font(.system(size: 13, weight: .bold))
                                Text("Get a backup code so a new phone doesn't wipe your stack.").font(.system(size: 11)).foregroundStyle(Ink.muted)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Ink.lime)
                        }
                        .padding(14).background(Ink.lime.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Ink.lime.opacity(0.3)))
                    }
                }.buttonStyle(.plain).accessibilityIdentifier("backup-code-button")
                settingsRow("Fresh $10k every Monday · resets in \(seasonCountdown(to: game.seasonEndsAt, now: game.serverNow))", icon: "calendar", color: Ink.muted)
            } else {
            Button { showReset = true } label: { settingsRow("Reset paper account", icon: "arrow.counterclockwise", color: Ink.red) }
                .accessibilityIdentifier("reset-account")
            }
            Text("BROKIE / 0.2\nAll the market. None of the rent money.").font(.system(size: 10, weight: .medium, design: .monospaced)).foregroundStyle(Ink.muted).lineSpacing(6).frame(maxWidth: .infinity).multilineTextAlignment(.center)
        }
    }

    private var navigation: some View {
        HStack(spacing: 0) {
            ForEach(Destination.allCases, id: \.self) { item in
                Button { destination = item } label: {
                    VStack(spacing: 6) {
                        Image(systemName: item.icon).font(.system(size: 18, weight: .medium))
                        Text(item.rawValue).font(.system(size: 10, weight: .semibold))
                    }.foregroundStyle(destination == item ? Ink.lime : Ink.muted).frame(maxWidth: .infinity).frame(height: 62)
                        .contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("tab-\(item.rawValue.lowercased())")
                    .accessibilityAddTraits(destination == item ? .isSelected : [])
            }
        }.padding(.horizontal, 12).padding(.top, 7).background(Ink.background)
            .overlay(alignment: .top) { Rectangle().fill(Ink.line).frame(height: 1) }
    }

    private var rulesSheet: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                eyebrow("WELCOME TO THE PAPER CLUB")
                Text("All the market.\nNone of the rent money.").font(.system(size: 30, weight: .bold, design: .rounded)).tracking(-1)
                if game.isOnline {
                    rule("01", "Real prices. Fake money.", "Gold, NAS and ES prices come from an OANDA practice feed (spot gold and index CFDs). Every order is filled on the Brokie server at the latest price, so nobody can fudge a fill. No deposits, withdrawals, or prizes. Ever.")
                } else {
                    rule("01", "This build is a simulator.", "Quotes are generated on your phone, not live market data. They pause when the app is in the background. No deposits, withdrawals, or prizes.")
                }
                rule("02", "Small contracts. Real point math.", "Gold uses MGC ($10 per point), NAS uses MNQ ($2 per point), and ES uses MES ($5 per point). All values are in USD. Long benefits from a rise; short benefits from a fall.")
                rule("03", "Practice rules are simplified.", "Each micro contract reserves $1,000 of practice margin. This is a game rule, not exchange margin. Fills are instant, with no fees or slippage. At zero account equity, all positions close and the balance is floored at zero. No stop or limit orders in this build.")
                if game.isOnline {
                    rule("04", "Weekly seasons.", "Everyone starts Monday (Brisbane time) with $10,000. Open trades are closed at the last price when the week ends. New trades need a live price, so when the market's closed you can close but not open.")
                } else {
                    rule("04", "Your phone. Your paper account.", "Trades, lessons, your handle, and your squad name save locally. Other traders, posts, and voice-room members are examples. Connect the Brokie server for real squads, live prices and voice.")
                }
            }.padding(26).padding(.top, 15)
        }.background(Ink.background).presentationDragIndicator(.visible)
    }

    private var seasonLabel: String {
        guard let end = game.seasonEndsAt else { return "—" }
        return Calendar(identifier: .iso8601).component(.weekOfYear, from: end.addingTimeInterval(-86_400)).formatted()
    }

    @ViewBuilder private var connectionBanner: some View {
        switch game.phase {
        case .connecting:
            HStack(spacing: 8) { ProgressView().controlSize(.small).tint(Ink.lime); Text("Connecting to your squad…") }
                .font(.system(size: 11, weight: .medium)).foregroundStyle(Ink.muted)
        case .failed(let message):
            Button { Task { await game.start() } } label: {
                HStack(spacing: 8) {
                    Image(systemName: "wifi.exclamationmark")
                    Text("Offline · practice mode. \(message)").lineLimit(2)
                    Spacer(minLength: 4)
                    Text("RETRY").font(.system(size: 9, weight: .heavy, design: .monospaced))
                }
                .font(.system(size: 11, weight: .medium)).foregroundStyle(Ink.red).padding(12)
                .background(Ink.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
            }.buttonStyle(.plain)
        default:
            EmptyView()
        }
    }

    private func close(_ position: Position) {
        if game.isOnline {
            closingID = position.id
            Task {
                switch await game.close(positionID: position.id) {
                case .success(let pnl): notify("Closed \(position.market.title) · \(signedMoney(pnl))")
                case .failure(let error): notify(error.message)
                }
                closingID = nil
            }
        } else {
            let result = engine.pnl(for: position)
            engine.closePosition(id: position.id)
            notify("Closed \(position.market.title) · \(signedMoney(result))")
        }
    }

    private func isComplete(_ lesson: Lesson) -> Bool { completedLessons.split(separator: ",").contains(Substring(String(lesson.id))) }
    private func notify(_ message: String) {
        withAnimation(.easeOut(duration: 0.2)) { toast = message }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            if toast == message { withAnimation { toast = nil } }
        }
    }
}

private struct OrderSheet: View {
    @EnvironmentObject private var engine: TradingEngine
    @Environment(\.dismiss) private var dismiss
    let side: TradeSide
    var isOnline = false
    var marketOpen = true
    let submit: (TradeSide, Int) async -> String?
    let onComplete: (String) -> Void
    @State private var quantity = 1
    @State private var error: String?
    @State private var busy = false
    private var color: Color { side == .long ? Ink.lime : Ink.red }

    var body: some View {
        VStack(alignment: .leading, spacing: 23) {
            HStack {
                eyebrow("PAPER ORDER")
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Ink.muted).frame(width: 32, height: 32) }.accessibilityLabel("Cancel order")
            }
            HStack(spacing: 13) {
                marketBadge(engine.selectedMarket, size: 45)
                VStack(alignment: .leading, spacing: 5) {
                    Text("\(side.title) \(engine.selectedMarket.title)").font(.system(size: 27, weight: .bold, design: .rounded))
                    Text("\(engine.selectedMarket.subtitle) · \(engine.selectedMarket.symbol)").font(.system(size: 12)).foregroundStyle(Ink.muted)
                }
                Spacer()
            }
            Text(side == .long ? "Think it goes up? You're in the right place." : "Think it goes down? Put your paper on it.").font(.system(size: 13)).foregroundStyle(Ink.muted)
            VStack(alignment: .leading, spacing: 11) {
                eyebrow("MICRO CONTRACTS")
                HStack(spacing: 10) {
                    ForEach(1...3, id: \.self) { number in
                        Button { quantity = number; error = nil } label: {
                            Text("\(number)").font(.system(size: 19, weight: .bold)).frame(maxWidth: .infinity).frame(height: 49)
                                .foregroundStyle(quantity == number ? Ink.background : .white)
                                .background(quantity == number ? color : Ink.panel, in: RoundedRectangle(cornerRadius: 11))
                        }.accessibilityIdentifier("quantity-\(number)")
                    }
                }
            }
            VStack(spacing: 13) {
                detailRow(isOnline ? (marketOpen ? "Live market price" : "Last price · market closed") : "Simulated market price",
                          price(engine.quotes[engine.selectedMarket] ?? 0))
                detailRow("P&L per 1 point move", money(engine.selectedMarket.pointValue * Double(quantity)))
                detailRow("Practice margin", money(Double(quantity) * 1_000, decimals: 0))
                detailRow("Available", money(engine.availableMargin))
            }
            if let error { Text(error).font(.system(size: 12)).foregroundStyle(Ink.red).accessibilityIdentifier("order-error") }
            Spacer(minLength: 0)
            Button {
                busy = true
                let market = engine.selectedMarket
                Task {
                    if let message = await submit(side, quantity) { error = message }
                    else { onComplete("\(side.title) \(market.title) opened. You're in."); dismiss() }
                    busy = false
                }
            } label: {
                ZStack {
                    Text("Open \(side.title.lowercased()) · \(quantity) \(quantity == 1 ? "micro" : "micros")").opacity(busy ? 0 : 1)
                    if busy { ProgressView().tint(Ink.background) }
                }
                    .font(.system(size: 15, weight: .bold)).frame(maxWidth: .infinity).frame(height: 53)
                    .foregroundStyle(Ink.background).background(color.opacity(marketOpen ? 1 : 0.4), in: RoundedRectangle(cornerRadius: 14))
            }.disabled(busy || !marketOpen).accessibilityIdentifier("confirm-order")
            Text(isOnline ? "Virtual funds only. Filled by the Brokie server at the live price." : "Virtual funds only. Instant demo fills. No fees or slippage.").font(.system(size: 10)).foregroundStyle(Ink.muted).frame(maxWidth: .infinity)
        }.padding(25).padding(.top, 7).background(Ink.background)
    }
}

private struct Lesson: Identifiable {
    let id: Int
    let title: String
    let subtitle: String
    let icon: String
    let body: String
    let question: String
    let answers: [String]
    let correct: Int
    let explanation: String
    static let all = [
        Lesson(id: 0, title: "Up, down, and in the game.", subtitle: "Long vs short · 1 minute", icon: "arrow.up.arrow.down", body: "A long position gains when price rises and loses when it falls. A short position does the opposite. Your result depends on how far the price moves, the contract's point value, and how many contracts you hold.", question: "You're short NAS. The price drops. What happens?", answers: ["Your position gains", "Your position loses", "Nothing changes"], correct: 0, explanation: "A short benefits from a lower price. If price rises, the short loses."),
        Lesson(id: 1, title: "A point isn't just a point.", subtitle: "Contract sizing · 1 minute", icon: "number", body: "Brokie uses micro contracts: MNQ (NAS) is $2 per point, MES (ES) is $5, and MGC (Gold) is $10. P&L = price movement × point value × contracts, with the direction reversed for shorts. Two contracts double both gains and losses.", question: "One long MNQ rises 10 points. Your gross P&L?", answers: ["+$10", "+$20", "+$100"], correct: 1, explanation: "10 points × $2 per point × 1 contract = $20 before costs."),
        Lesson(id: 2, title: "Stay in the game.", subtitle: "Risk & practice margin · 1 minute", icon: "shield.lefthalf.filled", body: "Margin is collateral, not your maximum possible loss. Brokie reserves a simplified $1,000 per micro contract; real requirements vary. Smaller positions change your P&L less per point. This demo has instant fills and no costs, so results won't match real trading.", question: "You halve your contracts. Your P&L per point…", answers: ["Doubles", "Stays the same", "Halves"], correct: 2, explanation: "Position size scales losses as well as gains. Half the contracts means half the P&L per point.")
    ]
}

private struct LessonSheet: View {
    @Environment(\.dismiss) private var dismiss
    let lesson: Lesson
    let alreadyComplete: Bool
    let onComplete: () -> Void
    @State private var selected: Int?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack { eyebrow("THE ESSENTIALS / 0\(lesson.id + 1)"); Spacer(); Button("Done") { dismiss() }.font(.system(size: 13, weight: .bold)).foregroundStyle(Ink.lime) }
                Text(lesson.title).font(.system(size: 30, weight: .bold, design: .rounded)).tracking(-0.8)
                Text(lesson.body).font(.system(size: 15)).foregroundStyle(Ink.muted).lineSpacing(6)
                Rectangle().fill(Ink.line).frame(height: 1)
                Text(lesson.question).font(.system(size: 17, weight: .semibold))
                ForEach(lesson.answers.indices, id: \.self) { index in
                    Button {
                        selected = index
                        if index == lesson.correct { onComplete() }
                    } label: {
                        HStack { Text(lesson.answers[index]); Spacer(); if selected == index { Image(systemName: index == lesson.correct ? "checkmark.circle.fill" : "xmark.circle") } }
                            .font(.system(size: 14, weight: .medium)).padding(17)
                            .foregroundStyle(selected == index ? (index == lesson.correct ? Ink.lime : Ink.red) : .white)
                            .background(Ink.panel, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(selected == index ? (index == lesson.correct ? Ink.lime : Ink.red) : Ink.line))
                    }.accessibilityIdentifier("answer-\(index)")
                }
                if let selected {
                    Text(selected == lesson.correct ? "Nailed it. \(lesson.explanation)" : "Not quite. Give it another go.")
                        .font(.system(size: 13)).foregroundStyle(selected == lesson.correct ? Ink.lime : Ink.red).lineSpacing(4)
                } else if alreadyComplete {
                    Label("Lesson complete. Revisit any time.", systemImage: "checkmark.circle.fill").font(.system(size: 13)).foregroundStyle(Ink.lime)
                }
            }.padding(25).padding(.top, 12)
        }.background(Ink.background)
    }
}

private struct LeagueSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var name: String
    @State private var draft = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            eyebrow("YOUR SQUAD STARTS HERE")
            Text("Name the group chat.").font(.system(size: 30, weight: .bold, design: .rounded))
            Text("Set up your squad's identity on this phone. Multiplayer invites and shared scores will come with the online backend.").font(.system(size: 14)).foregroundStyle(Ink.muted).lineSpacing(4)
            TextField("Squad name", text: $draft).font(.system(size: 18, weight: .medium)).padding(18)
                .background(Ink.panel, in: RoundedRectangle(cornerRadius: 13)).onChange(of: draft) { _, value in if value.count > 32 { draft = String(value.prefix(32)) } }
                .accessibilityIdentifier("squad-name")
            Button { name = draft.trimmingCharacters(in: .whitespacesAndNewlines); dismiss() } label: {
                Text("Save squad name").font(.system(size: 15, weight: .bold)).frame(maxWidth: .infinity).padding(18)
                    .foregroundStyle(Ink.background).background(Ink.lime, in: RoundedRectangle(cornerRadius: 13))
            }.disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Spacer()
        }.padding(26).padding(.top, 24).background(Ink.background)
            .onAppear { draft = name }.presentationDetents([.medium]).presentationDragIndicator(.visible)
    }
}

func eyebrow(_ text: String) -> some View {
    Text(text).font(.system(size: 9, weight: .bold, design: .monospaced)).tracking(1.3).foregroundStyle(Ink.muted)
}
func sectionHeading(_ title: String, detail: String) -> some View {
    HStack { Text(title).font(.system(size: 17, weight: .semibold, design: .rounded)); Spacer(); Text(detail).font(.system(size: 8, weight: .bold, design: .monospaced)).tracking(0.8).foregroundStyle(Ink.muted) }
}
func pageTitle(_ title: String, subtitle: String) -> some View {
    VStack(alignment: .leading, spacing: 11) {
        Text(title).font(.system(size: 35, weight: .semibold, design: .rounded)).tracking(-1.4).fixedSize(horizontal: false, vertical: true)
        Text(subtitle).font(.system(size: 13)).foregroundStyle(Ink.muted)
    }.padding(.top, 8)
}
func marketBadge(_ market: Market, size: CGFloat) -> some View {
    Image(systemName: market.icon).font(.system(size: size * 0.38, weight: .medium)).foregroundStyle(market.color)
        .frame(width: size, height: size).background(market.color.opacity(0.1), in: RoundedRectangle(cornerRadius: size * 0.3))
}
func detailRow(_ label: String, _ value: String) -> some View {
    HStack { Text(label).font(.system(size: 12)).foregroundStyle(Ink.muted); Spacer(); Text(value).font(.system(size: 12, weight: .semibold, design: .monospaced)).monospacedDigit() }
}
func labelPill(_ text: String, color: Color) -> some View {
    Text(text).font(.system(size: 8, weight: .bold, design: .monospaced)).foregroundStyle(color).padding(.horizontal, 8).padding(.vertical, 6).background(color.opacity(0.1), in: Capsule())
}
private func metric(_ title: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: 12) {
        Text(title).font(.system(size: 7, weight: .bold, design: .monospaced)).tracking(0.2).foregroundStyle(Ink.muted)
        Text(value).font(.system(size: 20, weight: .semibold, design: .rounded)).minimumScaleFactor(0.5).lineLimit(1)
    }.padding(13).frame(maxWidth: .infinity, alignment: .leading).background(Ink.panel, in: RoundedRectangle(cornerRadius: 14))
}
private func settingsRow(_ title: String, icon: String, color: Color) -> some View {
    HStack { Image(systemName: icon); Text(title); Spacer(); Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)) }.font(.system(size: 13)).foregroundStyle(color).padding(.vertical, 8)
}
private func rule(_ number: String, _ title: String, _ body: String) -> some View {
    VStack(alignment: .leading, spacing: 9) {
        Text("\(number)  \(title)").font(.system(size: 15, weight: .bold)).foregroundStyle(Ink.lime)
        Text(body).font(.system(size: 13)).foregroundStyle(Ink.muted).lineSpacing(5)
    }
}

#Preview { ContentView().environmentObject(TradingEngine(storage: nil)).environmentObject(VoiceSession()).preferredColorScheme(.dark) }
