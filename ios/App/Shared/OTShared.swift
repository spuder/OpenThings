// Shared by the app, the widget extension and the share extension.
// The App Group container is the only channel between them:
//
//   snapshot.json      written by the app (from the web code) on every change; widgets read it
//   pending/*.json     one file per to-do created by the Share extension, a Shortcut or a widget;
//                      the app imports them through the normal store (op log) and deletes them
//   route.txt          a link such as openthings://today queued by an App Intent
//
// Formats are documented in docs/ios.md and mirrored in src/lib/native/snapshot.ts.

import Foundation

enum OTShared {
    /// From Info.plist key OTAppGroup, which is set from OT_APP_GROUP in ios/App/Config/OpenThings.xcconfig.
    static var appGroup: String {
        (Bundle.main.object(forInfoDictionaryKey: "OTAppGroup") as? String) ?? "group.io.github.spuder.openthings"
    }

    static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    }

    static var snapshotURL: URL? { containerURL?.appendingPathComponent("snapshot.json") }
    static var pendingDir: URL? { containerURL?.appendingPathComponent("pending", isDirectory: true) }
    static var routeURL: URL? { containerURL?.appendingPathComponent("route.txt") }

    /// Darwin notification posted when something is queued, so a running app imports it right away.
    static var pendingNotificationName: String { appGroup + ".pending" }

    static let todayWidgetKind = "OpenThingsToday"
    static let syncWidgetKind = "OpenThingsSync"

    // MARK: Snapshot (app -> widgets)

    static func readSnapshot() -> OTSnapshot? {
        guard let url = snapshotURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(OTSnapshot.self, from: data)
    }

    // MARK: Pending to-dos (extensions -> app)

    enum Target: String, Codable { case inbox, dump }

    enum QueueError: LocalizedError {
        case noContainer
        var errorDescription: String? {
            "The App Group \(OTShared.appGroup) is not available. Check the App Groups capability on all targets."
        }
    }

    /// Queue a to-do for the app to import. `parse` = true runs the quick-add parser (Shortcuts);
    /// false keeps the text literal (shared pages often contain # or @).
    static func enqueue(text: String, notes: String?, parse: Bool, target: Target, source: String) throws {
        guard let dir = pendingDir else { throw QueueError.noContainer }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let item = OTPendingItem(
            id: UUID().uuidString.lowercased(),
            text: text,
            notes: notes,
            parse: parse,
            target: target,
            source: source,
            createdAt: isoFormatter.string(from: Date())
        )
        let data = try JSONEncoder().encode(item)
        let millis = Int(Date().timeIntervalSince1970 * 1000)
        // One file per item: no read-modify-write races between processes. Names sort by time.
        try data.write(to: dir.appendingPathComponent("\(millis)-\(item.id).json"), options: .atomic)
        postPendingChanged()
    }

    /// Returns queued items as JSON objects (oldest first) and deletes them.
    static func takePendingRaw() -> [[String: Any]] {
        guard let dir = pendingDir,
              let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
        var out: [[String: Any]] = []
        for name in names.sorted() where name.hasSuffix(".json") {
            let url = dir.appendingPathComponent(name)
            if let data = try? Data(contentsOf: url),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                out.append(obj)
            }
            try? FileManager.default.removeItem(at: url)
        }
        return out
    }

    static func setRoute(_ route: String) {
        guard let url = routeURL else { return }
        try? Data(route.utf8).write(to: url, options: .atomic)
        postPendingChanged()
    }

    static func takeRoute() -> String? {
        guard let url = routeURL, let data = try? Data(contentsOf: url) else { return nil }
        try? FileManager.default.removeItem(at: url)
        let s = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return s.isEmpty ? nil : s
    }

    static func postPendingChanged() {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(pendingNotificationName as CFString),
            nil, nil, true
        )
    }

    // MARK: Dates

    static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func parseISO(_ s: String?) -> Date? {
        guard let s else { return nil }
        return isoFormatter.date(from: s) ?? isoPlain.date(from: s)
    }

    /// Local calendar day as YYYY-MM-DD, the same format the web app uses.
    static func localDay(_ date: Date = Date()) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

struct OTPendingItem: Codable {
    let id: String
    let text: String
    let notes: String?
    let parse: Bool
    let target: OTShared.Target
    let source: String
    let createdAt: String
}

/// Mirrors `Snapshot` in src/lib/native/snapshot.ts.
struct OTSnapshot: Codable {
    struct Item: Codable, Identifiable, Hashable {
        let id: String
        let title: String
        let evening: Bool
        let container: String?
        let deadline: String?
        let reminderAt: String?
    }

    struct Counts: Codable {
        let today: Int
        let evening: Int
        let inbox: Int
        let dump: Int
    }

    struct Reminder: Codable, Hashable {
        let taskId: String
        let title: String
        let at: String
    }

    struct Sync: Codable {
        let status: String
        let enabled: Bool
        let pending: Int
        let lastSyncedAt: String?
        let error: String?
    }

    let version: Int
    let generatedAt: String
    let day: String
    let today: [Item]
    let counts: Counts
    let reminders: [Reminder]
    let sync: Sync

    /// True when the lists were computed for an earlier day (the app hasn't run since midnight).
    var isStale: Bool { day < OTShared.localDay() }

    static let sample = OTSnapshot(
        version: 1,
        generatedAt: OTShared.isoFormatter.string(from: Date()),
        day: OTShared.localDay(),
        today: [
            Item(id: "1", title: "Water the plants", evening: false, container: "Home", deadline: nil, reminderAt: nil),
            Item(id: "2", title: "Draft the newsletter", evening: false, container: "Shop", deadline: nil, reminderAt: nil),
            Item(id: "3", title: "Call the dentist", evening: false, container: nil, deadline: nil, reminderAt: nil),
            Item(id: "4", title: "Read a chapter", evening: true, container: nil, deadline: nil, reminderAt: nil),
        ],
        counts: Counts(today: 3, evening: 1, inbox: 2, dump: 0),
        reminders: [],
        sync: Sync(status: "idle", enabled: true, pending: 0, lastSyncedAt: OTShared.isoFormatter.string(from: Date()), error: nil)
    )
}
