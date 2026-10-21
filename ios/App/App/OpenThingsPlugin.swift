// Bridge between the web app (src/lib/native/capacitor.svelte.ts) and the App Group.
// JS name: "OpenThingsNative". Registered in OpenThingsViewController.

import AVFoundation
import Capacitor
import Foundation
import WidgetKit

@objc(OpenThingsPlugin)
public class OpenThingsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OpenThingsPlugin"
    public let jsName = "OpenThingsNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "writeSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takePending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanQRCode", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        // Extensions and App Intents post a Darwin notification after queueing a to-do.
        let observer = Unmanaged.passUnretained(self).toOpaque()
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            observer,
            { _, observer, _, _, _ in
                guard let observer else { return }
                let plugin = Unmanaged<OpenThingsPlugin>.fromOpaque(observer).takeUnretainedValue()
                DispatchQueue.main.async {
                    plugin.notifyListeners("pendingChanged", data: [:])
                }
            },
            OTShared.pendingNotificationName as CFString,
            nil,
            .deliverImmediately
        )
    }

    deinit {
        CFNotificationCenterRemoveEveryObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque()
        )
    }

    @objc func writeSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("Missing json")
            return
        }
        guard let url = OTShared.snapshotURL else {
            call.reject("App Group \(OTShared.appGroup) is not available")
            return
        }
        do {
            try Data(json.utf8).write(to: url, options: .atomic)
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
        } catch {
            call.reject("Couldn't write the widget snapshot: \(error.localizedDescription)")
        }
    }

    @objc func takePending(_ call: CAPPluginCall) {
        let items = OTShared.takePendingRaw()
        var result: [String: Any] = ["items": items]
        if let route = OTShared.takeRoute() {
            result["route"] = route
        } else {
            result["route"] = NSNull()
        }
        call.resolve(result)
    }

    @objc func info(_ call: CAPPluginCall) {
        call.resolve([
            "appGroup": OTShared.appGroup,
            "containerAvailable": OTShared.containerURL != nil,
        ])
    }

    /// Phone pairing: open the camera, resolve with the first QR code it reads.
    @objc func scanQRCode(_ call: CAPPluginCall) {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            presentScanner(call)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                if granted {
                    self.presentScanner(call)
                } else {
                    call.reject("Camera access is off. Allow it in Settings → OpenThings → Camera.", "DENIED")
                }
            }
        default:
            call.reject("Camera access is off. Allow it in Settings → OpenThings → Camera.", "DENIED")
        }
    }

    private func presentScanner(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("The app isn't ready to show the camera.")
                return
            }
            let scanner = QRScannerViewController { outcome in
                switch outcome {
                case .scanned(let value): call.resolve(["value": value])
                case .cancelled: call.reject("Scan cancelled", "CANCELLED")
                case .failed(let message): call.reject(message)
                }
            }
            presenter.present(scanner, animated: true)
        }
    }
}
