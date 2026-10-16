// Wave 12: the one file the app and its Notification Service Extension (TrustWebNotify) share, in the App Group container:
// the push bundle (apps/trustweb/src/push_bundle.ts, as JSON): this phone's relay identity, its connections by DID with the
// names it shows for them, the per-kind switches, the relay origin and the app name. Written by the web app through
// TrustWebPushBundlePlugin after every save while notifications are on; removed when they are turned off. Same keys the app
// holds, same phone: nothing new leaves it. Compiled into both targets.
import Foundation

enum PushBundleStore {
    static let appGroup = "group.one.trustweb.app"
    private static let fileName = "push-bundle.json"

    /// The App Group container; a build without the entitlement (the unsigned simulator smoke build) falls back to the app's own support directory.
    static var url: URL {
        let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base.appendingPathComponent(fileName)
    }

    static func write(_ json: String) throws {
        // Readable after the first unlock since boot: that is when the extension may need it (a notification while the phone is locked).
        try Data(json.utf8).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func clear() {
        try? FileManager.default.removeItem(at: url)
    }

    static func read() -> Data? {
        try? Data(contentsOf: url)
    }
}
