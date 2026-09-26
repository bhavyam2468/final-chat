# Flutter
Install: https://docs.flutter.dev/get-started/install (git clone -b stable https://github.com/flutter/flutter.git ~/flutter; add ~/flutter/bin to PATH). Run `flutter doctor` and fix what it reports (Android SDK: reference/android.md; iOS: Xcode on macOS).

```bash
cd ~/projects && flutter create --org com.example --platforms=android,ios,web,linux <name> && cd <name>
```
Entry: lib/main.dart (replace the counter demo). Run web for fast UI checks: proc_start(command="flutter run -d web-server --web-port 8080 --web-hostname 0.0.0.0") → browser("http://localhost:8080") (first compile is slow; wait_for="port", timeout=240).
Builds: `flutter build apk --debug` → build/app/outputs/flutter-apk/app-debug.apk · `flutter build web` → build/web · `flutter build ios --simulator` (macOS).
Packages: `flutter pub add http provider`. Tests: `flutter test`. Analyze: `flutter analyze`.
State: StatefulWidget/setState for small apps; provider or riverpod when shared.
