// Shortcuts and Siri (App Intents, iOS 16+).
//
//   Add To-Do   – takes quick-add text ("Call dentist @fri %9am #phone"), queues it in the App Group,
//                 and the app imports it through the normal store (quick-add parser + op log).
//                 Runs without opening the app.
//   Open Today  – opens the app on the Today list.
//
// Both reuse the App Group channel the Share extension uses; see docs/ios.md.

import AppIntents
import Foundation

@available(iOS 16.0, *)
struct AddTodoIntent: AppIntent {
    static var title: LocalizedStringResource = "Add To-Do"
    static var description = IntentDescription(
        "Adds a to-do to OpenThings. Supports quick-add syntax such as @today, @fri, %9am, #tag, +Project and // notes."
    )
    static var openAppWhenRun = false

    @Parameter(title: "To-do", description: "Text with optional quick-add syntax", requestValueDialog: "What do you want to add?")
    var text: String

    @Parameter(title: "Brain Dump", description: "Add to the Brain Dump instead of the Inbox", default: false)
    var brainDump: Bool

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$text) to OpenThings") {
            \.$brainDump
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .result(dialog: "Nothing to add.")
        }
        try OTShared.enqueue(text: trimmed, notes: nil, parse: true, target: brainDump ? .dump : .inbox, source: "shortcut")
        return .result(dialog: "Added to OpenThings. It appears when you next open the app.")
    }
}

@available(iOS 16.0, *)
struct OpenTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Today"
    static var description = IntentDescription("Opens OpenThings on the Today list.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        // Picked up by the web app (takePending → route) on launch or immediately if it's running.
        OTShared.setRoute("openthings://today")
        return .result()
    }
}

@available(iOS 16.0, *)
struct OpenThingsShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddTodoIntent(),
            phrases: [
                "Add a to-do in \(.applicationName)",
                "Add to \(.applicationName)",
            ],
            shortTitle: "Add To-Do",
            systemImageName: "plus.circle"
        )
        AppShortcut(
            intent: OpenTodayIntent(),
            phrases: [
                "Open Today in \(.applicationName)",
                "Show my day in \(.applicationName)",
            ],
            shortTitle: "Open Today",
            systemImageName: "star"
        )
    }
}
