import AppKit
import CoreGraphics
import CoreText
import Foundation

let canvas = CGSize(width: 1280, height: 720)
let fps: Int32 = 30
let sceneDuration = 9.0
let sceneCount = 10
let duration = sceneDuration * Double(sceneCount)
let totalFrames = Int(duration * Double(fps))
let output = FileHandle.standardOutput
let colorSpace = CGColorSpaceCreateDeviceRGB()

let ink = NSColor(calibratedRed: 0.025, green: 0.027, blue: 0.031, alpha: 1).cgColor
let inkSoft = NSColor(calibratedRed: 0.043, green: 0.046, blue: 0.053, alpha: 1).cgColor
let surface = NSColor(calibratedRed: 0.078, green: 0.080, blue: 0.090, alpha: 1).cgColor
let surfaceHigh = NSColor(calibratedRed: 0.105, green: 0.107, blue: 0.119, alpha: 1).cgColor
let cream = NSColor(calibratedRed: 0.973, green: 0.953, blue: 0.918, alpha: 1).cgColor
let muted = NSColor(calibratedRed: 0.61, green: 0.61, blue: 0.64, alpha: 1).cgColor
let dimmed = NSColor(calibratedRed: 0.38, green: 0.39, blue: 0.43, alpha: 1).cgColor
let gold = NSColor(calibratedRed: 0.86, green: 0.68, blue: 0.31, alpha: 1).cgColor
let goldBright = NSColor(calibratedRed: 0.98, green: 0.84, blue: 0.54, alpha: 1).cgColor
let green = NSColor(calibratedRed: 0.30, green: 0.82, blue: 0.56, alpha: 1).cgColor
let blue = NSColor(calibratedRed: 0.35, green: 0.62, blue: 0.98, alpha: 1).cgColor
let red = NSColor(calibratedRed: 0.95, green: 0.36, blue: 0.36, alpha: 1).cgColor
let border = NSColor.white.withAlphaComponent(0.095).cgColor

func font(_ pointSize: CGFloat, bold: Bool = false) -> CTFont {
  let names = bold
    ? ["Cairo-Bold", "GeezaPro-Bold", "SFArabic-Bold", "Arial-BoldMT"]
    : ["Cairo-Regular", "GeezaPro", "SFArabic-Regular", "ArialMT"]
  for name in names {
    let candidate = CTFontCreateWithName(name as CFString, pointSize, nil)
    if CTFontCopyPostScriptName(candidate) as String == name { return candidate }
  }
  return CTFontCreateUIFontForLanguage(.system, pointSize, "ar" as CFString)!
}

func rounded(_ context: CGContext, _ rect: CGRect, _ radius: CGFloat, fill: CGColor, stroke: CGColor? = nil, width: CGFloat = 1) {
  let path = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
  context.addPath(path)
  context.setFillColor(fill)
  context.fillPath()
  if let stroke {
    context.addPath(path)
    context.setStrokeColor(stroke)
    context.setLineWidth(width)
    context.strokePath()
  }
}

func line(_ context: CGContext, from: CGPoint, to: CGPoint, color: CGColor, width: CGFloat = 1) {
  context.setStrokeColor(color)
  context.setLineWidth(width)
  context.move(to: from)
  context.addLine(to: to)
  context.strokePath()
}

func drawText(
  _ context: CGContext,
  _ text: String,
  _ rect: CGRect,
  size: CGFloat,
  color: CGColor = cream,
  bold: Bool = false,
  align: CTTextAlignment = .right,
  rtl: Bool = true
) {
  var alignment = align
  let paragraph = withUnsafeBytes(of: &alignment) { bytes in
    CTParagraphStyleCreate([
      CTParagraphStyleSetting(spec: .alignment, valueSize: bytes.count, value: bytes.baseAddress!)
    ], 1)
  }
  var attributes: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): font(size, bold: bold),
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
    NSAttributedString.Key(kCTParagraphStyleAttributeName as String): paragraph,
  ]
  if rtl {
    attributes[.writingDirection] = [NSWritingDirection.rightToLeft.rawValue | NSWritingDirectionFormatType.embedding.rawValue]
  }
  let attributed = NSAttributedString(string: text, attributes: attributes)
  let framesetter = CTFramesetterCreateWithAttributedString(attributed)
  let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), CGPath(rect: rect, transform: nil), nil)
  context.saveGState()
  context.textMatrix = .identity
  CTFrameDraw(frame, context)
  context.restoreGState()
}

func ease(_ value: Double) -> CGFloat {
  let t = max(0, min(1, value))
  return CGFloat(t * t * (3 - 2 * t))
}

func reveal(_ local: Double, delay: Double = 0, span: Double = 0.22) -> CGFloat {
  ease((local - delay) / span)
}

func drawBackground(_ context: CGContext, scene: Int, time: Double) {
  let colors = [ink, inkSoft] as CFArray
  let gradient = CGGradient(colorsSpace: colorSpace, colors: colors, locations: [0, 1])!
  context.drawLinearGradient(gradient, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 1280, y: 720), options: [])

  context.setStrokeColor(NSColor.white.withAlphaComponent(0.022).cgColor)
  context.setLineWidth(1)
  let offset = CGFloat(time.truncatingRemainder(dividingBy: 64)) * 0.08
  for x in stride(from: -64.0 + Double(offset), through: 1344.0, by: 64.0) {
    context.move(to: CGPoint(x: x, y: 0)); context.addLine(to: CGPoint(x: x, y: 720))
  }
  for y in stride(from: -64.0 + Double(offset), through: 784.0, by: 64.0) {
    context.move(to: CGPoint(x: 0, y: y)); context.addLine(to: CGPoint(x: 1280, y: y))
  }
  context.strokePath()

  let glowCenter = CGPoint(x: scene % 2 == 0 ? 970 : 280, y: 440)
  let glowColors = [NSColor(calibratedRed: 0.86, green: 0.68, blue: 0.31, alpha: 0.16).cgColor, NSColor.clear.cgColor] as CFArray
  let glow = CGGradient(colorsSpace: colorSpace, colors: glowColors, locations: [0, 1])!
  context.drawRadialGradient(glow, startCenter: glowCenter, startRadius: 0, endCenter: glowCenter, endRadius: 430, options: [])
}

func drawLogo(_ context: CGContext, center: CGPoint, scale: CGFloat = 1, wordmark: Bool = false) {
  let boxFill = NSColor(calibratedRed: 0.13, green: 0.11, blue: 0.065, alpha: 1).cgColor
  let box = CGRect(x: center.x - 58 * scale, y: center.y - 58 * scale, width: 116 * scale, height: 116 * scale)
  rounded(context, box, 31 * scale, fill: boxFill, stroke: NSColor(calibratedRed: 0.86, green: 0.68, blue: 0.31, alpha: 0.55).cgColor, width: 1.3 * scale)
  context.saveGState()
  context.translateBy(x: center.x, y: center.y)
  context.rotate(by: .pi / 4)
  context.setStrokeColor(gold)
  context.setLineWidth(7 * scale)
  context.stroke(CGRect(x: -27 * scale, y: -19 * scale, width: 54 * scale, height: 54 * scale))
  context.setFillColor(boxFill)
  context.fill(CGRect(x: -34 * scale, y: -34 * scale, width: 68 * scale, height: 25 * scale))
  context.restoreGState()
  if wordmark {
    drawText(context, "ركائز", CGRect(x: center.x - 190, y: center.y - 26, width: 110, height: 48), size: 30, bold: true)
  }
}

func topBar(_ context: CGContext, scene: Int) {
  drawLogo(context, center: CGPoint(x: 1198, y: 57), scale: 0.28)
  drawText(context, "ركائز", CGRect(x: 1055, y: 38, width: 100, height: 35), size: 19, bold: true)
  drawText(context, "RAKAEZ ERP", CGRect(x: 48, y: 44, width: 230, height: 25), size: 11, color: muted, bold: true, align: .left, rtl: false)
  drawText(context, String(format: "%02d / %02d", scene + 1, sceneCount), CGRect(x: 282, y: 44, width: 90, height: 25), size: 11, color: dimmed, bold: true, align: .left, rtl: false)
  line(context, from: CGPoint(x: 48, y: 88), to: CGPoint(x: 1232, y: 88), color: border)
}

func badge(_ context: CGContext, text: String, rect: CGRect, tint: CGColor = goldBright) {
  rounded(context, rect, rect.height / 2, fill: NSColor.white.withAlphaComponent(0.045).cgColor, stroke: NSColor.white.withAlphaComponent(0.09).cgColor)
  rounded(context, CGRect(x: rect.maxX - 25, y: rect.midY - 4, width: 8, height: 8), 4, fill: tint)
  drawText(context, text, CGRect(x: rect.minX + 15, y: rect.minY + 8, width: rect.width - 48, height: rect.height - 13), size: 12, color: tint, bold: true)
}

func metric(_ context: CGContext, rect: CGRect, label: String, value: String, trend: String, tint: CGColor = cream) {
  rounded(context, rect, 18, fill: surface, stroke: border)
  drawText(context, label, CGRect(x: rect.minX + 20, y: rect.minY + 18, width: rect.width - 40, height: 25), size: 13, color: muted)
  drawText(context, value, CGRect(x: rect.minX + 20, y: rect.minY + 57, width: rect.width - 40, height: 49), size: 29, color: tint, bold: true)
  drawText(context, trend, CGRect(x: rect.minX + 20, y: rect.maxY - 39, width: rect.width - 40, height: 22), size: 11, color: green, bold: true)
}

func tableRow(_ context: CGContext, y: CGFloat, columns: [String], widths: [CGFloat], statusColor: CGColor? = nil) {
  rounded(context, CGRect(x: 92, y: y, width: 1096, height: 54), 10, fill: NSColor.white.withAlphaComponent(0.025).cgColor, stroke: NSColor.white.withAlphaComponent(0.055).cgColor)
  var x: CGFloat = 113
  for (index, column) in columns.enumerated() {
    if index == columns.count - 1, let statusColor {
      rounded(context, CGRect(x: x + 8, y: y + 13, width: widths[index] - 26, height: 28), 14, fill: NSColor(cgColor: statusColor)!.withAlphaComponent(0.12).cgColor)
      drawText(context, column, CGRect(x: x + 13, y: y + 18, width: widths[index] - 36, height: 20), size: 11, color: statusColor, bold: true, align: .center)
    } else {
      drawText(context, column, CGRect(x: x, y: y + 16, width: widths[index] - 12, height: 24), size: 13, color: index == 0 ? cream : muted, bold: index == 0)
    }
    x += widths[index]
  }
}

func headline(_ context: CGContext, eyebrow: String, title: String, subtitle: String? = nil) {
  drawText(context, eyebrow, CGRect(x: 80, y: 120, width: 1120, height: 28), size: 13, color: goldBright, bold: true)
  drawText(context, title, CGRect(x: 80, y: 165, width: 1120, height: 100), size: 47, bold: true)
  if let subtitle {
    drawText(context, subtitle, CGRect(x: 80, y: 270, width: 1120, height: 50), size: 19, color: muted)
  }
}

func drawCar(_ context: CGContext, origin: CGPoint, scale: CGFloat = 1) {
  context.saveGState()
  context.translateBy(x: origin.x, y: origin.y)
  context.scaleBy(x: scale, y: scale)
  let path = CGMutablePath()
  path.move(to: CGPoint(x: 20, y: 85))
  path.addCurve(to: CGPoint(x: 100, y: 42), control1: CGPoint(x: 40, y: 52), control2: CGPoint(x: 70, y: 48))
  path.addLine(to: CGPoint(x: 245, y: 42))
  path.addCurve(to: CGPoint(x: 318, y: 82), control1: CGPoint(x: 280, y: 45), control2: CGPoint(x: 290, y: 58))
  path.addLine(to: CGPoint(x: 345, y: 95))
  path.addLine(to: CGPoint(x: 335, y: 130))
  path.addLine(to: CGPoint(x: 20, y: 130))
  path.closeSubpath()
  context.addPath(path); context.setFillColor(surfaceHigh); context.fillPath()
  context.addPath(path); context.setStrokeColor(gold); context.setLineWidth(2); context.strokePath()
  rounded(context, CGRect(x: 108, y: 52, width: 62, height: 35), 7, fill: NSColor(calibratedWhite: 0.04, alpha: 1).cgColor)
  rounded(context, CGRect(x: 180, y: 52, width: 65, height: 35), 7, fill: NSColor(calibratedWhite: 0.04, alpha: 1).cgColor)
  for wheelX in [75.0, 282.0] {
    context.setFillColor(ink); context.fillEllipse(in: CGRect(x: wheelX - 25, y: 107, width: 50, height: 50))
    context.setStrokeColor(gold); context.setLineWidth(3); context.strokeEllipse(in: CGRect(x: wheelX - 14, y: 118, width: 28, height: 28))
  }
  context.restoreGState()
}

func sceneOne(_ context: CGContext, local: Double) {
  let intro = reveal(local, delay: 0.03, span: 0.28)
  context.saveGState(); context.translateBy(x: (1 - intro) * 35, y: 0); context.setAlpha(intro)
  drawLogo(context, center: CGPoint(x: 938, y: 365), scale: 1.32)
  badge(context, text: "منصة تشغيل لمحلات قطع الغيار", rect: CGRect(x: 104, y: 174, width: 310, height: 40))
  drawText(context, "إدارة أذكى.", CGRect(x: 104, y: 248, width: 610, height: 76), size: 58, bold: true)
  drawText(context, "خدمة أسرع.", CGRect(x: 104, y: 330, width: 610, height: 76), size: 58, color: goldBright, bold: true)
  drawText(context, "ركائز يجمع المخزون والمبيعات والفروع والعملاء في تجربة واحدة.", CGRect(x: 104, y: 446, width: 625, height: 66), size: 21, color: muted)
  drawText(context, "RAKAEZ ERP", CGRect(x: 108, y: 555, width: 250, height: 30), size: 13, color: dimmed, bold: true, align: .left, rtl: false)
  context.restoreGState()
}

func sceneTwo(_ context: CGContext, local: Double) {
  topBar(context, scene: 1)
  headline(context, eyebrow: "من الفوضى إلى وضوح لحظي", title: "لا مزيد من البحث بين دفاتر وفروع منفصلة.", subtitle: "كل قطعة لها هوية، وموقع، وكمية، وسجل حركة يمكن تتبعه.")
  let items = [
    ("01", "أرقام قطع متكررة", "مطابقة موحدة ومنع الازدواجية"),
    ("02", "مخزون غير واضح", "رصيد حي لكل فرع ومستودع"),
    ("03", "وقت ضائع للعميل", "بحث فوري واقتراح أقرب فرع"),
  ]
  for (index, item) in items.enumerated() {
    let progress = reveal(local, delay: 0.12 + Double(index) * 0.11)
    let rect = CGRect(x: 80 + CGFloat(index) * 390, y: 365 + (1 - progress) * 28, width: 350, height: 205)
    context.saveGState(); context.setAlpha(progress)
    rounded(context, rect, 20, fill: surface, stroke: index == 1 ? NSColor(cgColor: gold)!.withAlphaComponent(0.45).cgColor : border)
    drawText(context, item.0, CGRect(x: rect.minX + 24, y: rect.minY + 22, width: 55, height: 25), size: 12, color: goldBright, bold: true, align: .left, rtl: false)
    drawText(context, item.1, CGRect(x: rect.minX + 24, y: rect.minY + 71, width: rect.width - 48, height: 38), size: 22, bold: true)
    drawText(context, item.2, CGRect(x: rect.minX + 24, y: rect.minY + 125, width: rect.width - 48, height: 45), size: 15, color: muted)
    context.restoreGState()
  }
}

func sceneThree(_ context: CGContext, local: Double) {
  topBar(context, scene: 2)
  drawText(context, "مركز القيادة", CGRect(x: 78, y: 116, width: 1124, height: 30), size: 13, color: goldBright, bold: true)
  drawText(context, "صورة واحدة لأداء منشأتك", CGRect(x: 78, y: 154, width: 1124, height: 56), size: 39, bold: true)
  let p = reveal(local, delay: 0.05)
  context.saveGState(); context.setAlpha(p)
  metric(context, rect: CGRect(x: 78, y: 245, width: 250, height: 155), label: "قيمة المبيعات اليوم", value: "42,780 ر.س", trend: "↑ 12.4% عن الأمس", tint: goldBright)
  metric(context, rect: CGRect(x: 350, y: 245, width: 250, height: 155), label: "إجمالي القطع", value: "18,420", trend: "متزامن عبر 4 فروع")
  metric(context, rect: CGRect(x: 622, y: 245, width: 250, height: 155), label: "طلبات التحويل", value: "12", trend: "8 جاهزة للتسليم", tint: green)
  metric(context, rect: CGRect(x: 894, y: 245, width: 308, height: 155), label: "دقة المخزون", value: "99.4%", trend: "آخر جرد: اليوم", tint: blue)
  rounded(context, CGRect(x: 78, y: 428, width: 1124, height: 185), 20, fill: surface, stroke: border)
  drawText(context, "حركة المبيعات — آخر 7 أيام", CGRect(x: 103, y: 451, width: 520, height: 30), size: 15, bold: true)
  let values: [CGFloat] = [0.32, 0.52, 0.41, 0.67, 0.58, 0.79, 0.93]
  let chartProgress = reveal(local, delay: 0.28, span: 0.42)
  var last: CGPoint?
  for (index, value) in values.enumerated() {
    let point = CGPoint(x: 125 + CGFloat(index) * 160, y: 572 - value * 92 * chartProgress)
    if let last { line(context, from: last, to: point, color: gold, width: 3) }
    context.setFillColor(goldBright); context.fillEllipse(in: CGRect(x: point.x - 5, y: point.y - 5, width: 10, height: 10))
    last = point
  }
  context.restoreGState()
}

func sceneFour(_ context: CGContext, local: Double) {
  topBar(context, scene: 3)
  headline(context, eyebrow: "بحث متعدد المسارات", title: "اكتب ما تعرفه... ودع ركائز يجد القطعة.")
  let tabs = ["رقم القطعة", "رقم الهيكل VIN", "الباركود", "رقم الرف"]
  for (index, tab) in tabs.enumerated() {
    let width: CGFloat = 190
    let rect = CGRect(x: 80 + CGFloat(index) * 205, y: 286, width: width, height: 44)
    rounded(context, rect, 12, fill: index == 1 ? NSColor(cgColor: gold)!.withAlphaComponent(0.15).cgColor : surface, stroke: index == 1 ? gold : border)
    drawText(context, tab, CGRect(x: rect.minX + 15, y: rect.minY + 11, width: rect.width - 30, height: 25), size: 13, color: index == 1 ? goldBright : muted, bold: index == 1, align: .center)
  }
  rounded(context, CGRect(x: 80, y: 360, width: 1120, height: 76), 16, fill: cream)
  drawText(context, "JTDBR32E720123456", CGRect(x: 116, y: 378, width: 760, height: 40), size: 23, color: NSColor.black.cgColor, bold: true, align: .left, rtl: false)
  rounded(context, CGRect(x: 1005, y: 371, width: 175, height: 54), 12, fill: gold)
  drawText(context, "بحث ذكي", CGRect(x: 1025, y: 386, width: 135, height: 28), size: 15, color: NSColor.black.cgColor, bold: true, align: .center)
  let p = reveal(local, delay: 0.23)
  context.saveGState(); context.setAlpha(p); context.translateBy(x: 0, y: (1 - p) * 25)
  rounded(context, CGRect(x: 80, y: 470, width: 1120, height: 150), 18, fill: surface, stroke: NSColor(cgColor: green)!.withAlphaComponent(0.35).cgColor)
  drawCar(context, origin: CGPoint(x: 112, y: 470), scale: 0.7)
  drawText(context, "تويوتا هايلكس 2022", CGRect(x: 420, y: 493, width: 350, height: 36), size: 22, bold: true)
  drawText(context, "محرك 2.7L · دفع رباعي · ملف السيارة محفوظ", CGRect(x: 420, y: 538, width: 460, height: 28), size: 14, color: muted)
  badge(context, text: "17 قطعة متوافقة", rect: CGRect(x: 925, y: 518, width: 230, height: 42), tint: green)
  context.restoreGState()
}

func sceneFive(_ context: CGContext, local: Double) {
  topBar(context, scene: 4)
  headline(context, eyebrow: "مخزون موحد داخل المنشأة", title: "القطعة غير موجودة هنا؟ اعثر عليها في أقرب فرع.")
  let headers = ["الفرع", "المتاح", "الرف", "الزمن المتوقع", "الإجراء"]
  let widths: [CGFloat] = [270, 150, 170, 230, 220]
  var x: CGFloat = 113
  for (index, header) in headers.enumerated() {
    drawText(context, header, CGRect(x: x, y: 326, width: widths[index] - 12, height: 24), size: 11, color: dimmed, bold: true)
    x += widths[index]
  }
  let rows = [
    (["فرع الرياض", "0", "—", "—", "غير متوفر"], red),
    (["فرع جدة", "8", "B-04-09", "45 دقيقة", "طلب تحويل"], green),
    (["مستودع السلي", "21", "A-11-03", "ساعتان", "حجز القطعة"], blue),
  ]
  for (index, row) in rows.enumerated() {
    let p = reveal(local, delay: 0.13 + Double(index) * 0.12)
    context.saveGState(); context.setAlpha(p); context.translateBy(x: (1 - p) * 35, y: 0)
    tableRow(context, y: 365 + CGFloat(index) * 68, columns: row.0, widths: widths, statusColor: row.1)
    context.restoreGState()
  }
  rounded(context, CGRect(x: 857, y: 590, width: 331, height: 52), 13, fill: gold)
  drawText(context, "إنشاء طلب تحويل بين الفروع", CGRect(x: 881, y: 604, width: 282, height: 27), size: 14, color: NSColor.black.cgColor, bold: true, align: .center)
}

func sceneSix(_ context: CGContext, local: Double) {
  topBar(context, scene: 5)
  headline(context, eyebrow: "تأسيس المخزون بلا إعادة إدخال", title: "من ملف المورد إلى رف المستودع بخطوات مراجعة واضحة.")
  let steps = [
    ("1", "رفع الملف", "Excel / CSV / فاتورة مورد"),
    ("2", "مطابقة الأعمدة", "رقم القطعة والكمية والسعر"),
    ("3", "كشف الأخطاء", "المكرر والناقص وغير الصالح"),
    ("4", "اعتماد آمن", "إضافة السليم بعد المراجعة"),
  ]
  for (index, step) in steps.enumerated() {
    let p = reveal(local, delay: 0.08 + Double(index) * 0.11)
    let x = 70 + CGFloat(index) * 300
    context.saveGState(); context.setAlpha(p)
    rounded(context, CGRect(x: x, y: 340, width: 265, height: 215), 19, fill: surface, stroke: index == 3 ? NSColor(cgColor: green)!.withAlphaComponent(0.45).cgColor : border)
    rounded(context, CGRect(x: x + 22, y: 362, width: 42, height: 42), 13, fill: index == 3 ? NSColor(cgColor: green)!.withAlphaComponent(0.15).cgColor : NSColor(cgColor: gold)!.withAlphaComponent(0.13).cgColor)
    drawText(context, step.0, CGRect(x: x + 31, y: 371, width: 24, height: 25), size: 15, color: index == 3 ? green : goldBright, bold: true, align: .center, rtl: false)
    drawText(context, step.1, CGRect(x: x + 22, y: 425, width: 221, height: 38), size: 20, bold: true)
    drawText(context, step.2, CGRect(x: x + 22, y: 477, width: 221, height: 48), size: 14, color: muted)
    context.restoreGState()
    if index < 3 {
      line(context, from: CGPoint(x: x + 270, y: 447), to: CGPoint(x: x + 294, y: 447), color: gold, width: 2)
    }
  }
  badge(context, text: "1,248 صفًا جاهزًا · 9 تحتاج مراجعة", rect: CGRect(x: 835, y: 590, width: 375, height: 42), tint: green)
}

func sceneSeven(_ context: CGContext, local: Double) {
  topBar(context, scene: 6)
  headline(context, eyebrow: "نقطة بيع تعرف من فعل ماذا", title: "كل عملية مرتبطة بالموظف والجهاز والفرع.")
  rounded(context, CGRect(x: 78, y: 300, width: 690, height: 320), 22, fill: surface, stroke: border)
  drawText(context, "فاتورة بيع جديدة", CGRect(x: 105, y: 326, width: 620, height: 35), size: 20, bold: true)
  tableRow(context, y: 385, columns: ["04465-0K240", "2 × 180 ر.س", "360 ر.س"], widths: [300, 190, 230])
  tableRow(context, y: 448, columns: ["90915-YZZD2", "1 × 42 ر.س", "42 ر.س"], widths: [300, 190, 230])
  drawText(context, "الإجمالي", CGRect(x: 105, y: 532, width: 230, height: 30), size: 14, color: muted)
  drawText(context, "402 ر.س", CGRect(x: 455, y: 527, width: 270, height: 42), size: 27, color: goldBright, bold: true)
  rounded(context, CGRect(x: 805, y: 300, width: 397, height: 320), 22, fill: surface, stroke: NSColor(cgColor: gold)!.withAlphaComponent(0.28).cgColor)
  drawText(context, "سجل المسؤولية", CGRect(x: 836, y: 328, width: 335, height: 36), size: 20, bold: true)
  let records = [("البائع", "أحمد محمد"), ("مأمور المستودع", "خالد علي"), ("الجهاز", "POS-RYD-03"), ("الفرع", "الرياض — العليا")]
  for (index, record) in records.enumerated() {
    let y = 393 + CGFloat(index) * 51
    drawText(context, record.0, CGRect(x: 835, y: y, width: 145, height: 25), size: 12, color: muted)
    drawText(context, record.1, CGRect(x: 960, y: y, width: 210, height: 25), size: 13, bold: true)
    line(context, from: CGPoint(x: 835, y: y + 32), to: CGPoint(x: 1170, y: y + 32), color: border)
  }
  badge(context, text: "تم التحقق من الصلاحية", rect: CGRect(x: 900, y: 575, width: 270, height: 38), tint: green)
}

func sceneEight(_ context: CGContext, local: Double) {
  topBar(context, scene: 7)
  headline(context, eyebrow: "ملف سيارة محفوظ للعميل", title: "رقم الهيكل يُسجّل مرة واحدة... ويخدم كل طلب قادم.")
  rounded(context, CGRect(x: 78, y: 310, width: 515, height: 305), 22, fill: surface, stroke: border)
  drawCar(context, origin: CGPoint(x: 150, y: 342), scale: 1.02)
  drawText(context, "تويوتا كامري 2021", CGRect(x: 112, y: 510, width: 445, height: 38), size: 22, bold: true)
  drawText(context, "VIN · 4T1G11AK3MU123456", CGRect(x: 112, y: 555, width: 445, height: 28), size: 13, color: muted, align: .left, rtl: false)
  rounded(context, CGRect(x: 625, y: 310, width: 577, height: 305), 22, fill: surface, stroke: NSColor(cgColor: blue)!.withAlphaComponent(0.3).cgColor)
  drawText(context, "سجل الطلبات والتوافق", CGRect(x: 655, y: 338, width: 517, height: 35), size: 20, bold: true)
  let history = [("فلتر زيت أصلي", "تم البيع", green), ("فحمات أمامية", "عرض سعر", goldBright), ("مساعد خلفي", "متوافق", blue)]
  for (index, row) in history.enumerated() {
    let y = 395 + CGFloat(index) * 65
    rounded(context, CGRect(x: 655, y: y, width: 517, height: 52), 11, fill: NSColor.white.withAlphaComponent(0.03).cgColor, stroke: border)
    drawText(context, row.0, CGRect(x: 676, y: y + 15, width: 300, height: 25), size: 14, bold: true)
    drawText(context, row.1, CGRect(x: 1010, y: y + 15, width: 135, height: 25), size: 12, color: row.2, bold: true)
  }
  drawText(context, "لا حاجة لإعادة إدخال بيانات السيارة", CGRect(x: 655, y: 586, width: 517, height: 26), size: 12, color: muted)
}

func sceneNine(_ context: CGContext, local: Double) {
  topBar(context, scene: 8)
  headline(context, eyebrow: "الأمان والامتثال من أساس التصميم", title: "بيانات المنشأة تبقى داخل حدودها وصلاحياتها.")
  let features = [
    ("عزل متعدد المستأجرين", "كل شركة وفروعها ضمن نطاق مستقل", "TENANT ISOLATION"),
    ("صلاحيات وربط أجهزة", "المدير يحدد من يدخل وماذا ينفذ", "ACCESS CONTROL"),
    ("سجل تدقيق كامل", "تتبّع البيع والصرف والتحويل والتعديل", "AUDIT TRAIL"),
    ("جاهزية للسوق السعودي", "ضوابط أمنية ومسار تكاملات منظم", "SAUDI READY"),
  ]
  for (index, item) in features.enumerated() {
    let row = index / 2
    let col = index % 2
    let p = reveal(local, delay: 0.08 + Double(index) * 0.09)
    let rect = CGRect(x: 78 + CGFloat(col) * 570, y: 315 + CGFloat(row) * 145, width: 535, height: 120)
    context.saveGState(); context.setAlpha(p)
    rounded(context, rect, 18, fill: surface, stroke: index == 3 ? NSColor(cgColor: gold)!.withAlphaComponent(0.4).cgColor : border)
    rounded(context, CGRect(x: rect.maxX - 62, y: rect.minY + 24, width: 38, height: 38), 12, fill: NSColor(cgColor: index == 3 ? gold : green)!.withAlphaComponent(0.12).cgColor)
    drawText(context, "✓", CGRect(x: rect.maxX - 53, y: rect.minY + 31, width: 20, height: 24), size: 15, color: index == 3 ? goldBright : green, bold: true, align: .center)
    drawText(context, item.0, CGRect(x: rect.minX + 24, y: rect.minY + 24, width: rect.width - 110, height: 30), size: 18, bold: true)
    drawText(context, item.1, CGRect(x: rect.minX + 24, y: rect.minY + 62, width: rect.width - 110, height: 28), size: 13, color: muted)
    drawText(context, item.2, CGRect(x: rect.minX + 24, y: rect.maxY - 24, width: 220, height: 16), size: 8, color: dimmed, bold: true, align: .left, rtl: false)
    context.restoreGState()
  }
}

func sceneTen(_ context: CGContext, local: Double) {
  let p = reveal(local, delay: 0.02, span: 0.28)
  context.saveGState(); context.setAlpha(p)
  drawLogo(context, center: CGPoint(x: 640, y: 230), scale: 0.95)
  drawText(context, "ركائز", CGRect(x: 330, y: 330, width: 620, height: 82), size: 60, bold: true, align: .center)
  drawText(context, "نظام واحد. رؤية أوضح. خدمة أسرع.", CGRect(x: 260, y: 420, width: 760, height: 52), size: 25, color: goldBright, bold: true, align: .center)
  drawText(context, "ابنِ مخزونًا أدق، اربط فروعك، وامنح عميلك الإجابة في لحظتها.", CGRect(x: 250, y: 492, width: 780, height: 55), size: 18, color: muted, align: .center)
  badge(context, text: "النسخة التجريبية المحلية", rect: CGRect(x: 503, y: 580, width: 274, height: 42), tint: green)
  context.restoreGState()
}

func drawFrame(_ context: CGContext, scene: Int, local: Double, time: Double) {
  drawBackground(context, scene: scene, time: time)
  let fadeIn = min(1, local / 0.10)
  let fadeOut = min(1, (1 - local) / 0.10)
  context.saveGState()
  context.setAlpha(CGFloat(max(0, min(fadeIn, fadeOut))))
  switch scene {
  case 0: sceneOne(context, local: local)
  case 1: sceneTwo(context, local: local)
  case 2: sceneThree(context, local: local)
  case 3: sceneFour(context, local: local)
  case 4: sceneFive(context, local: local)
  case 5: sceneSix(context, local: local)
  case 6: sceneSeven(context, local: local)
  case 7: sceneEight(context, local: local)
  case 8: sceneNine(context, local: local)
  default: sceneTen(context, local: local)
  }
  context.restoreGState()

  for index in 0..<sceneCount {
    let segmentWidth: CGFloat = 105
    let x = 78 + CGFloat(index) * 113
    rounded(context, CGRect(x: x, y: 678, width: segmentWidth, height: 3), 1.5, fill: index < scene ? gold : (index == scene ? goldBright : NSColor.white.withAlphaComponent(0.12).cgColor))
    if index == scene {
      rounded(context, CGRect(x: x, y: 678, width: segmentWidth * CGFloat(local), height: 3), 1.5, fill: goldBright)
    }
  }
}

for frame in 0..<totalFrames {
  autoreleasepool {
    let width = Int(canvas.width)
    let height = Int(canvas.height)
    let bytesPerRow = width * 4
    var bytes = Data(count: bytesPerRow * height)
    bytes.withUnsafeMutableBytes { raw in
      let context = CGContext(
        data: raw.baseAddress!,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
      )!
      let time = Double(frame) / Double(fps)
      let scene = min(sceneCount - 1, Int(time / sceneDuration))
      let local = (time - Double(scene) * sceneDuration) / sceneDuration
      drawFrame(context, scene: scene, local: local, time: time)
    }
    try! output.write(contentsOf: bytes)
  }
}
