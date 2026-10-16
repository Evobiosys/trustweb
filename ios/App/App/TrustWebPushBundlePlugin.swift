// Wave 12: the web app's way to hand the push bundle to the Notification Service Extension (PushBundleStore.swift).
// A Capacitor plugin local to this app: `Capacitor.Plugins.TrustWebPushBundle.write({bundle})` and `.clear()`
// (apps/trustweb/src/native_push.ts). Registered by TrustWebViewController.
import Foundation
import Capacitor

@objc(TrustWebPushBundlePlugin)
public class TrustWebPushBundlePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TrustWebPushBundlePlugin"
    public let jsName = "TrustWebPushBundle"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    @objc func write(_ call: CAPPluginCall) {
        guard let json = call.getString("bundle"), !json.isEmpty else {
            call.reject("bundle missing")
            return
        }
        do {
            try PushBundleStore.write(json)
            call.resolve()
        } catch {
            call.reject("could not write the bundle")
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        PushBundleStore.clear()
        call.resolve()
    }
}
