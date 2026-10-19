// Share Sheet extension: "Send to OpenThings" from Safari, Notes, Mail, etc.
// Shows a small sheet to edit the title and pick Inbox or Brain Dump, then queues the to-do in the
// App Group. The app imports it through store.addParsed on next launch or foreground (docs/ios.md).

import SwiftUI
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let model = ShareModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        let root = ShareView(model: model, onCancel: { [weak self] in self?.cancel() }, onSave: { [weak self] in self?.save() })
        let host = UIHostingController(rootView: root)
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        host.didMove(toParent: self)
        loadSharedItems()
    }

    private func loadSharedItems() {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { item -> [NSItemProvider] in
            if let text = item.attributedContentText?.string, !text.isEmpty {
                DispatchQueue.main.async { self.model.offer(text: text) }
            }
            return item.attachments ?? []
        }
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.url.identifier) { value, _ in
                    let url = (value as? URL) ?? (value as? String).flatMap(URL.init(string:))
                    if let url { DispatchQueue.main.async { self.model.offer(url: url) } }
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { value, _ in
                    if let text = value as? String { DispatchQueue.main.async { self.model.offer(text: text) } }
                }
            }
        }
    }

    private func save() {
        do {
            try model.enqueue()
            extensionContext?.completeRequest(returningItems: nil)
        } catch {
            model.error = error.localizedDescription
        }
    }

    private func cancel() {
        extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    }
}

final class ShareModel: ObservableObject {
    @Published var title = ""
    @Published var url: URL?
    @Published var target: OTShared.Target = .inbox
    @Published var error: String?

    func offer(text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if title.isEmpty { title = trimmed }
        // Some apps share a page as text that is just the URL.
        if url == nil, let u = URL(string: trimmed), u.scheme?.hasPrefix("http") == true {
            url = u
            if title == trimmed { title = "" }
        }
    }

    func offer(url: URL) {
        self.url = url
        if title == url.absoluteString { title = "" }
    }

    var canSave: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || url != nil }

    func enqueue() throws {
        let text = title.trimmingCharacters(in: .whitespacesAndNewlines)
        try OTShared.enqueue(
            text: text.isEmpty ? (url?.absoluteString ?? "") : text,
            notes: text.isEmpty ? nil : url?.absoluteString,
            parse: false,
            target: target,
            source: "share"
        )
    }
}

struct ShareView: View {
    @ObservedObject var model: ShareModel
    let onCancel: () -> Void
    let onSave: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        NavigationView {
            Form {
                Section {
                    TextField("Title", text: $model.title)
                        .focused($focused)
                        .submitLabel(.done)
                        .onSubmit { if model.canSave { onSave() } }
                    if let url = model.url {
                        Text(url.absoluteString).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
                Section {
                    Picker("Add to", selection: $model.target) {
                        Text("Inbox").tag(OTShared.Target.inbox)
                        Text("Brain Dump").tag(OTShared.Target.dump)
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text(model.target == .dump
                         ? "Brain Dump items disappear after 48 hours unless you keep them."
                         : "It appears in your Inbox the next time you open OpenThings.")
                }
                if let error = model.error {
                    Section { Text(error).foregroundStyle(.red).font(.footnote) }
                }
            }
            .navigationTitle("OpenThings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", action: onSave).disabled(!model.canSave)
                }
            }
            .onAppear { focused = true }
        }
        .navigationViewStyle(.stack)
    }
}
