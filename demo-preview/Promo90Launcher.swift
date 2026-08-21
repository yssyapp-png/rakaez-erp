import AppKit
import Foundation

final class LauncherDelegate: NSObject, NSApplicationDelegate {
  private var window: NSWindow!
  private var titleLabel: NSTextField!
  private var statusLabel: NSTextField!
  private var spinner: NSProgressIndicator!
  private var revealButton: NSButton!
  private var process: Process?

  private let generatorPath = "/Users/sh/Documents/Codex/2026-08-10/referenced-chatgpt-conversation-this-is-an/work/rakaez-erp/demo-preview/GENERATE_PROMO_90.command"
  private let outputPath = NSHomeDirectory() + "/Documents/فيديو-ركائز-الدعائي-90-ثانية-بدون-موسيقى.mp4"

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 560, height: 330),
      styleMask: [.titled, .closable],
      backing: .buffered,
      defer: false
    )
    window.title = "ركائز — الفيديو الدعائي"
    window.center()
    window.backgroundColor = NSColor(calibratedRed: 0.045, green: 0.046, blue: 0.052, alpha: 1)
    window.isReleasedWhenClosed = false

    let content = NSView(frame: window.contentView!.bounds)
    content.autoresizingMask = [.width, .height]
    window.contentView = content

    let mark = NSTextField(labelWithString: "◇")
    mark.frame = NSRect(x: 235, y: 225, width: 90, height: 72)
    mark.font = NSFont.systemFont(ofSize: 62, weight: .medium)
    mark.textColor = NSColor(calibratedRed: 0.90, green: 0.72, blue: 0.34, alpha: 1)
    mark.alignment = .center
    content.addSubview(mark)

    titleLabel = NSTextField(labelWithString: "إنشاء فيديو ركائز الاحترافي")
    titleLabel.frame = NSRect(x: 45, y: 177, width: 470, height: 38)
    titleLabel.font = NSFont.systemFont(ofSize: 24, weight: .bold)
    titleLabel.textColor = .white
    titleLabel.alignment = .center
    content.addSubview(titleLabel)

    statusLabel = NSTextField(wrappingLabelWithString: "جارٍ إنشاء التعليق الصوتي العربي ودمجه مع الفيديو لمدة 90 ثانية.\nلا توجد موسيقى، ولا يتم رفع أي بيانات إلى الإنترنت.")
    statusLabel.frame = NSRect(x: 55, y: 102, width: 450, height: 58)
    statusLabel.font = NSFont.systemFont(ofSize: 14)
    statusLabel.textColor = NSColor(calibratedWhite: 0.72, alpha: 1)
    statusLabel.alignment = .center
    content.addSubview(statusLabel)

    spinner = NSProgressIndicator(frame: NSRect(x: 265, y: 62, width: 30, height: 30))
    spinner.style = .spinning
    spinner.controlSize = .regular
    spinner.startAnimation(nil)
    content.addSubview(spinner)

    revealButton = NSButton(title: "إظهار الفيديو في المستندات", target: self, action: #selector(revealOutput))
    revealButton.frame = NSRect(x: 165, y: 50, width: 230, height: 36)
    revealButton.bezelStyle = .rounded
    revealButton.isHidden = true
    content.addSubview(revealButton)

    window.makeKeyAndOrderFront(nil)
    startGeneration()
  }

  private func startGeneration() {
    let task = Process()
    let output = Pipe()
    task.executableURL = URL(fileURLWithPath: "/bin/zsh")
    task.arguments = [generatorPath]
    task.standardOutput = output
    task.standardError = output
    task.terminationHandler = { [weak self] completed in
      DispatchQueue.main.async {
        self?.finish(status: completed.terminationStatus)
      }
    }
    do {
      try task.run()
      process = task
    } catch {
      finish(status: 1)
    }
  }

  private func finish(status: Int32) {
    spinner.stopAnimation(nil)
    spinner.isHidden = true
    if status == 0, FileManager.default.fileExists(atPath: outputPath) {
      titleLabel.stringValue = "اكتمل الفيديو بنجاح"
      statusLabel.stringValue = "تم حفظ النسخة النهائية في مجلد المستندات على الماك.\nالمدة 90 ثانية — تعليق صوتي عربي فقط دون موسيقى."
      statusLabel.textColor = NSColor(calibratedRed: 0.35, green: 0.86, blue: 0.59, alpha: 1)
      revealButton.isHidden = false
      NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: outputPath)])
    } else {
      titleLabel.stringValue = "تعذر إكمال الصوت"
      statusLabel.stringValue = "تأكد من توفر صوت Majed العربي في إعدادات النطق على macOS، ثم أغلق هذه النافذة وشغّل التطبيق مرة أخرى."
      statusLabel.textColor = NSColor(calibratedRed: 0.96, green: 0.45, blue: 0.42, alpha: 1)
    }
  }

  @objc private func revealOutput() {
    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: outputPath)])
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = LauncherDelegate()
app.delegate = delegate
app.run()
