// Wave 12: the app's bridge view controller (Main.storyboard), only to register the app-local plugin.
import UIKit
import Capacitor

class TrustWebViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TrustWebPushBundlePlugin())
    }
}
