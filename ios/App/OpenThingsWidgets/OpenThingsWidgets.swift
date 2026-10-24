// Home Screen and Lock Screen widgets. They can't run the web app, so they read the snapshot the app
// writes into the App Group (see ios/App/Shared/OTShared.swift and docs/ios.md).
// Tapping opens the app through the openthings:// URL scheme.

import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Timeline

struct OTEntry: TimelineEntry {
    let date: Date
    let snapshot: OTSnapshot?
}

struct OTProvider: TimelineProvider {
    func placeholder(in context: Context) -> OTEntry {
        OTEntry(date: Date(), snapshot: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (OTEntry) -> Void) {
        completion(OTEntry(date: Date(), snapshot: context.isPreview ? (OTShared.readSnapshot() ?? .sample) : OTShared.readSnapshot()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<OTEntry>) -> Void) {
        let now = Date()
        let snap = OTShared.readSnapshot()
        // The app reloads timelines whenever its data changes. Also refresh at the next midnight
        // (so a stale day shows the "open the app" hint) and every 30 minutes for relative times.
        var entries = [OTEntry(date: now, snapshot: snap)]
        if let midnight = Calendar.current.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime) {
            entries.append(OTEntry(date: midnight, snapshot: snap))
        }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60))))
    }
}

// MARK: - Shared bits

enum OTColors {
    static let accent = Color(red: 0x2f / 255.0, green: 0x6f / 255.0, blue: 0xed / 255.0)

    static func sync(_ status: String) -> Color {
        switch status {
        case "idle": return .green
        case "pending", "syncing": return accent
        case "offline": return .orange
        case "error": return .red
        default: return .secondary
        }
    }
}

enum OTText {
    static func syncLabel(_ s: OTSnapshot.Sync) -> String {
        switch s.status {
        case "local": return "Local only"
        case "idle": return "Synced"
        case "pending": return "\(s.pending) to sync"
        case "syncing": return "Syncing…"
        case "offline": return s.pending > 0 ? "Offline · \(s.pending) waiting" : "Offline"
        case "error": return "Sync error"
        default: return s.status
        }
    }
}

struct CheckCircle: View {
    var body: some View {
        Circle()
            .strokeBorder(Color.secondary.opacity(0.6), lineWidth: 1.5)
            .frame(width: 14, height: 14)
    }
}

extension View {
    /// iOS 17 requires a container background for widgets.
    @ViewBuilder func otWidgetBackground() -> some View {
        if #available(iOS 17.0, *) {
            containerBackground(for: .widget) { Color(.systemBackground) }
        } else {
            padding().background(Color(.systemBackground))
        }
    }
}

// MARK: - Today widget

struct TodayView: View {
    @Environment(\.widgetFamily) private var family
    let entry: OTEntry

    private var maxRows: Int {
        switch family {
        case .systemSmall: return 4
        case .systemMedium: return 4
        case .systemLarge: return 11
        case .accessoryRectangular: return 2
        default: return 3
        }
    }

    var body: some View {
        switch family {
        case .accessoryInline: inline
        case .accessoryCircular: circular
        case .accessoryRectangular: rectangular
        default: system
        }
    }

    private var snap: OTSnapshot? { entry.snapshot }
    private var openCount: Int { (snap?.counts.today ?? 0) + (snap?.counts.evening ?? 0) }

    private var inline: some View {
        Text(snap == nil ? "OpenThings" : "\(openCount) today")
    }

    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Text("\(openCount)").font(.title2.weight(.semibold))
                Text("today").font(.caption2)
            }
        }
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Today · \(openCount)").font(.headline).widgetAccentable()
            if let tasks = snap?.today, !tasks.isEmpty {
                ForEach(tasks.prefix(maxRows)) { t in
                    Text(t.title).font(.caption).lineLimit(1)
                }
            } else {
                Text(snap == nil ? "Open OpenThings once" : "Nothing left today").font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var system: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Image(systemName: "star.fill").foregroundStyle(OTColors.accent).font(.caption)
                Text("Today").font(.headline)
                Spacer()
                if let snap {
                    Text("\(openCount)").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                    Circle().fill(OTColors.sync(snap.sync.status)).frame(width: 6, height: 6)
                }
            }
            if let snap {
                if snap.isStale {
                    Text("Open OpenThings to refresh").font(.caption).foregroundStyle(.secondary)
                } else if snap.today.isEmpty {
                    Spacer()
                    Text("Nothing left today").font(.subheadline).foregroundStyle(.secondary)
                    Spacer()
                } else {
                    let rows = Array(snap.today.prefix(maxRows))
                    ForEach(rows) { t in row(t) }
                    let more = openCount - rows.count
                    if more > 0 {
                        Text("+\(more) more").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }
            } else {
                Spacer()
                Text("Open OpenThings once to show your Today list here.")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder private func row(_ t: OTSnapshot.Item) -> some View {
        let content = HStack(spacing: 7) {
            CheckCircle()
            VStack(alignment: .leading, spacing: 0) {
                Text(t.title).font(.subheadline).lineLimit(1)
                if family == .systemLarge, let c = t.container {
                    Text(c).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if t.evening {
                Image(systemName: "moon.fill").font(.caption2).foregroundStyle(.secondary)
            }
        }
        // Small widgets support only one tap target (widgetURL); medium and large get a link per row.
        if family == .systemSmall {
            content
        } else if let url = URL(string: "openthings://task/\(t.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? t.id)") {
            Link(destination: url) { content }
        } else {
            content
        }
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: OTShared.todayWidgetKind, provider: OTProvider()) { entry in
            TodayView(entry: entry)
                .widgetURL(URL(string: "openthings://today"))
                .otWidgetBackground()
        }
        .configurationDisplayName("Today")
        .description("Your Today list from OpenThings.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}

// MARK: - Sync status widget

struct SyncView: View {
    @Environment(\.widgetFamily) private var family
    let entry: OTEntry

    var body: some View {
        if let snap = entry.snapshot {
            content(snap.sync)
        } else {
            Text("Open OpenThings once").font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private func content(_ s: OTSnapshot.Sync) -> some View {
        let last = OTShared.parseISO(s.lastSyncedAt)
        switch family {
        case .accessoryInline:
            if s.status == "idle", let last {
                Text("Synced \(last, style: .relative) ago")
            } else {
                Text(OTText.syncLabel(s))
            }
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: icon(s.status)).font(.title3)
            }
        case .accessoryRectangular:
            VStack(alignment: .leading) {
                Label(OTText.syncLabel(s), systemImage: icon(s.status)).font(.headline)
                if let last { Text(last, style: .relative).font(.caption) }
            }
        default:
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Circle().fill(OTColors.sync(s.status)).frame(width: 8, height: 8)
                    Text("Sync").font(.headline)
                }
                Text(OTText.syncLabel(s)).font(.title3.weight(.semibold)).lineLimit(2)
                if let last {
                    (Text("Last ") + Text(last, style: .relative) + Text(" ago")).font(.caption).foregroundStyle(.secondary)
                } else if s.status == "local" {
                    Text("Data stays on this device").font(.caption).foregroundStyle(.secondary)
                }
                if s.status == "error", let err = s.error {
                    Text(err).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func icon(_ status: String) -> String {
        switch status {
        case "idle": return "checkmark.icloud"
        case "pending", "syncing": return "arrow.triangle.2.circlepath.icloud"
        case "offline": return "icloud.slash"
        case "error": return "exclamationmark.icloud"
        default: return "iphone"
        }
    }
}

struct SyncWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: OTShared.syncWidgetKind, provider: OTProvider()) { entry in
            SyncView(entry: entry)
                .widgetURL(URL(string: "openthings://today"))
                .otWidgetBackground()
        }
        .configurationDisplayName("Sync status")
        .description("Whether OpenThings is synced with your server.")
        .supportedFamilies([.systemSmall, .accessoryInline, .accessoryCircular, .accessoryRectangular])
    }
}

// MARK: - Quick-add widgets

@available(iOSApplicationExtension 17.0, *)
private enum QuickAddWidgetIntent {
    static func enqueue(_ text: String, target: OTShared.Target) throws -> some IntentResult & ProvidesDialog {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .result(dialog: "Nothing to add.")
        }
        try OTShared.enqueue(text: trimmed, notes: nil, parse: true, target: target, source: "widget")
        return .result(dialog: "Added to OpenThings. It appears when you next open the app.")
    }
}

@available(iOSApplicationExtension 17.0, *)
struct VoiceAddTodoWidgetIntent: AppIntent {
    static var title: LocalizedStringResource = "Add by voice"
    static var openAppWhenRun = false

    @Parameter(title: "To-do", requestValueDialog: "Tell OpenThings what to add to your Inbox.")
    var text: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try QuickAddWidgetIntent.enqueue(text, target: .inbox)
    }
}

@available(iOSApplicationExtension 17.0, *)
struct AddInboxTodoWidgetIntent: AppIntent {
    static var title: LocalizedStringResource = "Add to Inbox"
    static var openAppWhenRun = false

    @Parameter(title: "To-do", requestValueDialog: "What do you want to add to your Inbox?")
    var text: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try QuickAddWidgetIntent.enqueue(text, target: .inbox)
    }
}

@available(iOSApplicationExtension 17.0, *)
struct AddBrainDumpTodoWidgetIntent: AppIntent {
    static var title: LocalizedStringResource = "Add to Brain Dump"
    static var openAppWhenRun = false

    @Parameter(title: "To-do", requestValueDialog: "What do you want to put in your Brain Dump?")
    var text: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try QuickAddWidgetIntent.enqueue(text, target: .dump)
    }
}

@available(iOSApplicationExtension 17.0, *)
private struct QuickAddWidgetView: View {
    let title: String
    let symbol: String
    let action: Action

    enum Action {
        case voice
        case inbox
        case dump
    }

    @ViewBuilder
    var body: some View {
        switch action {
        case .voice:
            Button(intent: VoiceAddTodoWidgetIntent()) { label }
        case .inbox:
            Button(intent: AddInboxTodoWidgetIntent()) { label }
        case .dump:
            Button(intent: AddBrainDumpTodoWidgetIntent()) { label }
        }
    }

    private var label: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 30, weight: .medium))
                .foregroundStyle(OTColors.accent)
            Text(title)
                .font(.headline)
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .otWidgetBackground()
    }
}

@available(iOSApplicationExtension 17.0, *)
private struct QuickAddActionWidget: Widget {
    let kind: String
    let title: String
    let symbol: String
    let action: QuickAddWidgetView.Action
    let description: String

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: OTProvider()) { _ in
            QuickAddWidgetView(title: title, symbol: symbol, action: action)
        }
        .configurationDisplayName(LocalizedStringKey(title))
        .description(Text(description))
        .supportedFamilies([.systemSmall])
    }
}

@available(iOSApplicationExtension 17.0, *)
private struct VoiceAddWidget: Widget {
    var body: some WidgetConfiguration {
        QuickAddActionWidget(
            kind: "OpenThingsVoiceAdd",
            title: "Add by voice",
            symbol: "waveform",
            action: .voice,
            description: "Dictate a to-do into your Inbox."
        )
    }
}

@available(iOSApplicationExtension 17.0, *)
private struct AddInboxWidget: Widget {
    var body: some WidgetConfiguration {
        QuickAddActionWidget(
            kind: "OpenThingsAddInbox",
            title: "Add to Inbox",
            symbol: "plus",
            action: .inbox,
            description: "Quickly add a to-do to your Inbox."
        )
    }
}

@available(iOSApplicationExtension 17.0, *)
private struct AddBrainDumpWidget: Widget {
    var body: some WidgetConfiguration {
        QuickAddActionWidget(
            kind: "OpenThingsAddBrainDump",
            title: "Brain Dump",
            symbol: "bolt",
            action: .dump,
            description: "Quickly add a to-do to your Brain Dump."
        )
    }
}

@main
struct OpenThingsWidgets: WidgetBundle {
    @WidgetBundleBuilder
    var body: some Widget {
        TodayWidget()
        SyncWidget()
        if #available(iOSApplicationExtension 17.0, *) {
            VoiceAddWidget()
            AddInboxWidget()
            AddBrainDumpWidget()
        }
    }
}
