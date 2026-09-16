// mov2gif — turn a screen recording into an animated GIF using only what macOS already ships.
// AVFoundation samples the frames, ImageIO writes the GIF. No ffmpeg, no install.
//
// usage: swift mov2gif.swift <in.mov> <out.gif> <width> <fps> <start> <duration> <cropTopFrac>
//
// Note: AVFoundation cannot decode a file sitting in ~/Desktop or ~/Documents from a terminal
// without Full Disk Access — every frame fails with OSStatus -17913. Copy the file elsewhere first.

import AVFoundation
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let a = CommandLine.arguments
guard a.count >= 8, let width = Double(a[3]), let fps = Double(a[4]),
      let start = Double(a[5]), let dur = Double(a[6]), let cropTop = Double(a[7]) else {
    FileHandle.standardError.write("usage: mov2gif <in> <out> <width> <fps> <start> <dur> <cropTopFrac>\n".data(using: .utf8)!)
    exit(2)
}
let asset = AVURLAsset(url: URL(fileURLWithPath: a[1]))
let dst = URL(fileURLWithPath: a[2])

let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero   // else frames snap to keyframes and the motion judders
gen.requestedTimeToleranceAfter = .zero

// Sample at native size and crop first; scaling before the crop would waste pixels on the chrome
// we are about to throw away.
var natural = CGSize(width: 1920, height: 1080)
if let t = asset.tracks(withMediaType: .video).first {
    let n = t.naturalSize.applying(t.preferredTransform)
    natural = CGSize(width: abs(n.width), height: abs(n.height))
}
let cropPx = (natural.height * cropTop).rounded()
let cropped = CGSize(width: natural.width, height: natural.height - cropPx)
let scale = width / cropped.width
let outH = (cropped.height * scale).rounded()
print("source \(Int(natural.width))x\(Int(natural.height)) → crop \(Int(cropPx))px → \(Int(width))x\(Int(outH))")

let frames = max(1, Int(dur * fps))
guard let out = CGImageDestinationCreateWithURL(
    dst as CFURL, UTType.gif.identifier as CFString, frames, nil) else { exit(1) }
CGImageDestinationSetProperties(out, [
    kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]
] as CFDictionary)

let ctx = CGColorSpaceCreateDeviceRGB()
var written = 0
for i in 0..<frames {
    let t = CMTime(seconds: start + Double(i) / fps, preferredTimescale: 600)
    guard let full = try? gen.copyCGImage(at: t, actualTime: nil) else { continue }
    let rect = CGRect(x: 0, y: Int(cropPx), width: full.width, height: full.height - Int(cropPx))
    guard let cut = full.cropping(to: rect),
          let bmp = CGContext(data: nil, width: Int(width), height: Int(outH), bitsPerComponent: 8,
                              bytesPerRow: 0, space: ctx,
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { continue }
    bmp.interpolationQuality = .high
    bmp.draw(cut, in: CGRect(x: 0, y: 0, width: width, height: outH))
    guard let scaled = bmp.makeImage() else { continue }
    CGImageDestinationAddImage(out, scaled, [
        kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFUnclampedDelayTime: 1.0 / fps]
    ] as CFDictionary)
    written += 1
}
guard CGImageDestinationFinalize(out) else {
    FileHandle.standardError.write("failed to finalize\n".data(using: .utf8)!); exit(1)
}
let bytes = (try? FileManager.default.attributesOfItem(atPath: dst.path)[.size] as? Int) ?? 0
print("\(written) frames · \(String(format: "%.1f", dur))s · \((bytes ?? 0)/1024) KB → \(dst.lastPathComponent)")
