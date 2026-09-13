import org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask
import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.JvmDefaultMode
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    kotlin("jvm") version "2.2.20"
    id("org.jetbrains.intellij.platform") version "2.18.1"
}

group = "dev.ideaagent"
version = "0.1.1"

repositories {
    mavenCentral()
    intellijPlatform { defaultRepositories() }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity(providers.gradleProperty("platformVersion"))
        pluginVerifier()
    }
    testImplementation("junit:junit:4.13.2")
}

// Gradle runs on JDK 21, while IDEA 2024.1 runs the plugin on Java 17.
kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget = JvmTarget.JVM_17
        languageVersion = KotlinVersion.KOTLIN_1_9
        apiVersion = KotlinVersion.KOTLIN_1_9
        // Inherit platform defaults without generating delegates to internal ToolWindowFactory methods.
        jvmDefault = JvmDefaultMode.NO_COMPATIBILITY
        freeCompilerArgs.add("-Xjdk-release=17")
    }
}
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
tasks.withType<JavaCompile>().configureEach { options.release = 17 }
tasks.withType<KotlinCompile>().configureEach {
    compilerOptions.jvmTarget = JvmTarget.JVM_17
}

intellijPlatform {
    pluginConfiguration {
        id = "dev.ideaagent.local"
        name = "Local AI Agent"
        version = project.version.toString()
        ideaVersion { sinceBuild = "241" }
        vendor { name = "Local AI Agent" }
    }
    pluginVerification {
        ides {
            current()
            create(IntelliJPlatformType.IntellijIdeaCommunity, "2024.2")
            create(IntelliJPlatformType.IntellijIdeaCommunity, "2024.3")
            create(IntelliJPlatformType.IntellijIdeaUltimate, "2024.1")
            create(IntelliJPlatformType.IntellijIdeaUltimate, "2024.2")
            create(IntelliJPlatformType.IntellijIdeaUltimate, "2024.3")
        }
    }
}

val buildRuntime by tasks.registering(Exec::class) {
    workingDir = projectDir
    commandLine("node", "scripts/build-runtime.mjs")
    inputs.dir("runtime/server")
    inputs.dir("runtime/web/src")
    inputs.dir("runtime/web/public")
    inputs.files("runtime/go.mod", "runtime/go.sum", "runtime/agents.json", "runtime/task_template.json",
        "runtime/LICENSE", "scripts/build-runtime.mjs", "runtime/web/tsconfig.json", "runtime/web/pnpm-workspace.yaml",
        "runtime/web/package.json", "runtime/web/pnpm-lock.yaml", "runtime/web/index.html", "runtime/web/vite.config.ts")
    inputs.property("targetOS", providers.environmentVariable("GOOS").orElse(System.getProperty("os.name")))
    inputs.property("targetArch", providers.environmentVariable("GOARCH").orElse(System.getProperty("os.arch")))
    outputs.dir(layout.buildDirectory.dir("local-runtime"))
}

tasks.withType<PrepareSandboxTask>().configureEach {
    dependsOn(buildRuntime)
    from(layout.buildDirectory.dir("local-runtime")) { into("${rootProject.name}/runtime") }
    from(files("LICENSE", "NOTICE.md")) { into(rootProject.name) }
}
