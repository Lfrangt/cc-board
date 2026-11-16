// 公开安装包（Info.plist 里 CCBoardSyncCode = true）起服务之前，把包里的代码换进数据目录的 app/。
// main.swift 的 syncBundledCode() 调它；test/app-shell.test.mjs 拿临时目录测它。
// 为什么要拷：换了新版 dmg 后要跑新代码；README 里状态栏命令写的是数据目录里的 statusline-tap.mjs，它得一直在。
import Foundation

enum BundledCode {
    static let stampName = ".bundle-version"

    /// 包里要拷的文件：.mjs 和 .html，按名字排好
    static func codeFiles(_ res: String) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: res)) ?? []).filter { $0.hasSuffix(".mjs") || $0.hasSuffix(".html") }.sorted()
    }

    /// live 已经是这一版，而且包里的文件一个不少（被删掉一个也算不是，下次启动补回来）
    static func isCurrent(_ live: String, files: [String], stamp: String) -> Bool {
        guard (try? String(contentsOfFile: live + "/" + stampName, encoding: .utf8)) == stamp else { return false }
        return files.allSatisfy { FileManager.default.fileExists(atPath: live + "/" + $0) }
    }

    /// res：包里的 Resources；live：数据目录的 app/；stamp：这个包的版本（如 "0.3.0 (202611161330)"）。
    /// 换了返回 true。已是这一版、包里缺 server.mjs / ui.html、等锁超时、中途失败都返回 false，live 保持原样（失败时下次启动再试）。
    /// 先拷进旁边的 app.incoming/，齐了再整个换上：不会留下一半新一半旧、互相 import 不上的代码。
    /// 两个实例同时启动（dmg 里一份、「应用程序」里一份，或 open -n）时用一把文件锁排队：后到的拿到锁再看一眼，已经换好就不动。
    /// 11/16 审查实测没有锁时同时启动 150 对里 126 对把 app/ 弄成「记号是新的、文件缺了」，而且之后一直不修。
    @discardableResult
    static func sync(from res: String, to live: String, stamp: String, lockWait: TimeInterval = 10) -> Bool {
        let fm = FileManager.default
        let files = codeFiles(res)
        guard files.contains("server.mjs"), files.contains("ui.html") else { return false }
        if isCurrent(live, files: files, stamp: stamp) { return false }          // 平时走这里，不拿锁

        let parent = (live as NSString).deletingLastPathComponent
        try? fm.createDirectory(atPath: parent, withIntermediateDirectories: true)
        let fd = open(parent + "/.bundle-sync.lock", O_CREAT | O_RDWR, 0o600)
        guard fd >= 0 else { return false }
        defer { close(fd) }                                                       // 关掉就放锁；进程死了系统也会放
        let deadline = Date().addingTimeInterval(lockWait)
        while flock(fd, LOCK_EX | LOCK_NB) != 0 {
            if errno != EWOULDBLOCK { break }                                     // 这个文件系统不支持文件锁：不加锁照做，别每次干等
            if Date() >= deadline { return false }
            usleep(50_000)
        }
        if isCurrent(live, files: files, stamp: stamp) { return false }          // 排队时别人已经换好了

        let incoming = live + ".incoming", old = live + ".old"
        try? fm.removeItem(atPath: incoming)                                      // 上次中断留下的半成品
        do {
            try fm.createDirectory(atPath: incoming, withIntermediateDirectories: true)
            for f in files { try fm.copyItem(atPath: res + "/" + f, toPath: incoming + "/" + f) }
            try stamp.write(toFile: incoming + "/" + stampName, atomically: true, encoding: .utf8)
        } catch {
            try? fm.removeItem(atPath: incoming)
            return false
        }
        try? fm.removeItem(atPath: old)
        let hadLive = fm.fileExists(atPath: live) || (try? fm.destinationOfSymbolicLink(atPath: live)) != nil
        do {
            if hadLive { try fm.moveItem(atPath: live, toPath: old) }
        } catch {
            try? fm.removeItem(atPath: incoming)
            return false
        }
        do {
            try fm.moveItem(atPath: incoming, toPath: live)
        } catch {
            if hadLive { try? fm.moveItem(atPath: old, toPath: live) }           // 换不上就把原来的放回去
            try? fm.removeItem(atPath: incoming)
            return false
        }
        try? fm.removeItem(atPath: old)
        return true
    }
}
