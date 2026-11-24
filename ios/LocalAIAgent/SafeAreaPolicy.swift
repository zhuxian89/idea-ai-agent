import UIKit

/// Whether a page lays itself out under the status bar and home indicator.
///
/// The node app declares `viewport-fit=cover` and pads itself with
/// `env(safe-area-inset-*)`; the Relay's own pages (login, nodes, bind) do not,
/// so the shell must inset them or their header would sit under the status bar.
enum SafeAreaPolicy {
    /// Best guess before the page has loaded: node pages live under `/n/`.
    static func extendsUnderSafeArea(url: URL?) -> Bool {
        guard let path = url?.path else { return true }
        return path == "/n" || path.hasPrefix("/n/")
    }

    /// Script whose result is the page's own answer, valid once `<head>` is parsed.
    static let declaresCoverScript =
        "(document.querySelector('meta[name=\"viewport\"]')?.content || '').replace(/\\s/g, '').includes('viewport-fit=cover')"

    static func behavior(extendsUnderSafeArea: Bool) -> UIScrollView.ContentInsetAdjustmentBehavior {
        extendsUnderSafeArea ? .never : .always
    }

    /// Same payload the Android shell sends: the variables the web layout reads, then the event it listens for.
    static func publishScript(top: CGFloat, bottom: CGFloat) -> String {
        func px(_ value: CGFloat) -> String { String(format: "%.2fpx", max(0, Double(value))) }
        return "(function(){var s=document&&document.documentElement&&document.documentElement.style;if(!s){return;}"
            + "s.setProperty('--mindfs-safe-area-top','\(px(top))');s.setProperty('--mindfs-safe-area-bottom','\(px(bottom))');"
            + "window.dispatchEvent(new CustomEvent('mindfs:safe-area-updated'));})();"
    }
}
