// Wave 12: TrustWeb's Notification Service Extension. Apple's push service delivers the relay's constant alert
// (packages/transport/src/apns_push.ts: "Something arrived for you", mutable-content). Before it shows, iOS runs this
// extension on the phone, and it does what the Android service worker does (apps/trustweb/src/sw/sw.ts): opens the relay
// drain with the identity from the push bundle (PushBundleStore.swift) in PEEK mode (read-only, never displacing the app's
// own drain, acking nothing), reads the waiting wires under the pair keys only this phone can derive, and rewrites the
// words: who wants to connect, who sent a query, who wrote. Apple carried the generic words only. When nothing can be read
// in time (no network, no bundle), the generic words stay.
import UserNotifications
import CryptoKit
import Foundation

class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var content: UNMutableNotificationContent?
    private var peek: PeekDrain?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content)
            return
        }
        self.content = content
        guard let data = PushBundleStore.read(), let bundle = try? JSONDecoder().decode(PushBundle.self, from: data), bundle.v == 1 else {
            deliver()
            return
        }
        content.title = bundle.appName
        let peek = PeekDrain(bundle: bundle)
        self.peek = peek
        peek.run { [weak self] arrivals in
            guard let self = self else { return }
            let lines = Wire.lines(arrivals, kinds: bundle.kinds)
            // Every kind that arrived is off, or nothing was readable: the fixed words stay (an extension cannot drop a notification).
            if !lines.isEmpty { self.content?.body = lines.joined(separator: "\n") }
            self.deliver()
        }
    }

    /// iOS gives about 30 s; what is known by then is shown.
    override func serviceExtensionTimeWillExpire() {
        peek?.cancel()
        deliver()
    }

    private func deliver() {
        guard let handler = contentHandler, let content = content else { return }
        contentHandler = nil
        handler(content)
    }
}

/// push_bundle.ts PushBundle.
struct PushBundle: Decodable {
    let v: Int
    let identity: Identity
    let peers: [Peer]
    let kinds: [String: Bool]
    let relayOrigin: String
    let appName: String

    struct Peer: Decodable {
        let did: String
        let name: String
    }
}

/// sw.ts peekDrain over URLSessionWebSocketTask: challenge -> auth{peek:true} -> wire* -> peek_end (or quiet).
final class PeekDrain {
    private static let totalSeconds: TimeInterval = 12
    private static let quietSeconds: TimeInterval = 1.5

    private let bundle: PushBundle
    private var task: URLSessionWebSocketTask?
    private var arrivals: [Arrival] = []
    private var keys: [String: SymmetricKeyBox] = [:]
    private var done = false
    private var quiet: DispatchWorkItem?
    private var finish: (([Arrival]) -> Void)?
    private let queue = DispatchQueue(label: "one.trustweb.app.notify.peek")

    init(bundle: PushBundle) {
        self.bundle = bundle
    }

    func run(_ finish: @escaping ([Arrival]) -> Void) {
        self.finish = finish
        guard var url = URLComponents(string: bundle.relayOrigin) else { end(); return }
        url.scheme = url.scheme == "http" ? "ws" : "wss"
        url.path = "/relay/drain"
        guard let wsUrl = url.url else { end(); return }
        let task = URLSession(configuration: .ephemeral).webSocketTask(with: wsUrl)
        self.task = task
        task.resume()
        receive()
        queue.asyncAfter(deadline: .now() + PeekDrain.totalSeconds) { [weak self] in self?.end() }
    }

    func cancel() {
        end()
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self = self else { return }
            self.queue.async {
                switch result {
                case .failure: self.end()
                case .success(let message):
                    if case .string(let text) = message { self.handle(text) }
                    if !self.done { self.receive() }
                }
            }
        }
    }

    private func handle(_ text: String) {
        guard let msg = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any], let type = msg["type"] as? String else { return }
        switch type {
        case "challenge":
            guard let nonce = msg["nonce"] as? String, let sig = try? bundle.identity.signChallenge(nonce) else { end(); return }
            let auth: [String: Any] = ["type": "auth", "did": bundle.identity.did, "sig": sig, "peek": true]
            if let data = try? JSONSerialization.data(withJSONObject: auth), let s = String(data: data, encoding: .utf8) { task?.send(.string(s)) { _ in } }
        case "auth_ok": settle()
        case "peek_end": end()
        case "auth_failed": end()
        case "wire":
            if let wire = msg["wire"] as? String { read(wire) }
            settle()
        default: break
        }
    }

    /// sw.ts read(): a connection's wire under its pair key, else the one unencrypted wire there is, a connect-ack.
    private func read(_ raw: String) {
        guard let outer = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any], let from = outer["from"] as? String, let payload = outer["payload"] as? String else { return }
        if let name = bundle.peers.first(where: { $0.did == from })?.name {
            if keys[from] == nil, let key = try? PairKey.derive(bundle.identity, peer: from) { keys[from] = SymmetricKeyBox(key) }
            if let key = keys[from]?.key, let env = Wire.open(payload, key: key), let t = env["t"] as? String {
                if let kind = Wire.kind(of: t) { arrivals.append(Arrival(kind: kind, name: name)) }
                return
            }
        }
        if let plainData = B64u.decode(payload), let env = (try? JSONSerialization.jsonObject(with: plainData)) as? [String: Any], env["t"] as? String == "connect-ack" {
            let who = (env["from"] as? [String: Any])?["displayName"] as? String
            arrivals.append(Arrival(kind: "connect", name: (who?.isEmpty ?? true) ? nil : who))
        }
    }

    /// An older relay sends no peek_end: quiet for a moment after auth means everything that waited is in.
    private func settle() {
        quiet?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.end() }
        quiet = item
        queue.asyncAfter(deadline: .now() + PeekDrain.quietSeconds, execute: item)
    }

    private func end() {
        queue.async {
            if self.done { return }
            self.done = true
            self.quiet?.cancel()
            self.task?.cancel(with: .normalClosure, reason: nil)
            let finish = self.finish
            self.finish = nil
            finish?(self.arrivals)
        }
    }
}

/// SymmetricKey in a class, so the dictionary above holds one derived key per sender.
final class SymmetricKeyBox {
    let key: SymmetricKey
    init(_ key: SymmetricKey) { self.key = key }
}
