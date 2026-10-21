// Full-screen camera that reads one QR code, for phone pairing (Settings → Sync → Scan QR code).
// Presented by OpenThingsPlugin.scanQRCode.

import AVFoundation
import UIKit

final class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    enum Outcome {
        case scanned(String)
        case cancelled
        case failed(String)
    }

    private let session = AVCaptureSession()
    private var preview: AVCaptureVideoPreviewLayer?
    private var onFinish: ((Outcome) -> Void)?

    init(onFinish: @escaping (Outcome) -> Void) {
        self.onFinish = onFinish
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        guard let camera = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: camera),
              session.canAddInput(input) else {
            finish(.failed("No camera is available."))
            return
        }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            finish(.failed("The camera can't read QR codes."))
            return
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(layer)
        preview = layer

        let hint = UILabel()
        hint.text = "Point at the QR code in OpenThings on your computer\n(Settings → Sync → Pair a phone)"
        hint.numberOfLines = 0
        hint.textAlignment = .center
        hint.textColor = .white
        hint.font = .preferredFont(forTextStyle: .subheadline)
        hint.translatesAutoresizingMaskIntoConstraints = false

        var config = UIButton.Configuration.filled()
        config.title = "Cancel"
        config.baseBackgroundColor = UIColor(white: 0.15, alpha: 0.85)
        config.baseForegroundColor = .white
        config.cornerStyle = .capsule
        let cancel = UIButton(configuration: config, primaryAction: UIAction { [weak self] _ in self?.finish(.cancelled) })
        cancel.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(hint)
        view.addSubview(cancel)
        NSLayoutConstraint.activate([
            hint.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            hint.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            hint.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
            cancel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            cancel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            cancel.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        let session = self.session
        DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        let session = self.session
        DispatchQueue.global(qos: .userInitiated).async { session.stopRunning() }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let code = metadataObjects.lazy.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        finish(.scanned(code))
    }

    /// Reports once, then closes the scanner.
    private func finish(_ outcome: Outcome) {
        guard let onFinish else { return }
        self.onFinish = nil
        DispatchQueue.main.async {
            if self.presentingViewController != nil {
                self.dismiss(animated: true) { onFinish(outcome) }
            } else {
                onFinish(outcome)
            }
        }
    }
}
