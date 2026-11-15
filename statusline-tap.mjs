#!/usr/bin/env node
/**
 * [INPUT]: 依赖 Claude Code 往状态栏命令的 stdin 里给的 JSON（session_id、rate_limits）；依赖环境变量 CCBOARD_DATA（数据目录，默认和服务一样）和可选的 CCBOARD_ACCOUNT（这个会话是用哪个号开的）。
 * [OUTPUT]: 往 <数据目录>/limits/claude-<session_id>.json 写 { v, at, session, account, rate_limits }；往 stdout 打一行 `ben · 5h 6% · 7d 1%`（没有 rate_limits 就什么也不打）。永远退出码 0，出什么错都不往终端吐。
 * [POS]: Claude 周额度的取数口。Claude Code 不把额度写进对话记录，只在状态栏 JSON 里给，所以挂成状态栏命令（settings.json 的 statusLine）。
 *        只存 rate_limits 两个窗口的百分比和截止时间，不存状态栏 JSON 里的其它东西（路径、费用、模型、对话内容），不读登录凭据，不联网。
 *        文件名由 limits.mjs 的 tapFile() 定，汇总也在 limits.mjs；这里只管写。10 秒内同样的数据不重写，会话在流式输出时状态栏刷新得很勤。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pct = (w) => (w && typeof w.used_percentage === 'number' ? Math.round(w.used_percentage) + '%' : '');

async function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const rl = input && input.rate_limits; if (!rl || typeof rl !== 'object') return;
  const five = rl.five_hour, seven = rl.seven_day; if (!five && !seven) return;
  const account = /^[\w.@-]{1,40}$/.test(process.env.CCBOARD_ACCOUNT || '') ? process.env.CCBOARD_ACCOUNT : null;
  const dir = path.join(process.env.CCBOARD_DATA || path.join(os.homedir(), 'Library/Application Support/cc-board'), 'limits');
  try {
    const { tapFile } = await import('./limits.mjs');
    const file = tapFile(dir, input.session_id);
    if (file) {
      const keep = {}; if (five) keep.five_hour = { used_percentage: five.used_percentage, resets_at: five.resets_at }; if (seven) keep.seven_day = { used_percentage: seven.used_percentage, resets_at: seven.resets_at };
      const body = JSON.stringify({ v: 1, at: Date.now(), session: input.session_id, account, rate_limits: keep });
      let fresh = false;
      try { const st = fs.statSync(file); fresh = Date.now() - st.mtimeMs < 10000 && JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), at: 0 }) === JSON.stringify({ ...JSON.parse(body), at: 0 }); } catch {}
      if (!fresh) { fs.mkdirSync(dir, { recursive: true }); const tmp = file + '.tmp' + process.pid; fs.writeFileSync(tmp, body, { mode: 0o600 }); fs.renameSync(tmp, file); }
    }
  } catch {}
  process.stdout.write([account, pct(five) && '5h ' + pct(five), pct(seven) && '7d ' + pct(seven)].filter(Boolean).join(' · '));
}
main().catch(() => {});      // 不调 process.exit：管道里的输出还没写完就退出会被截断；自然退出码就是 0
