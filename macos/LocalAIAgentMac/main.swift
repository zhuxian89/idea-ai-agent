import AppKit

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = MacAppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    withExtendedLifetime(delegate) { app.run() }
}
