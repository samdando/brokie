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
            LiveFloorWebView(state: state).ignoresSafeArea(.container, edges: .bottom)
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
                    Button("Open native client", action: onNative).foregroundStyle(Ink.lime)
                }.padding(30).frame(maxWidth: .infinity, maxHeight: .infinity).background(Ink.background)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack {
                Text("LIVE FLOOR").font(.system(size: 8, weight: .bold, design: .monospaced)).foregroundStyle(Ink.muted)
                Spacer()
                Button("Native account", action: onNative).font(.system(size: 10, weight: .semibold)).foregroundStyle(Ink.lime)
            }.padding(.horizontal, 16).frame(height: 30).background(Ink.background)
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
        // Only a haptic bridge. Native keychain credentials are not read or injected.
        let script = """
        if (location.origin === 'https://samdando.github.io' && location.pathname.startsWith('/brokie/')) {
            navigator.vibrate = function(pattern) {
                window.webkit.messageHandlers.brokieHaptic.postMessage({duration: Array.isArray(pattern) ? pattern[0] : pattern});
                return true;
            };
        }
        """
        controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
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
            state.loading = false; state.error = "Check your connection, then retry. Your native account remains saved in the original client."
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
            let duration = (body["duration"] as? Double) ?? 12
            UIImpactFeedbackGenerator(style: duration > 25 ? .heavy : .light).impactOccurred()
        }
    }
}
