import UIKit

enum ExternalLinks {
    static func open(_ url: URL, completion: ((Bool) -> Void)? = nil) {
        Diagnostics.record("external \(url.absoluteString)")
        UIApplication.shared.open(url, options: [:], completionHandler: completion)
    }
}
