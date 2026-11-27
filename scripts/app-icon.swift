// Renders the app icons from docs/design/app-icon-source.jpeg (2048 × 2048):
//   swift scripts/app-icon.swift docs/design/app-icon-source.jpeg \
//     packages/ios/Docketeer/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png packages/app/build/icon.png
// The iOS icon is full-bleed and opaque (iOS rounds the corners; App Store icons have no alpha). The desktop icon
// is an 896 px rounded square with a soft shadow on a 1024 px transparent canvas. An optional fourth argument
// "x,y,size" sets the square crop of the source (top-left origin).
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
let a = CommandLine.arguments
let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, nil)!
let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
// Square crop around the nib-rocket, tight enough that it reads at 16–32 px
let n = a.count > 4 ? a[4].split(separator: ",").map { Double($0)! } : [398, 401, 1250]
let crop = img.cropping(to: CGRect(x: n[0], y: n[1], width: n[2], height: n[2]))!
func write(_ ctx: CGContext, _ path: String) {
	let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)!
	CGImageDestinationAddImage(dest, ctx.makeImage()!, nil); CGImageDestinationFinalize(dest)
}
let cs = CGColorSpace(name: CGColorSpace.sRGB)!
// iOS: full-bleed, opaque
let ios = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
ios.interpolationQuality = .high
ios.draw(crop, in: CGRect(x: 0, y: 0, width: 1024, height: 1024))
write(ios, a[2])
// Desktop: 896px rounded square on a 1024 transparent canvas, like the old icon
let d = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
d.interpolationQuality = .high
let r = CGRect(x: 64, y: 64, width: 896, height: 896)
d.saveGState()
d.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: CGColor(gray: 0, alpha: 0.35))
d.addPath(CGPath(roundedRect: r, cornerWidth: 200, cornerHeight: 200, transform: nil)); d.setFillColor(CGColor(gray: 0, alpha: 1)); d.fillPath()
d.restoreGState()
d.addPath(CGPath(roundedRect: r, cornerWidth: 200, cornerHeight: 200, transform: nil)); d.clip()
d.draw(crop, in: r)
write(d, a[3])
