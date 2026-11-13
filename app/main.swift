// 总控台 —— 原生 macOS 外壳。
// 自己的窗口和 Dock 图标；界面是包里带的 ui.html，由包里带的 server.mjs 在本机 127.0.0.1 提供。
// 打开时如果服务没在跑就自己启动，退出时只停自己启动的那个。
import Cocoa
import WebKit

let port = 4747
let home = FileManager.default.homeDirectoryForCurrentUser.path
let dataDir = home + "/Library/Application Support/cc-board"
let liveDir = dataDir + "/app"       // 界面和服务的代码放在包外面：改它们不用重新编译，也不用重新授权
let barHeight: CGFloat = 52          // 和 ui.html 里的 --bar-h 一致，红绿灯在里面垂直居中

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var server: Process?
    var quitting = false

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "ccb")
        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        web.allowsBackForwardNavigationGestures = false

        let vf = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let w = min(1720, vf.width * 0.94), h = min(1080, vf.height * 0.94)
        window = NSWindow(contentRect: NSRect(x: vf.midX - w / 2, y: vf.midY - h / 2, width: w, height: h),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = "总控台"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 560, height: 480)
        window.backgroundColor = NSColor(name: nil) { ap in
            ap.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .black : NSColor(srgbRed: 0.961, green: 0.961, blue: 0.969, alpha: 1)
        }
        window.contentView = web
        window.delegate = self
        window.setFrameAutosaveName("ccboard.main")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        placeTrafficLights()
        showMessage("正在启动…")
        DispatchQueue.global(qos: .userInitiated).async { self.startAndLoad() }
    }

    // ── 服务 ──
    func health() -> String? {          // 返回服务的数据目录；没在跑返回 nil
        var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/health")!)
        req.timeoutInterval = 0.8
        let sem = DispatchSemaphore(value: 0)
        var out: String?
        URLSession.shared.dataTask(with: req) { data, _, _ in
            if let data = data, let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], j["app"] as? String == "cc-board" {
                out = (j["data"] as? String) ?? dataDir
            }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 1.5)
        return out
    }

    func startAndLoad() {
        var dir = health()
        if dir == nil {
            let err = spawnServer()
            if let err = err { DispatchQueue.main.async { self.showMessage(err) }; return }
            for _ in 0..<60 { Thread.sleep(forTimeInterval: 0.25); dir = health(); if dir != nil { break } }
        }
        guard let d = dir, let token = try? String(contentsOfFile: d + "/.token", encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
            DispatchQueue.main.async { self.showMessage("服务没起来。日志在 \(dataDir)/server.log") }
            return
        }
        DispatchQueue.main.async {
            self.web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/?k=\(token)")!))
        }
    }

    func spawnServer() -> String? {
        let fm = FileManager.default
        guard let res = [liveDir, Bundle.main.resourcePath ?? ""].first(where: { fm.fileExists(atPath: $0 + "/server.mjs") && fm.fileExists(atPath: $0 + "/ui.html") }) else { return "找不到 server.mjs（跑一下 ccboard update）" }
        let nodes = [home + "/.local/node/bin/node", "/opt/homebrew/bin/node", "/usr/local/bin/node"]
        guard let node = nodes.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else { return "这台机器上没找到 node" }
        try? FileManager.default.createDirectory(atPath: dataDir, withIntermediateDirectories: true)
        let log = dataDir + "/server.log"
        if !FileManager.default.fileExists(atPath: log) { FileManager.default.createFile(atPath: log, contents: nil) }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")          // 经登录 shell 起，环境变量和你在终端里的一样
        p.arguments = ["-lc", "exec \"$0\" \"$1\"", node, res + "/server.mjs"]
        var env = ProcessInfo.processInfo.environment
        env["CCBOARD_DATA"] = dataDir
        p.environment = env
        p.currentDirectoryURL = URL(fileURLWithPath: home)
        if let fh = FileHandle(forWritingAtPath: log) { fh.seekToEndOfFile(); p.standardOutput = fh; p.standardError = fh }
        p.terminationHandler = { [weak self] _ in      // 服务被换新版或意外退出：自己再起一个，然后重新载入
            guard let self = self, !self.quitting else { return }
            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 0.6) { self.server = nil; self.startAndLoad() }
        }
        do { try p.run() } catch { return "服务启动失败：\(error.localizedDescription)" }
        server = p
        return nil
    }

    func applicationWillTerminate(_ note: Notification) {
        quitting = true
        if let p = server, p.isRunning { p.terminate() }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil); return true
    }

    func showMessage(_ text: String) {
        let safe = text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        web.loadHTMLString("<html><head><meta name=color-scheme content='light dark'></head><body style='font:13px -apple-system;display:grid;place-items:center;height:100vh;margin:0;opacity:.55'>\(safe)</body></html>", baseURL: nil)
    }

    // ── 页面发来的消息：Dock 角标、拖窗口 ──
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let d = m.body as? [String: Any], let t = d["type"] as? String else { return }
        switch t {
        case "badge":
            let n = (d["n"] as? NSNumber)?.intValue ?? 0
            NSApp.dockTile.badgeLabel = n > 0 ? String(n) : nil
        case "drag":
            if let e = NSApp.currentEvent, e.type == .leftMouseDown || e.type == .leftMouseDragged { window.performDrag(with: e) }
        case "zoom":
            window.zoom(nil)
        default: break
        }
    }

    // ── 只在窗口里开自己的页面；别的链接交给默认浏览器 ──
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = a.request.url, let scheme = u.scheme, scheme == "http" || scheme == "https", u.host != "127.0.0.1" {
            NSWorkspace.shared.open(u); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url { NSWorkspace.shared.open(u) }
        return nil
    }
    func webView(_ w: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showMessage("页面没打开：\(error.localizedDescription)") }
    func webView(_ w: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showMessage("页面没打开：\(error.localizedDescription)") }

    // ── 红绿灯在 52pt 的顶栏里垂直居中 ──
    func placeTrafficLights() {
        guard !window.styleMask.contains(.fullScreen),
              let close = window.standardWindowButton(.closeButton),
              let mini = window.standardWindowButton(.miniaturizeButton),
              let zoom = window.standardWindowButton(.zoomButton),
              let container = close.superview?.superview else { return }
        var f = container.frame
        f.size.height = barHeight
        f.origin.y = window.frame.height - barHeight
        container.frame = f
        let gap = mini.frame.minX - close.frame.minX
        for (i, b) in [close, mini, zoom].enumerated() {
            b.setFrameOrigin(NSPoint(x: 20 + CGFloat(i) * (gap > 0 ? gap : 20), y: (barHeight - b.frame.height) / 2))
        }
    }
    func windowDidResize(_ n: Notification) { placeTrafficLights() }
    func windowDidBecomeKey(_ n: Notification) { placeTrafficLights() }
    func windowDidExitFullScreen(_ n: Notification) { placeTrafficLights() }

    // ── 菜单 ──
    @objc func newTask(_ s: Any?) { web.evaluateJavaScript("window.ccbNew && window.ccbNew()", completionHandler: nil) }
    @objc func newBlank(_ s: Any?) { web.evaluateJavaScript("window.ccbBlank && window.ccbBlank()", completionHandler: nil) }
    @objc func reloadPage(_ s: Any?) { DispatchQueue.global(qos: .userInitiated).async { self.startAndLoad() } }

    func buildMenu() {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) {
            let it = NSMenuItem(); let m = NSMenu(title: title); items.forEach { m.addItem($0) }; it.submenu = m; main.addItem(it)
        }
        func item(_ t: String, _ a: Selector?, _ k: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: t, action: a, keyEquivalent: k); i.keyEquivalentModifierMask = mods; return i
        }
        add("总控台", [item("关于总控台", #selector(NSApplication.orderFrontStandardAboutPanel(_:))), .separator(),
                     item("隐藏总控台", #selector(NSApplication.hide(_:)), "h"),
                     item("隐藏其他", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]), .separator(),
                     item("退出总控台", #selector(NSApplication.terminate(_:)), "q")])
        add("文件", [item("新会话", #selector(newBlank(_:)), "t"), item("新任务…", #selector(newTask(_:)), "n"), .separator(), item("关闭窗口", #selector(NSWindow.performClose(_:)), "w")])
        add("编辑", [item("撤销", Selector(("undo:")), "z"), item("重做", Selector(("redo:")), "z", [.command, .shift]), .separator(),
                    item("剪切", #selector(NSText.cut(_:)), "x"), item("拷贝", #selector(NSText.copy(_:)), "c"),
                    item("粘贴", #selector(NSText.paste(_:)), "v"), item("全选", #selector(NSText.selectAll(_:)), "a")])
        add("显示", [item("重新载入", #selector(reloadPage(_:)), "r"), item("进入全屏", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])])
        add("窗口", [item("最小化", #selector(NSWindow.performMiniaturize(_:)), "m"), item("缩放", #selector(NSWindow.performZoom(_:)))])
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
