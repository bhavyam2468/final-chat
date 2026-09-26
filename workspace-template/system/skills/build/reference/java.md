# Java with Gradle
JDK 21 + Gradle. Install via SDKMAN: `curl -s "https://get.sdkman.io" | bash`, `source ~/.sdkman/bin/sdkman-init.sh`, `sdk install java 21.0.5-tem` (list: `sdk list java`), `sdk install gradle`. Or `brew install openjdk@21 gradle`. Check `java -version`, `gradle -v`.

Scaffold (non-interactive):
```bash
mkdir -p ~/projects/<name> && cd ~/projects/<name>
gradle init --type java-application --dsl kotlin --test-framework junit-jupiter \
  --project-name <name> --package com.example.<name> --no-split-project --java-version 21 --no-incubating
```
If a flag is rejected (older Gradle), run `gradle help --task init` and drop it.
Result: app/src/main/java/com/example/<name>/App.java, app/build.gradle.kts, gradlew (use ./gradlew from now on).
Run: `./gradlew run --args="x y"` · tests: `./gradlew test` · build: `./gradlew build` · fat jar: add the Shadow plugin or use `./gradlew installDist` → app/build/install/app/bin/app.
Dependencies (app/build.gradle.kts):
```kotlin
dependencies {
    implementation("com.google.code.gson:gson:2.11.0")
    testImplementation(libs.junit.jupiter)
}
```
(The version catalog is gradle/libs.versions.toml; add entries there if the project uses it.)
Web server without frameworks: `com.sun.net.httpserver.HttpServer.create(new InetSocketAddress(8080), 0)`. With Spring Boot: generate via `curl https://start.spring.io/starter.zip -d type=gradle-project-kotlin -d language=java -d javaVersion=21 -d dependencies=web -d name=<name> -o <name>.zip && unzip <name>.zip -d <name>`, run `./gradlew bootRun` with proc_start.
Maven instead: `mvn archetype:generate -DgroupId=com.example -DartifactId=<name> -DarchetypeArtifactId=maven-archetype-quickstart -DinteractiveMode=false`.
