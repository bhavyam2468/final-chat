---
name: android
description: Android app work. Read the project before editing. Phone tools only when Phone testing is on.
---
Read the project before you write a line. The structure that is already there wins.

- Language and UI toolkit come from the files: Kotlin or Java, Compose or XML. Do not convert unless asked.
- Package name comes from AndroidManifest.xml, not a guess.
- Code lives under src/main/java or src/main/kotlin, in that package. Layouts live in res/layout. Do not invent a second tree.
- Dependencies come from the existing Gradle files. Do not add a library you have not seen in the project or confirmed with web_search. Do not invent an SDK method. If you are not sure a class exists, search the project, then the web.
- A small change stays a small change. Do not rewrite the app to fix one screen.
- To run it, Phone testing must be on (Settings → Access) and Host terminal on. adb_devices, then adb_install, adb_launch, adb_shot, adb_logcat. Read the screenshot before tapping. adb_shell is the device, not the computer.
- If Phone testing is off, say so. Do not bury adb inside host_shell.
