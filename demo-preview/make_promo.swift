import AVFoundation
import AppKit
import CoreGraphics
import CoreText
import Foundation

let outputURL = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "rakaez-promo.mov")
let size = CGSize(width: 1280, height: 720)
let fps: Int32 = 30
let duration = 30.0
let totalFrames = Int(duration * Double(fps))

try? FileManager.default.removeItem(at: outputURL)
FileManager.default.createFile(atPath: outputURL.path, contents: nil)
let output = try FileHandle(forWritingTo: outputURL)

let cs = CGColorSpaceCreateDeviceRGB()
let dark = NSColor(calibratedRed: 0.035, green: 0.035, blue: 0.039, alpha: 1).cgColor
let panel = NSColor(calibratedRed: 0.075, green: 0.072, blue: 0.078, alpha: 1).cgColor
let panel2 = NSColor(calibratedRed: 0.105, green: 0.10, blue: 0.105, alpha: 1).cgColor
let cream = NSColor(calibratedRed: 0.969, green: 0.949, blue: 0.91, alpha: 1).cgColor
let muted = NSColor(calibratedRed: 0.63, green: 0.62, blue: 0.61, alpha: 1).cgColor
let gold = NSColor(calibratedRed: 0.84, green: 0.68, blue: 0.34, alpha: 1).cgColor
let lightGold = NSColor(calibratedRed: 0.95, green: 0.82, blue: 0.54, alpha: 1).cgColor
let green = NSColor(calibratedRed: 0.32, green: 0.79, blue: 0.54, alpha: 1).cgColor

func font(_ size: CGFloat, bold: Bool = false) -> CTFont {
  let names = bold ? ["Cairo-Bold", "GeezaPro-Bold", "Arial-BoldMT"] : ["Cairo-Regular", "GeezaPro", "ArialMT"]
  for name in names {
    let candidate = CTFontCreateWithName(name as CFString, size, nil)
    if CTFontCopyPostScriptName(candidate) as String == name { return candidate }
  }
  return CTFontCreateUIFontForLanguage(.system, size, "ar" as CFString)!
}

func rounded(_ context: CGContext, _ rect: CGRect, _ radius: CGFloat, fill: CGColor, stroke: CGColor? = nil, width: CGFloat = 1) {
  let path = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
  context.addPath(path); context.setFillColor(fill); context.fillPath()
  if let stroke { context.addPath(path); context.setStrokeColor(stroke); context.setLineWidth(width); context.strokePath() }
}

func drawText(_ context: CGContext, _ text: String, _ rect: CGRect, size: CGFloat, color: CGColor = cream, bold: Bool = false, align: CTTextAlignment = .right) {
  var alignment = align
  let paragraph = withUnsafeBytes(of: &alignment) { bytes in
    CTParagraphStyleCreate([CTParagraphStyleSetting(spec: .alignment, valueSize: bytes.count, value: bytes.baseAddress!)], 1)
  }
  let attrs: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): font(size, bold: bold),
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
    NSAttributedString.Key(kCTParagraphStyleAttributeName as String): paragraph,
    .writingDirection: [NSWritingDirection.rightToLeft.rawValue | NSWritingDirectionFormatType.embedding.rawValue],
  ]
  let string = NSAttributedString(string: text, attributes: attrs)
  let framesetter = CTFramesetterCreateWithAttributedString(string)
  let path = CGPath(rect: rect, transform: nil)
  let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), path, nil)
  context.saveGState()
  context.textMatrix = .identity
  CTFrameDraw(frame, context)
  context.restoreGState()
}

func drawLogo(_ context: CGContext, center: CGPoint, scale: CGFloat = 1) {
  let box = CGRect(x: center.x - 62 * scale, y: center.y - 62 * scale, width: 124 * scale, height: 124 * scale)
  rounded(context, box, 34 * scale, fill: NSColor(calibratedRed: 0.12, green: 0.10, blue: 0.07, alpha: 1).cgColor, stroke: NSColor(calibratedRed: 0.84, green: 0.68, blue: 0.34, alpha: 0.55).cgColor, width: 1.5 * scale)
  context.saveGState()
  context.translateBy(x: center.x, y: center.y)
  context.rotate(by: .pi / 4)
  let mark = CGRect(x: -28 * scale, y: -19 * scale, width: 56 * scale, height: 56 * scale)
  context.setStrokeColor(gold); context.setLineWidth(7 * scale)
  context.stroke(mark)
  context.setFillColor(boxFill)
  context.fill(CGRect(x: -34 * scale, y: -35 * scale, width: 68 * scale, height: 26 * scale))
  context.restoreGState()
}

let boxFill = NSColor(calibratedRed: 0.12, green: 0.10, blue: 0.07, alpha: 1).cgColor

func card(_ context: CGContext, rect: CGRect, label: String, value: String, valueColor: CGColor = cream) {
  rounded(context, rect, 16, fill: panel2, stroke: NSColor.white.withAlphaComponent(0.09).cgColor)
  drawText(context, label, CGRect(x: rect.minX + 18, y: rect.minY + 16, width: rect.width - 36, height: 24), size: 13, color: muted)
  drawText(context, value, CGRect(x: rect.minX + 18, y: rect.minY + 50, width: rect.width - 36, height: 48), size: 31, color: valueColor, bold: true)
}

func drawScene(_ context: CGContext, scene: Int, localProgress: Double) {
  context.setFillColor(dark); context.fill(CGRect(origin: .zero, size: size))
  context.setStrokeColor(NSColor.white.withAlphaComponent(0.025).cgColor); context.setLineWidth(1)
  for x in stride(from: 0.0, through: Double(size.width), by: 64.0) { context.move(to: CGPoint(x: x, y: 0)); context.addLine(to: CGPoint(x: x, y: size.height)) }
  for y in stride(from: 0.0, through: Double(size.height), by: 64.0) { context.move(to: CGPoint(x: 0, y: y)); context.addLine(to: CGPoint(x: size.width, y: y)) }
  context.strokePath()
  let fade = min(1, min(localProgress / 0.14, (1 - localProgress) / 0.14))
  context.setAlpha(max(0, fade))

  switch scene {
  case 0:
    drawLogo(context, center: CGPoint(x: 850, y: 360))
    drawText(context, "ركائز", CGRect(x: 150, y: 245, width: 570, height: 110), size: 84, bold: true)
    drawText(context, "نظام إدارة قطع غيار السيارات", CGRect(x: 150, y: 360, width: 570, height: 50), size: 25, color: muted)
  case 1:
    drawText(context, "مصمم لسوق قطع الغيار السعودي", CGRect(x: 145, y: 145, width: 990, height: 35), size: 16, color: lightGold, bold: true)
    drawText(context, "كل فرع، كل قطعة،\nوكل حركة مخزون.", CGRect(x: 145, y: 210, width: 990, height: 210), size: 69, bold: true)
    drawText(context, "منصة تشغيل واحدة تربط الإدارة والفروع والمستودعات ونقاط البيع.", CGRect(x: 145, y: 465, width: 990, height: 60), size: 23, color: muted)
  case 2:
    let dash = CGRect(x: 100, y: 90, width: 1080, height: 520)
    rounded(context, dash, 26, fill: panel, stroke: NSColor(calibratedRed: 0.84, green: 0.68, blue: 0.34, alpha: 0.3).cgColor)
    drawText(context, "نظرة المخزون — جميع الفروع", CGRect(x: 140, y: 125, width: 610, height: 40), size: 25, bold: true)
    drawText(context, "●  تشغيل مباشر", CGRect(x: 800, y: 130, width: 320, height: 30), size: 14, color: green, bold: true)
    card(context, rect: CGRect(x: 140, y: 215, width: 300, height: 135), label: "قطع متوفرة", value: "18,420")
    card(context, rect: CGRect(x: 490, y: 215, width: 300, height: 135), label: "مبيعات اليوم", value: "42,780 ر.س", valueColor: lightGold)
    card(context, rect: CGRect(x: 840, y: 215, width: 300, height: 135), label: "طلبات التحويل", value: "12", valueColor: green)
    let bars = [0.38,0.54,0.45,0.66,0.60,0.82,0.94]
    for (i,h) in bars.enumerated() {
      let r = CGRect(x: 160 + CGFloat(i) * 132, y: 405, width: 70, height: CGFloat(h) * 130)
      rounded(context, r, 6, fill: gold)
    }
  case 3:
    drawText(context, "بحث ذكي في ثوانٍ", CGRect(x: 110, y: 110, width: 1060, height: 36), size: 16, color: lightGold, bold: true)
    drawText(context, "برقم القطعة، الرف، الباركود أو الهيكل.", CGRect(x: 110, y: 175, width: 1060, height: 75), size: 47, bold: true)
    rounded(context, CGRect(x: 110, y: 300, width: 1060, height: 82), 16, fill: cream)
    drawText(context, "04465-0K240", CGRect(x: 155, y: 317, width: 600, height: 46), size: 28, color: NSColor.black.cgColor, bold: true, align: .left)
    rounded(context, CGRect(x: 960, y: 312, width: 190, height: 58), 11, fill: gold)
    drawText(context, "بحث", CGRect(x: 990, y: 327, width: 130, height: 32), size: 18, color: NSColor.black.cgColor, bold: true, align: .center)
    card(context, rect: CGRect(x: 110, y: 420, width: 540, height: 145), label: "القطعة", value: "فحمات فرامل — Toyota Hilux")
    card(context, rect: CGRect(x: 675, y: 420, width: 210, height: 145), label: "موقع الرف", value: "A-03-12", valueColor: lightGold)
    card(context, rect: CGRect(x: 910, y: 420, width: 260, height: 145), label: "إجمالي المتوفر", value: "23", valueColor: green)
  case 4:
    let data = [("⌂", "مخزون الفروع", "معرفة مكان القطعة وطلب تحويلها داخل المنشأة نفسها."), ("↯", "نقطة بيع آمنة", "تسجيل الموظف والجهاز والفرع ومنع بيع غير المتوفر."), ("⇩", "استيراد جماعي", "Excel وCSV مع مراجعة الأخطاء قبل اعتماد البيانات.")]
    for (i,item) in data.enumerated() {
      let r = CGRect(x: 80 + CGFloat(i) * 405, y: 150, width: 365, height: 400)
      rounded(context, r, 22, fill: panel, stroke: NSColor.white.withAlphaComponent(0.1).cgColor)
      rounded(context, CGRect(x: r.minX + 28, y: r.minY + 28, width: 58, height: 58), 16, fill: NSColor(calibratedRed: 0.25, green: 0.20, blue: 0.10, alpha: 1).cgColor)
      drawText(context, item.0, CGRect(x: r.minX + 38, y: r.minY + 40, width: 38, height: 35), size: 25, color: lightGold, bold: true, align: .center)
      drawText(context, item.1, CGRect(x: r.minX + 28, y: r.minY + 150, width: r.width - 56, height: 50), size: 25, bold: true)
      drawText(context, item.2, CGRect(x: r.minX + 28, y: r.minY + 220, width: r.width - 56, height: 105), size: 18, color: muted)
    }
  default:
    drawText(context, "الأمان من أساس التصميم", CGRect(x: 90, y: 110, width: 700, height: 35), size: 16, color: lightGold, bold: true)
    drawText(context, "بيانات كل منشأة\nداخل نطاقها.", CGRect(x: 90, y: 170, width: 720, height: 150), size: 54, bold: true)
    let checks = ["عزل بيانات المحلات والفروع", "صلاحيات الموظفين وربط الأجهزة", "سجل تدقيق وجلسات قابلة للإلغاء"]
    for (i, check) in checks.enumerated() {
      rounded(context, CGRect(x: 90, y: 365 + CGFloat(i) * 62, width: 650, height: 48), 12, fill: panel2, stroke: NSColor.white.withAlphaComponent(0.09).cgColor)
      drawText(context, "✓", CGRect(x: 680, y: 376 + CGFloat(i) * 62, width: 30, height: 26), size: 17, color: green, bold: true, align: .center)
      drawText(context, check, CGRect(x: 125, y: 374 + CGFloat(i) * 62, width: 530, height: 30), size: 17, bold: true)
    }
    let shieldPath = CGMutablePath(); shieldPath.move(to: CGPoint(x: 980, y: 145)); shieldPath.addLine(to: CGPoint(x: 1125, y: 195)); shieldPath.addLine(to: CGPoint(x: 1100, y: 440)); shieldPath.addLine(to: CGPoint(x: 980, y: 545)); shieldPath.addLine(to: CGPoint(x: 860, y: 440)); shieldPath.addLine(to: CGPoint(x: 835, y: 195)); shieldPath.closeSubpath()
    context.addPath(shieldPath); context.setFillColor(gold); context.fillPath()
    drawText(context, "✓", CGRect(x: 885, y: 285, width: 190, height: 120), size: 84, color: NSColor.black.cgColor, bold: true, align: .center)
  }
  context.setAlpha(1)
  drawText(context, "RAKAEZ ERP · LOCAL DEMO", CGRect(x: 42, y: 678, width: 380, height: 22), size: 10, color: NSColor.white.withAlphaComponent(0.34).cgColor, bold: true, align: .left)
  drawText(context, "بيانات تجريبية · غير منشور", CGRect(x: 850, y: 678, width: 390, height: 22), size: 11, color: NSColor.white.withAlphaComponent(0.34).cgColor, bold: true)
}

for frame in 0..<totalFrames {
  autoreleasepool {
    let bytesPerRow = Int(size.width) * 4
    var frameBytes = Data(count: bytesPerRow * Int(size.height))
    frameBytes.withUnsafeMutableBytes { raw in
      let context = CGContext(data: raw.baseAddress!, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8, bytesPerRow: bytesPerRow, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
    let time = Double(frame) / Double(fps)
    let scene = min(5, Int(time / 5.0))
    let local = (time - Double(scene) * 5.0) / 5.0
    drawScene(context, scene: scene, localProgress: local)
    let progress = CGRect(x: 0, y: 0, width: CGFloat(time / duration) * size.width, height: 4)
    context.setFillColor(gold); context.fill(progress)
    }
    try! output.write(contentsOf: frameBytes)
  }
}
try output.close()
print(outputURL.path)
