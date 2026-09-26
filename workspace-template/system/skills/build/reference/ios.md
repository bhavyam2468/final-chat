# iOS (SwiftUI) — macOS with Xcode only
Check: `sw_vers`, `xcodebuild -version` (full Xcode, not only CLT: `xcode-select -p` should point into Xcode.app), `command -v xcodegen` (install: `brew install xcodegen`). Not available on Linux/Windows: say so and offer a web app or Flutter instead.

## Project (XcodeGen keeps the project as text; no .pbxproj editing)
```bash
mkdir -p ~/projects/<Name>/Sources && cd ~/projects/<Name>
```
project.yml
```yaml
name: <Name>
options:
  bundleIdPrefix: com.example
  deploymentTarget:
    iOS: "17.0"
targets:
  <Name>:
    type: application
    platform: iOS
    sources: [Sources]
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.example.<name>
        GENERATE_INFOPLIST_FILE: YES
        INFOPLIST_KEY_UILaunchScreen_Generation: YES
        INFOPLIST_KEY_CFBundleDisplayName: <Name>
        MARKETING_VERSION: "1.0"
        CURRENT_PROJECT_VERSION: "1"
        SWIFT_VERSION: "5.0"
```
Sources/<Name>App.swift
```swift
import SwiftUI

@main
struct NameApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}
```
Sources/ContentView.swift
```swift
import SwiftUI

struct ContentView: View {
    @State private var items: [String] = []
    @State private var draft = ""
    var body: some View {
        NavigationStack {
            List {
                HStack {
                    TextField("New item", text: $draft)
                    Button("Add") { if !draft.isEmpty { items.append(draft); draft = "" } }
                }
                ForEach(items, id: \.self) { Text($0) }.onDelete { items.remove(atOffsets: $0) }
            }
            .navigationTitle("Items")
        }
    }
}
```
Generate: `xcodegen generate` (re-run after adding files or changing project.yml).

## Build, run, look (simulator; no signing needed)
```bash
xcrun simctl list devices available | grep -E "iPhone" | head -5      # pick an existing name
xcodebuild -project <Name>.xcodeproj -scheme <Name> -destination 'platform=iOS Simulator,name=iPhone 16' -derivedDataPath build -quiet build
xcrun simctl boot "iPhone 16" 2>/dev/null; open -a Simulator
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/<Name>.app
xcrun simctl launch booted com.example.<name>
sleep 2 && xcrun simctl io booted screenshot /tmp/ios.png   # copy into the workspace, then view_image
```
Logs: `xcrun simctl spawn booted log stream --predicate 'process == "<Name>"' --style compact` (run with proc_start, read with proc_logs).
Tests: add a `<Name>Tests` target (type: bundle.unit-test, dependencies: [target: <Name>]) and `xcodebuild test -scheme <Name> -destination '…'`.
Persistence: SwiftData (`@Model`, `.modelContainer(for:)`, iOS 17+) or `@AppStorage` for small settings.
Device install/App Store needs an Apple developer team (DEVELOPMENT_TEAM) and signing: ask the user; never change their signing setup silently.
Errors: "Unable to find a destination" → use a device name from simctl list; "No such module" → the file is outside Sources or xcodegen not re-run.
