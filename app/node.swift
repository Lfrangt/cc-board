// 找 node：服务要 Node 22 以上。main.swift 用它，test/app-shell.test.mjs 拿假主目录测它。
//
// 找的顺序（前面的先用）：
//   1. 数据目录里的 `node` 文件，一行路径：用户自己指定的
//   2. 三个固定位置：~/.local/node/bin、/opt/homebrew/bin、/usr/local/bin（11/16 之前只认这三个，顺序没变）
//   3. Homebrew 只装成 keg 的版本：/opt/homebrew/opt/node@24/bin 这类
//   4. 版本管理器装的：nvm、fnm、volta、mise、asdf、nodenv；同一个管理器里先试版本高的
//   5. 登录 shell 的 PATH（`zsh -lc 'command -v node'`）：.zprofile 里自己加过 PATH 的
// 每个候选真跑一次 `node --version`。版本低于 22 的跳过但记下第一个，最后好说「找到了 v20，要 22 以上」。
// `--version` 跑不出结果（超时、崩了）的候选不当成太旧：如果什么都没找到，就用第一个这样的，和 11/16 之前一样直接拿它起服务。
import Foundation

enum NodeLookup {
    case found(String)
    case tooOld(path: String, version: String)
    case none

    static let minMajor = 22

    /// home：主目录；dataDir：总控台的数据目录；roots：Homebrew 和 /usr/local 这类前缀（测试换成假目录）；
    /// loginShell：拿登录 shell 里的 node 路径（测试换成假的，或者不给）
    static func find(home: String, dataDir: String, roots: [String] = ["/opt/homebrew", "/usr/local"],
                     loginShell: (() -> String?)? = { NodeLookup.fromLoginShell() }) -> NodeLookup {
        var tried = Set<String>()
        var firstOld: (String, String)?
        var firstUnknown: String?

        func check(_ path: String) -> String? {           // 合格就返回路径
            guard !path.isEmpty, !tried.contains(path), FileManager.default.isExecutableFile(atPath: path) else { return nil }
            tried.insert(path)
            guard let v = version(of: path) else {
                if firstUnknown == nil { firstUnknown = path }
                return nil
            }
            if major(v) >= minMajor { return path }
            if firstOld == nil { firstOld = (path, v) }
            return nil
        }

        // 1. 指定的
        if let s = try? String(contentsOfFile: dataDir + "/node", encoding: .utf8) {
            let p = expand(s.trimmingCharacters(in: .whitespacesAndNewlines), home: home)
            if let ok = check(p) { return .found(ok) }
        }
        // 2. 固定位置
        for p in [home + "/.local/node/bin/node"] + roots.map({ $0 + "/bin/node" }) {
            if let ok = check(p) { return .found(ok) }
        }
        // 3. Homebrew keg（node@22、node@24……）
        for r in roots {
            for p in versioned(r + "/opt", prefix: "node@", tail: "/bin/node") { if let ok = check(p) { return .found(ok) } }
        }
        // 4. 版本管理器
        let managers: [(String, String)] = [
            (home + "/.nvm/versions/node", "/bin/node"),
            (home + "/.local/share/fnm/node-versions", "/installation/bin/node"),
            (home + "/Library/Application Support/fnm/node-versions", "/installation/bin/node"),
            (home + "/.volta/tools/image/node", "/bin/node"),
            (home + "/.local/share/mise/installs/node", "/bin/node"),
            (home + "/.asdf/installs/nodejs", "/bin/node"),
            (home + "/.nodenv/versions", "/bin/node"),
        ]
        for (dir, tail) in managers {
            for p in versioned(dir, prefix: "", tail: tail) { if let ok = check(p) { return .found(ok) } }
        }
        // 5. 登录 shell
        if let p = loginShell?(), let ok = check(p) { return .found(ok) }

        if let u = firstUnknown { return .found(u) }
        if let (p, v) = firstOld { return .tooOld(path: p, version: v) }
        return .none
    }

    /// dir 下名字以 prefix 开头的子目录，按版本号从高到低，拼上 tail
    static func versioned(_ dir: String, prefix: String, tail: String) -> [String] {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return [] }
        let picked = names.filter { $0.hasPrefix(prefix) && !$0.hasPrefix(".") }
        return picked.sorted { a, b in
            let x = parts(String(a.dropFirst(prefix.count))), y = parts(String(b.dropFirst(prefix.count)))
            return x != y ? y.lexicographicallyPrecedes(x) : a < b      // 版本高的在前；一样高按名字
        }.map { dir + "/" + $0 + tail }
    }

    /// "v22.11.0" → [22, 11, 0]；认不出的段当 0，所以 "lts" 这类别名排在最后
    static func parts(_ s: String) -> [Int] {
        let t = s.hasPrefix("v") ? String(s.dropFirst()) : s
        var out = t.split(separator: ".").prefix(3).map { Int($0.prefix(while: { $0.isNumber })) ?? 0 }
        while out.count < 3 { out.append(0) }
        return out
    }

    static func major(_ v: String) -> Int { parts(v)[0] }

    static func expand(_ p: String, home: String) -> String {
        p == "~" ? home : p.hasPrefix("~/") ? home + String(p.dropFirst(1)) : p
    }

    /// `node --version` 的结果，如 "v22.11.0"；跑不出来返回 nil
    static func version(of node: String) -> String? {
        guard let out = run(node, ["--version"], timeout: 5) else { return nil }
        let v = out.trimmingCharacters(in: .whitespacesAndNewlines)
        return v.hasPrefix("v") && v.dropFirst().first?.isNumber == true ? v : nil
    }

    static func fromLoginShell() -> String? {
        guard let out = run("/bin/zsh", ["-lc", "command -v node"], timeout: 8) else { return nil }
        return out.split(separator: "\n").map(String.init).last(where: { $0.hasPrefix("/") })
    }

    /// 跑一个命令，拿 stdout。输出写进临时文件而不是管道：登录脚本里起了后台进程、把管道一直开着时，读管道会卡住
    static func run(_ exe: String, _ args: [String], timeout: TimeInterval) -> String? {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("ccb-node-\(UUID().uuidString)")
        guard FileManager.default.createFile(atPath: tmp.path, contents: nil), let fh = try? FileHandle(forWritingTo: tmp) else { return nil }
        defer { try? fh.close(); try? FileManager.default.removeItem(at: tmp) }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = args
        p.standardOutput = fh
        p.standardError = FileHandle.nullDevice
        p.standardInput = FileHandle.nullDevice
        do { try p.run() } catch { return nil }
        let deadline = Date().addingTimeInterval(timeout)
        while p.isRunning && Date() < deadline { usleep(20_000) }
        if p.isRunning { p.terminate(); return nil }
        guard p.terminationStatus == 0 else { return nil }
        return try? String(contentsOf: tmp, encoding: .utf8)
    }
}
