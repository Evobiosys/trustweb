// Wave 12: what the Notification Service Extension needs of TrustWeb's wire, in Swift, byte-for-byte the web app's:
// base64url (apps/demo/src/crypto.ts), did:peer:2 resolution (did.ts: base58btc multibase, multicodec 0xec01 for the
// X25519 key), the pair key (X25519 shared secret -> HKDF-SHA256, empty salt, info "ew-demo-ecdh-pair-v1", 32 bytes:
// crypto.ts deriveEcdhPairKey), the envelope framing (relay.ts decryptEnvelope: 12-byte IV + AES-GCM ciphertext and
// tag) and the notification lines (notify_kinds.ts workerLines). CryptoKit only, no dependency.
import Foundation
import CryptoKit

enum B64u {
    static func decode(_ s: String) -> Data? {
        var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while t.count % 4 != 0 { t += "=" }
        return Data(base64Encoded: t)
    }

    static func encode(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

enum Base58 {
    private static let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")

    static func decode(_ s: String) -> Data? {
        var bytes: [UInt8] = []
        for c in s {
            guard let digit = alphabet.firstIndex(of: c) else { return nil }
            var carry = digit
            for i in stride(from: bytes.count - 1, through: 0, by: -1) {
                carry += 58 * Int(bytes[i])
                bytes[i] = UInt8(carry & 0xff)
                carry >>= 8
            }
            while carry > 0 {
                bytes.insert(UInt8(carry & 0xff), at: 0)
                carry >>= 8
            }
        }
        let zeros = s.prefix(while: { $0 == "1" }).count
        return Data(repeating: 0, count: zeros) + Data(bytes)
    }
}

/// The identity as apps/demo/src/did.ts serializes it (SerializedIdentityV1).
struct Identity: Decodable {
    let did: String
    let signingSecretKey: String
    let keyAgreementSecretKey: String

    func signing() throws -> Curve25519.Signing.PrivateKey {
        guard let seed = B64u.decode(signingSecretKey) else { throw WireError.badKey }
        return try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
    }

    func keyAgreement() throws -> Curve25519.KeyAgreement.PrivateKey {
        guard let raw = B64u.decode(keyAgreementSecretKey) else { throw WireError.badKey }
        return try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: raw)
    }

    /// did.ts signChallenge: the relay's nonce (base64url) signed with Ed25519, base64url.
    func signChallenge(_ nonceB64u: String) throws -> String {
        guard let nonce = B64u.decode(nonceB64u) else { throw WireError.badNonce }
        return B64u.encode(try signing().signature(for: nonce))
    }
}

enum WireError: Error { case badKey, badNonce, badDid }

enum Did {
    private static let x25519Prefix: [UInt8] = [0xec, 0x01]

    /// The X25519 public key in a did:peer:2's E element (did.ts resolveDidPeer).
    static func keyAgreementPublicKey(of did: String) throws -> Curve25519.KeyAgreement.PublicKey {
        guard did.hasPrefix("did:peer:2.") else { throw WireError.badDid }
        for element in did.dropFirst("did:peer:2.".count).split(separator: ".") where element.first == "E" {
            let multibase = element.dropFirst()
            guard multibase.first == "z", let bytes = Base58.decode(String(multibase.dropFirst())), bytes.count == 34, Array(bytes.prefix(2)) == x25519Prefix else { throw WireError.badDid }
            return try Curve25519.KeyAgreement.PublicKey(rawRepresentation: bytes.dropFirst(2))
        }
        throw WireError.badDid
    }
}

enum PairKey {
    /// crypto.ts deriveEcdhPairKey over did.ts ecdhSharedSecret.
    static func derive(_ me: Identity, peer: String) throws -> SymmetricKey {
        let shared = try me.keyAgreement().sharedSecretFromKeyAgreement(with: try Did.keyAgreementPublicKey(of: peer))
        return shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data(), sharedInfo: Data("ew-demo-ecdh-pair-v1".utf8), outputByteCount: 32)
    }
}

/// What one waiting wire tells the person: its kind and the sender's name as this phone knows it.
struct Arrival {
    let kind: String
    let name: String?
}

enum Wire {
    /// relay.ts decryptEnvelope: base64url(iv || ciphertext || tag) -> the envelope JSON. Nil for anything not under this key.
    static func open(_ payloadB64u: String, key: SymmetricKey) -> [String: Any]? {
        guard let framed = B64u.decode(payloadB64u), framed.count > 12 + 16, let box = try? AES.GCM.SealedBox(combined: framed), let plain = try? AES.GCM.open(box, using: key) else { return nil }
        return (try? JSONSerialization.jsonObject(with: plain)) as? [String: Any]
    }

    /// notify_kinds.ts kindOfWire.
    static func kind(of t: String) -> String? {
        switch t {
        case "connect", "connect-ack": return "connect"
        case "query", "ask-again": return "ask"
        case "chat": return "chat"
        default: return nil
        }
    }

    /// notify_kinds.ts workerLines: one line per kind that is on, naming who.
    static func lines(_ arrivals: [Arrival], kinds: [String: Bool]) -> [String] {
        var lines: [String] = []
        for kind in ["connect", "ask", "chat"] where kinds[kind] ?? true {
            let of = arrivals.filter { $0.kind == kind }
            if of.isEmpty { continue }
            var names: [String] = []
            for a in of { if let n = a.name, !n.isEmpty, !names.contains(n) { names.append(n) } }
            let who = names.isEmpty ? "Someone" : names.count == 1 ? names[0] : names.count == 2 ? "\(names[0]) and \(names[1])" : "\(names[0]) and \(names.count - 1) others"
            let n = of.count
            switch kind {
            case "connect": lines.append(n == 1 ? "\(who) wants to connect." : "\(who) want to connect.")
            case "ask": lines.append(n == 1 ? "\(who) is sending you a query." : "\(who) sent you \(n) queries.")
            default: lines.append(n == 1 ? "\(who) sent you a message." : "\(who) sent you \(n) messages.")
            }
        }
        return lines
    }
}
