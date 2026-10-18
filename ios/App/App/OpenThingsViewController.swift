import Capacitor
import UIKit

/// Capacitor's bridge view controller plus the OpenThings native plugin.
class OpenThingsViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(OpenThingsPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // Match the app's light/dark background so there's no white flash before the web view paints.
        let background = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0x1d / 255.0, green: 0x1e / 255.0, blue: 0x21 / 255.0, alpha: 1)
                : .white
        }
        view.backgroundColor = background
        webView?.isOpaque = false
        webView?.backgroundColor = background
        webView?.scrollView.backgroundColor = background
    }
}
