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
// 名字和语言：名字取包信息（Khalil 本机是「总控台」，公开版是「cc-board」）；系统首选语言是中文就说中文，否则英文（和 ui.html 一致）
let appName = (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
    ?? (Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String) ?? "cc-board"
let zh = Locale.preferredLanguages.first?.hasPrefix("zh") ?? false
func L(_ zhText: String, _ en: String) -> String { zh ? zhText : en }

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
        window.title = appName
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
        showMessage(L("正在启动…", "Starting…"))
        DispatchQueue.global(qos: .userInitiated).async { self.startAndLoad(launch: true) }
    }

    // ── 服务 ──
    func health() -> String? { healthInfo()?.data }      // 返回服务的数据目录；没在跑返回 nil
    func healthInfo() -> (data: String, pid: Int32)? {    // 服务自己报的数据目录和进程号（pid 没报是 0）
        var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/health")!)
        req.timeoutInterval = 0.8
        let sem = DispatchSemaphore(value: 0)
        var out: (data: String, pid: Int32)?
        URLSession.shared.dataTask(with: req) { data, _, _ in
            if let data = data, let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], j["app"] as? String == "cc-board" {
                out = ((j["data"] as? String) ?? dataDir, (j["pid"] as? NSNumber)?.int32Value ?? 0)
            }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 1.5)
        return out
    }

    func startAndLoad(launch: Bool = false) {
        if launch { prepareReleaseCode() }
        var dir = health()
        if dir == nil {
            let err = spawnServer()
            if let err = err { DispatchQueue.main.async { self.showMessage(err) }; return }
            for _ in 0..<60 { Thread.sleep(forTimeInterval: 0.25); dir = health(); if dir != nil { break } }
        }
        guard let d = dir, let token = try? String(contentsOfFile: d + "/.token", encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
            DispatchQueue.main.async { self.showMessage(L("服务没起来。日志在 \(dataDir)/server.log", "The server didn't start. The log is in \(dataDir)/server.log")) }
            return
        }
        DispatchQueue.main.async {
            self.web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/?k=\(token)")!))
        }
    }

    // 公开的安装包（release/release.sh 打的，Info.plist 里 CCBoardSyncCode = true）：包里带的代码换了版本，就先换进 liveDir 再起服务（启动时的 prepareReleaseCode）。
    // 这样换新版 dmg 后跑的是新代码，README 里状态栏命令写的 liveDir/statusline-tap.mjs 也一直在。
    // build.sh 装的（Khalil 本机、一行安装脚本）没有这个键：liveDir 由 build.sh 管，这里不碰，和以前一样。
    // 只在应用启动那一刻做一次。服务重启、⌘R 都不再做：两个版本同时开着时，每次都换会互相停掉对方的服务，来回打架。
    //  - 数据目录的 app/ 归 build.sh 管（有 server.mjs、没有 .bundle-version），而且服务正在跑：什么都不动，直接连上。
    //    作者本机开着总控台时误开了公开包、一行安装脚本的用户开着旧版时打开 dmg 版，都是这种；盖掉它的代码、停掉它的服务都不对。
    //  - 其余：把包里的代码换进去。真换了、而端口上答话的是同一个数据目录的旧服务（上一版被强退留下的），按它自己报的进程号停掉，
    //    下面再起新的；不停的话新外壳会一直连着旧代码，直到重启电脑。
    // build.sh 装的没有 CCBoardSyncCode，第一行就回去了。
    func prepareReleaseCode() {
        guard Bundle.main.object(forInfoDictionaryKey: "CCBoardSyncCode") as? Bool == true else { return }
        var running: (data: String, pid: Int32)?
        for _ in 0..<3 { running = healthInfo(); if running != nil { break } }   // 没有服务时连接立刻被拒，试三次不费时间；机器卡时多两次机会
        let fm = FileManager.default
        let buildManaged = fm.fileExists(atPath: liveDir + "/server.mjs") && !fm.fileExists(atPath: liveDir + "/" + BundledCode.stampName)
        if running != nil && buildManaged { return }
        guard syncBundledCode(), let h = running, h.data == dataDir, h.pid > 1 else { return }
        kill(h.pid, SIGTERM)
        for _ in 0..<20 { Thread.sleep(forTimeInterval: 0.25); if health() == nil { break } }
    }

    func syncBundledCode() -> Bool {                     // 换了返回 true
        guard Bundle.main.object(forInfoDictionaryKey: "CCBoardSyncCode") as? Bool == true, let res = Bundle.main.resourcePath else { return false }
        let info = Bundle.main.infoDictionary ?? [:]
        return BundledCode.sync(from: res, to: liveDir, stamp: "\(info["CFBundleShortVersionString"] ?? "?") (\(info["CFBundleVersion"] ?? "?"))")
    }

    func spawnServer() -> String? {
        let fm = FileManager.default
        guard let res = [liveDir, Bundle.main.resourcePath ?? ""].first(where: { fm.fileExists(atPath: $0 + "/server.mjs") && fm.fileExists(atPath: $0 + "/ui.html") }) else {
            return L("找不到 server.mjs（跑一下 ccboard update）", "server.mjs is missing. Reinstall cc-board.")
        }
        let node: String
        switch NodeLookup.find(home: home, dataDir: dataDir) {
        case .found(let p): node = p
        case .tooOld(let p, let v):
            return L("找到的 node 是 \(v)（\(p)），要 Node 22 以上：brew upgrade node",
                     "cc-board needs Node.js 22 or later, and the one it found is \(v) at \(p). Upgrade it (brew upgrade node) and reopen cc-board.")
        case .none:
            return L("这台机器上没找到 Node 22 以上的 node。装一个（brew install node），或把路径写进 \(dataDir)/node",
                     "cc-board needs Node.js 22 or later and couldn't find it. Install it (brew install node, or from nodejs.org) and reopen cc-board. If it's somewhere unusual, put its path in \(dataDir)/node")
        }
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
        do { try p.run() } catch { return L("服务启动失败：", "Couldn't start the server: ") + error.localizedDescription }
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
    func webView(_ w: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showMessage(L("页面没打开：", "Couldn't open the page: ") + error.localizedDescription) }
    func webView(_ w: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showMessage(L("页面没打开：", "Couldn't open the page: ") + error.localizedDescription) }

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
        add(appName, [item(L("关于", "About ") + appName, #selector(NSApplication.orderFrontStandardAboutPanel(_:))), .separator(),
                     item(L("隐藏", "Hide ") + appName, #selector(NSApplication.hide(_:)), "h"),
                     item(L("隐藏其他", "Hide Others"), #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]), .separator(),
                     item(L("退出", "Quit ") + appName, #selector(NSApplication.terminate(_:)), "q")])
        add(L("文件", "File"), [item(L("新会话", "New Session"), #selector(newBlank(_:)), "t"), item(L("新任务…", "New Task…"), #selector(newTask(_:)), "n"), .separator(),
                               item(L("关闭窗口", "Close Window"), #selector(NSWindow.performClose(_:)), "w")])
        add(L("编辑", "Edit"), [item(L("撤销", "Undo"), Selector(("undo:")), "z"), item(L("重做", "Redo"), Selector(("redo:")), "z", [.command, .shift]), .separator(),
                               item(L("剪切", "Cut"), #selector(NSText.cut(_:)), "x"), item(L("拷贝", "Copy"), #selector(NSText.copy(_:)), "c"),
                               item(L("粘贴", "Paste"), #selector(NSText.paste(_:)), "v"), item(L("全选", "Select All"), #selector(NSText.selectAll(_:)), "a")])
        add(L("显示", "View"), [item(L("重新载入", "Reload"), #selector(reloadPage(_:)), "r"),
                               item(L("进入全屏", "Enter Full Screen"), #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])])
        add(L("窗口", "Window"), [item(L("最小化", "Minimize"), #selector(NSWindow.performMiniaturize(_:)), "m"), item(L("缩放", "Zoom"), #selector(NSWindow.performZoom(_:)))])
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
