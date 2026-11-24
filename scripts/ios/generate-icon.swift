import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import Foundation

// Original placeholder: two open brackets and a connection dot, no brand artwork or text.
let output = CommandLine.arguments[1]
let cg = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8,
                   bytesPerRow: 4096, space: CGColorSpaceCreateDeviceRGB(),
                   bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
cg.setFillColor(CGColor(red: 16/255, green: 24/255, blue: 39/255, alpha: 1))
cg.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
cg.setStrokeColor(CGColor(red: 130/255, green: 199/255, blue: 171/255, alpha: 1))
cg.setLineWidth(62)
cg.setLineCap(.round)
cg.setLineJoin(.round)
for points: [CGPoint] in [
    [CGPoint(x: 382, y: 724), CGPoint(x: 246, y: 724), CGPoint(x: 246, y: 300), CGPoint(x: 382, y: 300)],
    [CGPoint(x: 642, y: 724), CGPoint(x: 778, y: 724), CGPoint(x: 778, y: 300), CGPoint(x: 642, y: 300)]
] {
    cg.beginPath(); cg.addLines(between: points); cg.strokePath()
}
cg.setFillColor(CGColor(gray: 1, alpha: 1))
cg.fillEllipse(in: CGRect(x: 453, y: 453, width: 118, height: 118))
let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: output) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, cg.makeImage()!, nil)
precondition(CGImageDestinationFinalize(destination))
