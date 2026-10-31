import SwiftUI
import WebKit
import UIKit

/// The live iPhone floor uses the released interface. The original native client
/// stays accessible with its existing keychain login; credentials are never exported.
struct LiveFloorView: View {
    let onNative: () -> Void
    @StateObject private var state = LiveFloorState()
    var body: some View {
        ZStack {
            Ink.background.ignoresSafeArea()
            // Edge to edge: the web app pads itself with env(safe-area-inset-*), like the installed PWA.
            LiveFloorWebView(state: state).ignoresSafeArea()
            if state.loading {
                VStack(spacing: 14) {
                    Text("brokie.").font(.system(size: 38, weight: .black, design: .rounded)).italic()
                    ProgressView().tint(Ink.lime)
                    Text("Opening the trading floor").font(.system(size: 12, design: .monospaced)).foregroundStyle(Ink.muted)
                }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Ink.background)
            }
            if let error = state.error {
                VStack(spacing: 18) {
                    Image(systemName: "wifi.exclamationmark").font(.largeTitle).foregroundStyle(Ink.lime)
                    Text("The floor is offline").font(.title2.bold())
                    Text(error).font(.subheadline).foregroundStyle(Ink.muted).multilineTextAlignment(.center)
                    Button("Try again") { state.retry() }.buttonStyle(.borderedProminent).tint(Ink.lime).foregroundStyle(Ink.background)
                    Button("Practice offline", action: onNative).foregroundStyle(Ink.lime)
                }.padding(30).frame(maxWidth: .infinity, maxHeight: .infinity).background(Ink.background)
            }
        }
        .preferredColorScheme(.dark)
    }
}

@MainActor
final class LiveFloorState: ObservableObject {
    @Published var loading = true
    @Published var error: String?
    weak var webView: WKWebView?
    func retry() { error = nil; loading = true; webView?.load(URLRequest(url: BrokieConfig.liveFloorURL, cachePolicy: .reloadRevalidatingCacheData)) }
}

struct LiveFloorWebView: UIViewRepresentable {
    @ObservedObject var state: LiveFloorState
    func makeCoordinator() -> Coordinator { Coordinator(state: state) }
    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "brokieHaptic")
        // A haptic bridge and an "in the iOS app" flag. Native keychain credentials are not read or injected.
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let script = """
        if (location.origin === 'https://samdando.github.io' && location.pathname.startsWith('/brokie/')) {
            window.brokieNative = Object.freeze({ platform: 'ios', version: '\(version)' });
            document.documentElement.classList.add('ios-app');
            navigator.vibrate = function(pattern) {
                var list = Array.isArray(pattern) ? pattern : [pattern];
                window.webkit.messageHandlers.brokieHaptic.postMessage({ pattern: list.map(Number) });
                return true;
            };
        }
        """
        controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Hold-to-trade must never start text selection, the loupe or the copy/share callout.
        let css = """
        var s = document.createElement('style');
        s.textContent = 'html,body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}input,textarea,[contenteditable]{-webkit-user-select:text;user-select:text}';
        document.head.appendChild(s);
        """
        controller.addUserScript(WKUserScript(source: css, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator; view.uiDelegate = context.coordinator
        view.isOpaque = false; view.backgroundColor = UIColor(red: 11 / 255, green: 16 / 255, blue: 24 / 255, alpha: 1)
        view.scrollView.backgroundColor = view.backgroundColor
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = false
        view.allowsBackForwardNavigationGestures = false
        view.allowsLinkPreview = false
        view.scrollView.showsVerticalScrollIndicator = false
        view.isInspectable = _isDebugAssertConfiguration()
        state.webView = view
        view.load(URLRequest(url: BrokieConfig.liveFloorURL, cachePolicy: .reloadRevalidatingCacheData))
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {}
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.stopLoading(); view.configuration.userContentController.removeScriptMessageHandler(forName: "brokieHaptic")
        view.navigationDelegate = nil; view.uiDelegate = nil
    }
    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        let state: LiveFloorState
        init(state: LiveFloorState) { self.state = state }
        private func allowed(_ url: URL?) -> Bool {
            guard let url else { return false }
            return url.scheme == "https" && url.host == BrokieConfig.liveFloorURL.host && (url.path == "/brokie" || url.path.hasPrefix("/brokie/"))
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { state.loading = false; state.error = nil }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }
        private func fail(_ error: Error) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            state.loading = false; state.error = "Check your connection, then try again. You can still practise offline in the meantime."
        }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { state.retry() }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if allowed(url) || url.scheme == "about" { decisionHandler(.allow); return }
            if action.navigationType == .linkActivated && ["https", "http", "mailto"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
            decisionHandler(.cancel)
        }
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url {
                if allowed(url) { webView.load(action.request) }
                else if action.navigationType == .linkActivated && ["https", "http", "mailto"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
            }
            return nil
        }
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(origin.protocol == "https" && origin.host == BrokieConfig.liveFloorURL.host && frame.isMainFrame && type == .microphone ? .prompt : .deny)
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, allowed(message.frameInfo.request.url), let body = message.body as? [String: Any] else { return }
            let pattern = (body["pattern"] as? [Double]) ?? [(body["duration"] as? Double) ?? 12]
            Haptics.play(pattern)
        }
    }
}

/** Maps the web app's vibration patterns onto iOS haptics: [10,40,18] a win, [40,30,40] a refusal/loss,
 *  short single taps a light tick (size chips, holds), longer ones a firm thump. */
@MainActor
enum Haptics {
    private static let light = UIImpactFeedbackGenerator(style: .light)
    private static let rigid = UIImpactFeedbackGenerator(style: .rigid)
    private static let heavy = UIImpactFeedbackGenerator(style: .heavy)
    private static let notify = UINotificationFeedbackGenerator()
    static func play(_ pattern: [Double]) {
        let first = pattern.first ?? 12
        if pattern.count >= 3 {
            notify.notificationOccurred(first <= 15 ? .success : .error)
        } else if first <= 10 {
            light.impactOccurred(intensity: 0.7)
        } else if first <= 25 {
            rigid.impactOccurred()
        } else {
            heavy.impactOccurred()
        }
    }
}
