/**
 * [INPUT]: 依赖 playwright-core（devDependency）；可选环境变量 CCBOARD_CHROMIUM（浏览器可执行文件的路径）；缓存目录 ~/Library/Caches/ms-playwright 里的 headless shell
 * [OUTPUT]: 导出 launch()（静音无头 Chromium）、browserPath()、sleep()
 * [POS]: test/ui-check.mjs 唯一的浏览器入口。不碰真实的 Chrome，不出声。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { chromium } from 'playwright-core';

// 三个静音参数都带：只带 --mute-audio 时，系统仍会打开音频输出设备
const MUTE = ['--mute-audio', '--disable-audio-output', '--disable-speech-api'];

// ~/Library/Caches/ms-playwright 里版本号最大的 headless shell；没有就返回 null
function cachedShell() {
  const root = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  let dirs = [];
  try { dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')); } catch { return null; }
  dirs.sort((a, b) => parseInt(b.split('-')[1], 10) - parseInt(a.split('-')[1], 10));
  for (const d of dirs) {
    const base = path.join(root, d);
    for (const sub of fs.readdirSync(base)) {
      const exe = path.join(base, sub, 'chrome-headless-shell');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

// 顺序：环境变量 → 缓存里最新的 headless shell → undefined（交给 playwright 自己找）
export function browserPath() {
  return process.env.CCBOARD_CHROMIUM || cachedShell() || undefined;
}

export async function launch({ args = [], ...rest } = {}) {
  return chromium.launch({ headless: true, executablePath: browserPath(), args: [...MUTE, ...args], ...rest });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
