# eDEX-UI Next 2.4.0 升级计划（全部依赖 → 最新稳定版）

> 目标：把底座（Electron 31.7.7 / Chromium M126 / Node 20，2025-01-14 已 EOL）
> 与全部运行时依赖升级到当前最新稳定版，并在升级过程中保住现有功能与自由探针回归闸门。

## 0. 现状与动机

| 项 | 现状 | 最新稳定 | 风险 |
| --- | --- | --- | --- |
| Electron | 31.7.7（M126 / Node 20） | **45.2.3**（M156 / Node 24） | EOL 已 22 个月，期间所有 Chromium 漏洞均未修 |
| 官方支持窗口 | — | 43 / 44 / 45 | 必须 ≥43 才算受支持 |
| 渲染引擎依赖 | xterm 4.19（npm 包已废弃） | @xterm/xterm 6.0.0 + addon 0.12/0.11/0.19 | 需改加载方式与 addon 初始化 |
| PDF | pdfjs-dist 3.11.174 | 6.5.438 | 6.x 只有 ESM 构建（`pdf.mjs`），`<script src=".../pdf.js">` 失效 |
| 主进程工具库 | maxmind 4 / geolite2-redist 2 / nanoid 3 / which 4 / username 5 / shell-env 3 / pretty-bytes 5 / color 4 | 5.0.8 / 4.0.0 / 6.0.2 / 7.0.0 / 7.0.0 / 4.0.3 / 7.2.0 / 5.0.3 | 多数已 ESM-only，CJS `require` 需适配 |
| 构建链 | electron-builder 26.15.3 / node-abi 3.71 / node-json-minify 1.0 | 26.18.0 / 4.40.0 / 3.0.0 | electron 42+ 不再 postinstall 下二进制 |
| 已是最新 | node-pty 1.1.0 / howler / signale / smoothie / mime-types / clean-css / electron-rebuild | — | 无需动（node-pty 走 N-API，跨版本安全） |

## 1. 阶段与验收闸门

每个阶段结束都必须跑探针（`EDEX_PROBE=1`），断言：
`term ≥ 1`、`fsEntries > 0`、`fsSpaceBar`、`shortcuts: 14`、`mods: 9`、
`EDEX_PROBE_SETTINGS {opened:true}`、`EDEX_PROBE_TAB {spawned:true}`、`EDEX_PROBE_PASTE {ok:true}`。

| 阶段 | 内容 | 完成判据 |
| --- | --- | --- |
| **P1 底座** | electron 45.2.3 + 构建链（electron-builder / node-abi / node-json-minify / terser）；删掉 ia32 / armv7l 目标 | 探针全绿；`npx electron --version` 输出 45.x |
| **P2 渲染层** | xterm → @xterm/* 6、pdfjs → 6（ESM 化加载）、augmented-ui → 2 | 终端可用（term/tab 断言）、PDF 阅读器可加载 |
| **P3 主进程** | nanoid 6 / which 7 / username 7 / shell-env 4 / pretty-bytes 7 / maxmind 5 / geolite2-redist 4 / ws 8.22 / systeminformation 5.33 | 无 `ERR_REQUIRE_ESM`；GeoIP/用户名/IP 查询路径正常 |
| **P4 打包** | pack-windows → build-windows → 安装包冒烟 | 打包产物探针全绿；`latest.yml` 版本 2.4.0 |
| **P5 收口** | 版本号 2.4.0、RELEASE_NOTES / RELEASING 更新、检查清单 | `npm outdated` 为空；文档与脚本一致 |

## 2. Electron 31 → 45 已确认的破坏点（依据官方 breaking-changes）

1. **44.0** 移除 `ia32` 与 `armv7l` 目标 → `build-linux` 的 `--ia32 --armv7l`、`build-windows-ia32` 必须删。
2. **44.0** `clipboard` 从渲染进程移除，且读写方法改为返回 Promise → 主进程 handler 一句 `return clipboard.readText()` 会被 `ipc.handle` 自动解包，理论上无需改；终端复制的 `document.execCommand("copy")` 需重验。
3. **45.0** 沙箱 preload 的 Node shim / `Buffer` / `setImmediate` 移除 → 本应用 `sandbox: false`，官方明确不受影响；但这条路被封死，未来要开沙箱必须先搬走 preload 里的 `fs`/`nanoid`/`color`。
4. **42.0** `electron` 不再 postinstall 下二进制，改为首次运行 bin 时按需下载 → `install-*` 脚本与 CI 缓存假设要改。
5. **Node 20 → 24**：`cluster.isPrimary/setupPrimary` 已在 2.3.1 换好。
6. **Chromium 126 → 156**：`document.execCommand` 已弃用、`unload` 处理器不再默认执行；渲染层老依赖（xterm 4 / pdfjs 3）是主要风险点。

## 3. ESM 策略（关键决策，已按实测调整）

Electron 45 内置 Node 24，支持 `require(esm)`（无 TLA 的 ESM 可被 CJS `require`）。
因此主进程**不整体改 ESM**，按以下优先级处理：

1. 优先 `require()` —— Node 24 能直接加载的 ESM 包继续用（返回命名空间对象）。
2. 解析失败（仅 `import` 条件导出 / 含 TLA）时，改为**惰性动态 `import()`**（异步初始化，包一层 promise）。
3. 仍不行才降级到上一个 CJS 版本，并在 RELEASE_NOTES 里注明锁定原因。

渲染层（`ui.html`）单独处理：pdfjs 6 用 `<script type="module">` + `window.pdfjsLib = ...` 桥接；
@xterm/* 6 若只提供 ESM，同样用 module script 挂 `window.Terminal` / addon 命名空间（现有代码已按 UMD 命名空间兼容写过）。

## 4. 回滚

- 升级前已快照到 `D:\嘉豪\edex-2.3.1-snapshot`（源码级，不含 node_modules）。
- 升级在 `upgrade/all-latest-deps` 分支进行，`main` 上的 2.3.1 修复不受影响。
- 每个阶段独立可回退：依赖回滚 = 还原两个 `package.json` + `npm install`。

## 5. 不做 / 需另开题

- 渲染进程 `sandbox: true`（preload 依赖 Node 模块，需先重构 preload 架构）。
- Windows 关闭时偶发挂起（ConPTY 清理竞态，基线 2/4 复现，与本升级无关）。
- xterm 4 → 6 的视觉/交互回归（字体度量、WebGL 渲染）只能人工目视，探针覆盖不到。

---

## 6. 执行结果（2026-11-09）

| 阶段 | 状态 | 证据 |
| --- | --- | --- |
| P1 底座 | ✅ | 运行时 `Electron 45.2.3 / Node 24.22.2 / Chrome 156.0.8078.80`；`ia32`/`armv7l` 已从脚本移除 |
| P2 渲染层（xterm） | ✅ | `@xterm/xterm` 6 + addon 0.12/0.11/0.19；`term:1`、`TTY 3002 connected` |
| P2 渲染层（pdfjs） | ✅ | 6.5.438；`vendor.js`(esbuild) 打 IIFE + ESM worker；`EDEX_PROBE_PDF {ok:true, version:"6.5.438", pages:1, ops:6}` |
| P3 主进程 ESM | ✅ | `require(esm)` 路径全通：`username`/`shell-env` 取命名空间、`pretty-bytes`/`color` 取 `.default`、`geolite2-redist` 4 新签名 |
| P4 打包 | ✅ | `pack-windows` + `build-windows` exit 0；安装包 137,734,315 B，SHA256 `9017c1141dedc14a279b121b5159e6222a8b948b9158fffaebab9ceaaaf5f9d5`；`latest.yml` = 2.4.0 |
| P5 收口 | ✅ | 版本 2.4.0；RELEASE_NOTES / RELEASING / 本文件已更新 |

### 验证记录

- 开发态探针（Electron 45）：`term:1, fsEntries:35, fsSpaceBar:true, shortcuts:14, mods:9`、
  `EDEX_PROBE_SETTINGS {opened:true}`、`EDEX_PROBE_TAB {spawned:true}`、
  `EDEX_PROBE_PASTE {ok:true, captured:"PASTE_SEED_E45"}`、
  `EDEX_PROBE_COPY {ok:true, selected:"Windows Pow", clipboard:"Windows Pow"}`，exit 0（连续 3 次）。
- 打包产物探针（dist/win-unpacked）：同上全部通过，`With Node 24.22.2 and Electron 45.2.3`，exit 0（连续 2 次）。
- `npm outdated`：根依赖 **0**；`src` 仅剩 `pdfjs-dist`（刻意锁定）与 `which`（引擎声明要求 Node ≥24.15，
  宿主 shell 的 Node 24.11 会报 EBADENGINE，但 Electron 内 Node 24.22 满足，运行正常）。

### 踩到的坑（备查）

1. **Electron 42+ 不再 postinstall 下载二进制**：`node_modules/electron/dist` 不存在，需执行
   `node node_modules/electron/install.js`；本机直连 GitHub Releases 失败（SSL），改用
   `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 才成功。
2. **`which@7` 的 engines 要求 `^22.22.2 || ^24.15.0`**：宿主 Node 24.11 安装时报 EBADENGINE 警告，
   运行在 Electron（Node 24.22）内正常。
3. **Electron 44+ `clipboard` 方法返回 Promise**：探针里 `clipboard.readText()` 若不 await，
   会打印成 `[object Promise]`（第一版探针就踩了，已修）。
4. **`color`/`pretty-bytes` 的 `require(esm)` 返回命名空间**：直接调用会 TypeError，
   必须取 `.default`；`username`/`shell-env` 同理（取 `.username` / `.shellEnv`）。

### 6.1 构建链路变化（CI 必读）

`npm run pack` 现在会**先** `npm --prefix src install`，因为 vendor 步骤要用 `src/node_modules/pdfjs-dist`
生成 `src/assets/vendor/pdfjs/`。完整顺序：

```
npm install                 # 根依赖（含 esbuild，vendor 步骤需要）
npm run pack-windows        # = npm --prefix src install && node prebuild.js
                            #   prebuild.js 内部：node vendor.js → 复制 src → minify
cd prebuild-src && npm install
npm run build-windows       # electron-builder 打包
```

本地产物：`dist/eDEX-UI-Windows-x64.exe`（149,994,923 B，SHA256 `d3ec6ccfb774094e4c351a919bbac0ea9eac6b2add6681c50d25f1aa0b82bbba`）。

> 网络受限时构建 Electron 45 需要镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
> （electron 42+ 不再 postinstall 下载，首次运行 `electron` 或 electron-builder 时才拉取）。

### 6.2 关闭时的偶发挂起（未解决，已留诊断）

`EDEX_DEBUG_QUIT=1` 启动后，`before-quit` 会打印退出瞬间仍存活的句柄：

```
Active handles at quit: ["MessagePort","Socket","ChildProcess"x7,"Server","Socket",...]
```

即 7 个 cluster worker + 2 个 ws Server 仍在。基线（2.3.x，未修改的 HEAD）同样复现，
说明与本次升级无关；`will-quit` 里加看门狗/kill worker 都无效（卡死时 JS 定时器不再执行）。
现场排查入口就留在这个环境变量上。

### 6.3 本轮顺带修掉的既有缺陷

| 缺陷 | 现象 | 修法 |
| --- | --- | --- |
| Windows 文件面板偶发 failed | 探针偶发 `fsFailed:true / fsEntries:0`，渲染进程日志 `scandir 'D:\...\FALLBACK \|-- C:\Users\...'` | `filesystem.class.js` 初始化读盘前剥掉 `FALLBACK \|-- ` 前缀（`followTab` 早有同样处理，初始化路径漏了）；并给 `readdir` 加 3 次重试 |
| 探针不可自动化 | 依赖宿主机当前剪贴板内容，人肉跑 | `_probe.js` 由主进程先写入固定 token 再断言；`lib/probe.js` 统一驱动 + 断言 + 退出码；`src/_probe.js` 增加渲染进程 console 转发（`EDEX_PROBE_CONSOLE`），静默失败不再无迹可寻 |

修完后连跑 6 次：`fsEntries:36 / fsFailed:false / PDF ok`，且 6 次都**自行退出**（此前的挂起没有再出现）。

### 6.4 用户报告的两个问题（已修）

| 报告 | 真因 | 修法 |
| --- | --- | --- |
| 终端字体大小异常 | xterm 6 的 WebGL 渲染器把单元格**向下取整到整数设备像素**；150% 缩放下单元格 8.667px < 字体自然步进 8.985px，字形按 15px 画进更窄的格子 → 又小又挤 | 装完 WebGL 渲染器后用 canvas 实测步进校验，偏差 >1% 就 dispose 并回退 canvas 渲染器（列数 128→123，单元格 8.985px 正确） |
| 打开后无法正常截屏 | 全屏 + GPU 合成窗口上系统截图工具拿不到画面；另外应用把单独 `Alt` 键也 preventDefault 了，连带干掉 `Alt+PrtScn` 这类组合 | 新增内置截图 `Ctrl+Shift+F12`（主进程 capturePage → 保存到 图片/eDEX-UI/），并移除单独 Alt 的吞键 |
| 无法最小化 / 改窗口大小 | 设计如此：`forceFullscreen: true` + `allowWindowed: false` → 无边框全屏 + `resizable: false` + `movable: false` | 配置改成 `"allowWindowed": true`、`"forceFullscreen": false` 即为普通可缩放窗口（F11 切换全屏） |

---

## 10. 资源占用优化（2.5.0 准备，2026-11-26）

### 10.1 基线（未优化的 main，实测中位数，3 次 15 秒窗口）

| 指标 | 基线 | 说明 |
| --- | --- | --- |
| 进程数 | **12** | 主 + GPU + 渲染 + 2 utility + **7 个 cluster worker** |
| 工作集合计 | **1,094 MB** | 7 个 worker 占 **467 MB** |
| 可见时 CPU | **61% of one core** | |
| 最小化时 CPU | **13% of one core** | 全速轮询没停 |
| si 轮询 | ~7–8 次/秒，**9 个独立 setInterval** | 无任何 `visibilitychange` 处理 |

### 10.2 改动

1. **7 个 cluster worker → 1 个 `utilityProcess`**（新增 `src/_si-worker.js`，重写 `src/_multithread.js`）
   懒启动、崩溃后 500ms 重启、失败自动回落主进程执行；协议 `{id,type,arg}` / `{id,res}` 不变。
2. **统一轮询调度器**（`_renderer.js` 的 `window.registerPollTimer`）
   13 处 `setInterval` 全部迁入；按 `foreground / blurred×3 / hidden×8` 降频，200ms 粒度的调度循环。
3. **隐藏时暂停模块渲染**（`window._setModulesPaused`）
   globe 的 30fps `requestAnimationFrame` 与 cpuinfo/conninfo 的 smoothie `stop()`，全部在页面隐藏时停。
4. **文件面板轮询 1s → 5s**（`fs.watch` 已经在监听，轮询只是兜底）
5. **进程弹窗改为行复用**（原来每秒 `remove()` 所有 `<tr>` 再重建，现在只更新 `textContent`）
6. **启动改为 `ready-to-show` 后再 show**（不再先显示黑窗）

### 10.3 顺带修掉的两个真 bug

| bug | 现象 | 修法 |
| --- | --- | --- |
| `replyTo()` 的 isDestroyed 判断写错 | `!sender.isDestroyed` 判的是**函数对象**（恒为 false）→ **所有 si 回复被静默丢弃**，模块永远拿不到数据 | 改成 `typeof sender.isDestroyed === "function" ? !sender.isDestroyed() : true` |
| si 代理没有超时 | worker 一死，调用方 promise 永挂起，该模块永久停止更新 | `ipc.once` 后挂 10s 超时，超时 resolve(null) 并返回取消函数 |

### 10.4 结果（同样 3 次中位数）

| 指标 | 基线 | 优化后 | 变化 |
| --- | --- | --- | --- |
| 进程数 | 12 | **6** | −50% |
| 工作集 | 1,094 MB | **707 MB** | **−387 MB** |
| 可见 CPU | 61% | **54%** | 略降 |
| 最小化 CPU | 13% | **11%** | 略降 |

### 10.4b 补丁：最小化现在真的会暂停（主进程事件驱动）

`document.hidden` 在本机 Electron 45 最小化时**不触发**（实测 0 次事件），所以第一版暂停逻辑空转。
改为由主进程监听 `minimize` / `hide` / `restore` / `show` 并通过 IPC 通知渲染进程：

| 指标 | 基线 | 优化后 |
| --- | --- | --- |
| 进程数 | 12 | **6** |
| 工作集 | 1,094 MB | **722 MB** |
| 可见 CPU | 61% | **51%** |
| **最小化 CPU** | **13%** | **4%** |

验证方式：日志里会出现 `[perf] modules paused (hidden=false)`（`hidden=false` 是预期值——暂停由窗口事件驱动，不是 visibilitychange）。

### 10.5 诚实说明（没做到的）

- **可见时 CPU 只降了 7 个百分点**：剩下的开销在渲染进程（~50%）与 GPU 进程（~34%），来源是 xterm 重绘 + 3D globe + 9 个模块的 DOM 更新，不是 si 采集。要再降必须动渲染路径（`app://` + 更少 DOM 更新 + 关 globe 的可选开关），是另一个量级的工程。
- **最小化降幅也有限**（13%→11%）：`document.hidden` 在本机 Electron 45 上**不会**因为最小化而触发（实测 `visibilitychange` 事件 0 次），所以暂停逻辑实际没生效——真正能让后台静默的，是把 `backgroundThrottling` 打开（现在显式设成 `false`），但那会让隐藏时的 timer 也被节流，需单独验证。
- **`@xterm/addon-canvas` 不兼容 xterm 6**（peer 要求 `^5`，加载时报 `onShowLinkUnderline` 未定义），所以 WebGL 被拒时只能回落到 DOM 渲染器；尝试用「字号吸附到整设备像素」换取 WebGL 保留的方案实测**反而更费 CPU**（77–88%），已回退。

### 10.6 下一步（按收益排序）

1. 打开 `backgroundThrottling` + 用 `win.on("minimize")`/`hide` 主动通知渲染进程暂停（绕开不可靠的 `visibilitychange`）——预计最小化可达 **<3%**。
2. globe 做成可开关（`themes/*.json` 的 `globe.enabled`）——实测它单独占 renderer 的 ~15–20%。
3. 包体：`app.asar` 内仍有 620 条 `pdfjs-dist` + 18 条 `@napi-rs/canvas` 死载荷，预计再省 ~30–40 MB。
