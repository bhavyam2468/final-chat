# Android (Kotlin + Jetpack Compose, no Android Studio)
Known-good pinned set (works together; change only if the user asks for newer):
JDK 17 · Gradle 8.11.1 · Android Gradle Plugin 8.7.3 · Kotlin 2.1.0 · compileSdk/targetSdk 35 · minSdk 24 · Compose BOM 2024.12.01 · build-tools 35.0.0

## 1. SDK (skip parts that exist: `echo $ANDROID_HOME; ls ~/Android/Sdk ~/Library/Android/sdk 2>/dev/null; command -v adb sdkmanager`)
JDK 17: `sdk install java 17.0.13-tem` (SDKMAN) or `sudo apt install openjdk-17-jdk` or `brew install openjdk@17`.
```bash
export ANDROID_HOME=$HOME/Android/Sdk          # macOS convention: $HOME/Library/Android/sdk
mkdir -p $ANDROID_HOME/cmdline-tools && cd /tmp
curl -fLo clt.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip   # mac: commandlinetools-mac-11076708_latest.zip
unzip -q -o clt.zip -d $ANDROID_HOME/cmdline-tools && rm -rf $ANDROID_HOME/cmdline-tools/latest && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
yes | sdkmanager --licenses >/dev/null
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```
If the zip URL 404s: web_fetch https://developer.android.com/studio (section "Command line tools only") for the current file name.
Persist env: append the two export lines to ~/.bashrc or ~/.zshrc (tell the user).

## 2. Gradle wrapper (needs a Gradle once)
```bash
cd /tmp && curl -fLo gradle.zip https://services.gradle.org/distributions/gradle-8.11.1-bin.zip && unzip -q -o gradle.zip -d $HOME/.local
mkdir -p ~/projects/<name> && cd ~/projects/<name>
$HOME/.local/gradle-8.11.1/bin/gradle wrapper --gradle-version 8.11.1
```

## 3. Project files (write exactly; package com.example.<name> → replace everywhere)
settings.gradle.kts
```kotlin
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositories { google(); mavenCentral() } }
rootProject.name = "<name>"
include(":app")
```
build.gradle.kts (root)
```kotlin
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.0" apply false
}
```
gradle.properties
```
org.gradle.jvmargs=-Xmx2g
android.useAndroidX=true
kotlin.code.style=official
```
local.properties (not committed): `sdk.dir=/home/<user>/Android/Sdk` (absolute path of $ANDROID_HOME)
app/build.gradle.kts
```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "com.example.<name>"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.example.<name>"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }
    buildTypes { release { isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
}
dependencies {
    val bom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(bom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
```
app/src/main/AndroidManifest.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="<Name>" android:theme="@android:style/Theme.Material.Light.NoActionBar">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```
(Internet access: add `<uses-permission android:name="android.permission.INTERNET" />` above <application>.)
app/src/main/java/com/example/<name>/MainActivity.kt
```kotlin
package com.example.<name>

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { MaterialTheme { Surface(Modifier.fillMaxSize()) { App() } } }
    }
}

@Composable
fun App() {
    var count by remember { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Count: $count", style = MaterialTheme.typography.titleLarge)
        Button(onClick = { count++ }) { Text("Add") }
    }
}
```
.gitignore: `.gradle/ build/ app/build/ local.properties *.apk`

## 4. Build, install, look
```bash
./gradlew assembleDebug          # → app/build/outputs/apk/debug/app-debug.apk (first run downloads ~500 MB; timeout 1200)
adb devices                      # phone with USB debugging, or an emulator
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.example.<name>/.MainActivity
adb exec-out screencap -p > /tmp/screen.png   # then copy into the workspace and view_image
adb logcat -d -s AndroidRuntime:E | tail -40  # crashes
```
Emulator (optional, heavy): `sdkmanager "emulator" "system-images;android-35;google_apis;x86_64"`, `avdmanager create avd -n dev -k "system-images;android-35;google_apis;x86_64" -d pixel_7`, proc_start(host=true, command="$ANDROID_HOME/emulator/emulator -avd dev -no-snapshot -no-audio"); wait until `adb shell getprop sys.boot_completed` prints 1.
Checks: check(path) runs `./gradlew -q assembleDebug`. Tests: `./gradlew testDebugUnitTest`. Lint: `./gradlew lintDebug`.
Errors: "SDK location not found" → local.properties; "requires Java 17" → JAVA_HOME to JDK 17; Compose compiler errors → keep Kotlin and the compose plugin on the same version; unresolved androidx.* → dependency missing in app/build.gradle.kts.
Release APK/AAB needs a keystore: `keytool -genkeypair -v -keystore release.jks -alias app -keyalg RSA -keysize 2048 -validity 10000` + signingConfigs; ask before creating signing keys.

## Project rules (before writing a line)
- Read what is there: Kotlin or Java, Compose or XML come from the files — never convert unless asked. Package name from AndroidManifest.xml, code under src/main/java|kotlin in that package, layouts in res/layout. Do not invent a second tree.
- Dependencies come from the Gradle files. Do not add a library you have not seen in the project or confirmed with web_search; if unsure a class exists, search the project, then the web.
- A small change stays a small change — never rewrite the app to fix one screen.
- Running it needs Phone testing (Settings → Access) and Host terminal: adb_devices → adb_install → adb_launch → adb_shot → read the screenshot before adb_tap → adb_logcat for crashes. adb_shell targets the device, not the computer. If Phone testing is off, say so instead of burying adb inside host_shell.
