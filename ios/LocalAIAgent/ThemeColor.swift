import UIKit

struct ThemeColor {
    let red: Double
    let green: Double
    let blue: Double

    init?(hex: String) {
        let value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.hasPrefix("#") else { return nil }
        var digits = String(value.dropFirst())
        if digits.count == 3 { digits = digits.map { "\($0)\($0)" }.joined() }
        guard digits.count == 6, digits.allSatisfy({ $0.isHexDigit }), let number = UInt32(digits, radix: 16) else { return nil }
        red = Double((number >> 16) & 255) / 255
        green = Double((number >> 8) & 255) / 255
        blue = Double(number & 255) / 255
    }

    var luminance: Double {
        func linear(_ component: Double) -> Double {
            component <= 0.04045 ? component / 12.92 : pow((component + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }
    // Choose whichever foreground has greater WCAG contrast against the page chrome.
    var lightStatusBar: Bool { luminance < 0.179 }
    var uiColor: UIColor { UIColor(red: red, green: green, blue: blue, alpha: 1) }
    static let initial = ThemeColor(hex: "#101827")!
}
