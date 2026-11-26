# eDEX-UI Next

> 这是 [GitSquared/edex-ui](https://github.com/GitSquared/edex-ui) 的社区分支（fork）。
> 上游原项目已于 2021-10 归档；本分支已迁移到 **Electron 31** 并完成安全加固，继续维护。
> This is a community fork of eDEX-UI, migrated to Electron 31 with security hardening.

---

## 下载 / Downloads

| 平台 | 文件 |
| --- | --- |
| **Windows x64** | `eDEX-UI-Windows-x64.exe`（NSIS 安装包） |
| **Linux x64** | `eDEX-UI-Linux-x86_64.AppImage`（无需安装，`chmod +x` 后直接运行） |

---

## ⚠️ Windows 用户必读：安装包未签名（SmartScreen 提示）

本项目的安装包**没有购买代码签名证书**，因此首次运行时 Windows 很可能弹出：

> **“Windows 已保护你的电脑”** / *“Windows protected your PC”*

这是**未签名程序的正常现象，不代表文件有问题**。继续安装的方法：

1. 点击提示框里的 **「更多信息」**（*More info*）；
2. 点击出现的 **「仍要运行」**（*Run anyway*）。

如果「更多信息」没有出现，说明文件可能来自不完整的下载，请重新下载或按下方方法核对校验和。

> 如果你不希望放开 SmartScreen 限制，也可以**直接从源码构建**（见仓库 README 与 `docs/RELEASING.md`），或使用下方 SHA256 校验后再运行。

### 核对下载是否完整（推荐）

每次发布都会附带 `SHA256SUMS.txt`。在 Windows PowerShell 中执行：

```powershell
Get-FileHash .\eDEX-UI-Windows-x64.exe -Algorithm SHA256
```

将输出与 `SHA256SUMS.txt` 中对应文件的值比较，**一致即表示文件完整且未被篡改**。

---

## 🐧 Linux 用户说明

```bash
chmod +x eDEX-UI-Linux-x86_64.AppImage
./eDEX-UI-Linux-x86_64.AppImage
```

- 若提示缺少 FUSE 或无法挂载（部分发行版默认不预装 FUSE），可改用：
  ```bash
  ./eDEX-UI-Linux-x86_64.AppImage --appimage-extract-and-run
  ```
- AppImage 同样**未签名**，可用 `sha256sum -c SHA256SUMS.txt` 校验。

---

## 本次更新内容 / What's new

### v2.6.0（可定制化 / customization）

把「布局、主题、模块」从写死在代码里，变成**声明式、可校验、可热切换**。不配置就跟以前完全一样。

- **布局可配置（`layout.json`）**
  模块显示在哪一列、列内的顺序、左右列宽、终端宽度，全部由用户数据目录下的
  `layout.json` 决定。未知模块名会被丢弃并告警、越界宽度会被钳制、全部模块移除会恢复默认
  —— 手改配置不会白屏。首次启动自动生成这个文件。
- **设置面板新增 Layout 分区**
  可直接改左右列宽 / 终端宽度（保存后立即生效）、每列的模块列表（需重启）、
  一键打开 `layout.json`。
- **主题热切换（不再整页重载）**
  以前换主题要 `location.reload()`，终端会重连、scrollback 丢失。现在配色就地应用：
  xterm 配色、曲线描边、文件面板图标色全部即时更新，终端连接保持存活。
  唯一例外是 3D 地球（配色烘在引擎实例构造参数里，重建会丢连接 pin），它会明确标记为「需重启」。
- **Profile（`profiles/<name>.json`）**
  一个 profile = 主题 + 键盘布局 + 布局配置。`Ctrl+Shift+O` 打开切换器：列出、应用、
  从当前状态新建。主题与列宽立即生效，模块/键盘变化会提示需要重启。
- **schema 校验进 CI**
  新增 `schemas/theme.schema.json`、`kb_layout.schema.json`、`layout.schema.json`，
  `npm test` 用 ajv 校验 **21 套主题 + 19 套键盘布局**，并断言布局归一化行为。
  改坏任何一套主题，CI 会指出具体文件与字段。
- **修复内置损坏文件**：`en-WORKMAN.json` 从上游继承下来就缺末尾闭合括号，
  因为从未被校验过所以一直没暴露。2.6.0 修好了，并把检查加进了 CI。
- **修复 preload 缺 `mkdirSync`**：2.5.0 的「移除未用 fs 成员」清理把它删掉，
  导致 `profiles/` 目录无法按需创建——探针做 profile 往返测试时才暴露。

探针新增 3 项断言：布局是否真的套到 DOM、主题热切换是否保活终端、profile 往返是否还原。

### v2.5.0（资源占用与包体优化 / performance）

只做减法，界面与功能完全不变：

- **采集进程 7 → 1**
  `systeminformation` 原由 7 个 `cluster` 完整 Node 进程采集（每个 65–72 MB 工作集），
  而这类调用是 syscall/IO 密集，并发没有吞吐收益。现统一为单个 `utilityProcess`：
  懒启动（首次调用才创建）、崩溃后 500ms 自动重启、不可用时自动回落主进程执行。
- **隐藏/最小化时真的停下来**
  9 个模块各自带着 `setInterval` 全速轮询，且没有任何可见性处理。现在统一到一个调度器，
  按「前台 / 失焦×3 / 隐藏×8」降频；3D 地球的 30fps 动画与 CPU/网络曲线在窗口不可见时暂停。
  由于本机 Electron 最小化时不派发 `visibilitychange`，暂停开关由主进程的
  `minimize`/`hide`/`restore`/`show` 事件驱动。
- **两处 DOM 抖动**
  进程详情弹窗原本每秒删除并重建全部 `<tr>`（现改为行复用 + `textContent` 更新）；
  文件面板的 1 秒轮询是冗余的（`fs.watch` 已覆盖变更），降为 5 秒兜底。
- **启动不再先显示黑窗**：改为 `ready-to-show` 后再显示窗口。
- **包体 137.7 → 125.6 MB**
  `pdfjs-dist`（35.9 MB，运行期只用 vendor 出去的副本）与它连带的 `@napi-rs/canvas`（38 MB）、
  以及 node-pty 整包解包带出的 80 MB `.pdb` 调试符号，都不再进安装包。
- **修复**：si 回复的存活判断误写成对函数对象取反（恒为 false），导致所有回复被静默丢弃；
  si 调用补上 10 秒超时，worker 异常时不再让模块永久停更。

实测（同一机器 3 次中位数，15 秒窗口）：

| 指标 | 优化前 | 优化后 |
| --- | --- | --- |
| 进程数 | 12 | **6** |
| 工作集 | 1,094 MB | **731 MB** |
| 可见时 CPU | 61% 单核 | **56%** |
| 最小化 CPU | 13% 单核 | **4%** |
| 安装包 | 137.7 MB | **125.6 MB** |

已知限制：可见时的主要开销在渲染进程（xterm 重绘 + 3D 地球 + 模块 DOM 更新）与 GPU 进程，
不在采集侧；要再降需要动渲染路径，见 `docs/UPGRADE_2.4.0.md` §10.5。

### v2.4.0（底座与全部依赖升级 / engine + dependency refresh）

- **Electron 31.7.7 → 45.2.3**（Chromium M126 → **M156**，Node 20.18 → **24.22**）
  31 的官方 EOL 是 2025-01-14，此前一直运行在无安全补丁的引擎上；现在落在官方支持窗口内。
  升级过程中按官方 breaking changes 处理：`ia32` / `armv7l` 目标已在新版移除（`build-linux`
  收敛为 `--x64 --arm64`，删除 `build-windows-ia32`）；`electron` 42+ 不再在 postinstall 下载二进制，
  改为首次运行按需下载（受限网络可用 `ELECTRON_MIRROR`）。
- **终端渲染层 xterm 4.19 → `@xterm/xterm` 6.0.0 + `@xterm/addon-attach|fit|webgl` 新版**
  旧 `xterm` npm 包已废弃；六个 UMD 全局（`Terminal` / `FitAddon` / `AttachAddon` / `WebglAddon`）保持不变，
  只改资源路径。
- **剪贴板改为全链路走主进程桥**
  Electron 44 移除了渲染进程的 `clipboard` 模块并把读写方法改为返回 Promise。终端复制此前依赖
  `document.execCommand("copy")`，现改为 `services.clipboard.writeText()`（新增
  `edex:clipboard:writeText` IPC），粘贴继续走 `readText()`。
- **主进程 ESM-only 依赖适配**（Node 24 的 `require(esm)`）：`username` 7、`shell-env` 4、
  `pretty-bytes` 7、`color` 5、`nanoid` 6、`geolite2-redist` 4 的导入方式与调用签名已更新
  （`geolite2-redist` 4 的 `downloadDbs` 改为接收 `{ path, dbList }` 选项对象）。
- **PDF 渲染 pdfjs-dist 3.11 → 6.5.438（新增 `vendor` 预打包步骤）**
  pdfjs 6 只发布 ESM 构建，而 Chromium 在 `file://` 页面拒绝执行 **module script**（源不透明/CORS）。
  实测结论：同一页面下 module **worker** 可用、module **script** 不可用。因此新增 `npm run vendor`
  （`vendor.js` + esbuild）把 `pdf.mjs` 打成经典 IIFE（挂 `window.pdfjsLib`），
  保留 worker 为 ESM 供 `new Worker(..., {type:"module"})` 使用，并把 `cmaps` / `standard_fonts` / `wasm`
  一同复制到 `src/assets/vendor/pdfjs/`（生成物，已 gitignore，`pack` 会自动重建）。
- **其余依赖升至最新稳定版**：maxmind 5.0.8、ws 8.22.2、systeminformation 5.33.19、
  which 7.0.0、augmented-ui 2.0.0、electron-builder 26.18.0、node-abi 4.40.0、node-json-minify 3.0.0、terser 5.51.2。
  `node-pty` 1.1.0 已是最新（N-API，跨 Electron 版本无需重编）。
- **已知例外**：无。所有运行时依赖均已升级到 npm 最新稳定版。
- **修复：终端字体明显偏小/字距挤压（高分屏）**
  xterm 6 的 WebGL 渲染器会把字符网格**向下取整到整数设备像素**。在 150%/125% 缩放的屏幕上，
  单元格因此比字体本身的自然步进窄 3–4%，而字形仍按配置字号绘制，结果是文字看起来又小又挤。
  现在装载 WebGL 渲染器后会拿画布实测步进做校验，偏差超过 1% 就弃用该渲染器、回退到精确测量的
  canvas 渲染器（实测列数由 128 变为 123，单元格 8.667 → 8.985 px，与 15px Fira Mono 一致）。
- **新增：内置截图（`Ctrl+Shift+F12`）**
  全屏 + GPU 合成窗口上，系统截图工具经常只能拿到黑屏或错误画面。现在应用可以直接自截：
  主进程 `webContents.capturePage()` → 保存到 `图片/eDEX-UI/eDEX-UI_<时间戳>.png`，并弹窗给出路径。
  同时移除了对单独 `Alt` 键的全局吞键（它让 `Alt+PrtScn` 之类的系统组合失效）。
- **修复：快捷键配置可能导致整个 UI 起不来**
  屏幕上键盘按「修饰键组合」分类，`shortcuts.json` 里若出现无修饰键的条目（例如我刚加的 `F12`），
  `_shortcuts[""]` 为 undefined → 构造键盘时抛错 → 整个渲染进程停在初始化。
  现在会跳过该条目并告警，不再拖垮启动；并且新版本新增的默认快捷键会自动合并进已有配置文件。
- **修复：Windows 上文件面板偶发进入 failed 状态**
  Windows 没有 TTY 工作目录跟踪，终端会把 `FALLBACK |-- <路径>` 这个**显示标签**写进 `cwd`，
  文件面板初始化时直接拿它当真实路径去 `readdir`，于是整块面板变成
  “CANNOT ACCESS CURRENT WORKING DIRECTORY”。现在初始化路径会先剥掉该前缀（与 `followTab`
  的既有处理一致），并对 `readdir` 的瞬时失败做 3 次重试。
- **回归验证**：探针新增三项断言——`EDEX_PROBE_COPY`（渲染 → 主进程剪贴板写入回路）、
  `EDEX_PROBE_PASTE`（主进程 → 渲染读取回路）与 `EDEX_PROBE_PDF`（用内置的最小 PDF 走一遍
  pdfjs 6 + module worker 的真实解析链路）；开发态与打包产物均通过
  `term / fsEntries / fsSpaceBar / shortcuts / settings / tab / paste / copy / pdf` 全部检查。

### v2.3.1（安全修复补丁 / security patch）

- **修复：终端 WebSocket 暴露到局域网（高危）**
  终端后端的 WebSocket 服务此前未指定监听地址，`ws` 默认绑定所有网卡（`::`），
  同网段的任意主机都能连上 `ws://<主机>:3000`（以及附加终端 3002–3005）直接接管当前用户的 shell。
  现固定绑定 `127.0.0.1`，并新增 Origin 校验：只接受本应用 `file://` 页面发起的握手，
  浏览器页面（任意网站的 `ws://127.0.0.1` 探活）一律拒绝。
- **修复：`Ctrl+Shift+V` 粘贴失效**
  迁移移除 `@electron/remote` 后，粘贴路径仍引用不存在的 `remote` 全局，快捷键必定抛 `ReferenceError`。
  现改走 preload 白名单桥（`services.clipboard.readText()`，异步 + 失败兜底）。
- **修复：新窗口拦截失效（`new-window` 死代码）**
  `new-window` 事件在 Electron 25 已被移除，原来的“禁止创建新窗口”实际未生效。改用 `setWindowOpenHandler`
  一律 `deny`，仅把 `http(s)` 链接交给系统浏览器打开。
- **修复：文件浏览器的磁盘用量条不再显示**
  早前的安全加固把字符串 `onclick` 换成了 `addEventListener`，但 `renderDiskUsage()` 仍在检查
  `onclick` 属性（恒为 `null`）而提前返回，导致用量条永远停在 “Calculating available space…”；
  该路径在文件面板进入失败/分离状态时还会抛 `Cannot read properties of null (reading 'getAttribute')`。
  两处都已修正，并在为空节点时安全跳过。
- **加固**：退出流程对未初始化的终端做判空（启动早期失败后退出不再二次崩溃）；
  DevTools 默认关闭，仅在 `EDEX_DEBUG=1` 时可用；主题/键盘热切换与日志 IPC 补齐发送方白名单；
  preload 移除渲染进程未使用的 `fs` 成员（`stat`/`lstat`/`statSync`/`mkdirSync`）。
- **健壮性**：`settings.json` / `shortcuts.json` / `lastWindowState.json` / `versions_log.json`
  被写坏时不再阻断启动——自动备份为 `*.bak` 并回退默认值（主进程与渲染进程两侧都做了容错）。
- **构建**：新增跨平台 `prebuild.js`（`npm run pack` / `pack-windows` / `pack-linux` / `pack-darwin`），
  替换只支持单一平台的 `rsync` / `xcopy` / `mkdir` / `rmdir` 片段，且可重复执行。
  注意脚本已改名：旧的 `prebuild-*` 会被 npm 当成 `build-*` 的 pre-hook 而重复预构建。
  根 `package.json` 的构建期依赖改为 `devDependencies`；`cluster.isMaster` / `setupMaster`
  换用 `isPrimary` / `setupPrimary`（带旧运行时回退）。

### v2.3.0

- **升级到 Electron 31.7.7**（原版为 Electron 12，已停止维护）
- **安全加固**
  - 渲染进程改为 `contextIsolation: true` + 白名单 preload 桥，移除 `nodeIntegration`
  - 移除 `@electron/remote`，改用受限 IPC（含发送方白名单与入参校验）
  - 清理 DOM 注入点（进程名、文件名、硬件信息等统一转义）
  - 收紧 CSP（`script-src file:`，禁用内联脚本；新增 `object-src`/`base-uri` 限制）
- **稳定性修复**
  - 修复多线程模块在 worker 退出时可能崩溃整个应用的问题（EPIPE / 子进程错误事件）
  - 修复“启动动画”路径下的崩溃（沙箱环境缺少 `__dirname`）
  - 修复设置面板无法打开、新建终端标签崩溃等问题
- **其他**：清理不再使用的依赖、修复压缩/打包脚本、移除失效的子模块配置

---

## 已知限制 / Known limitations

- 目前只提供 **Windows x64** 与 **Linux x64**；**暂无 macOS 构建**（缺少构建环境，欢迎 PR）。
- 二进制**未签名**：Windows 会提示 SmartScreen，macOS（若有构建）会提示未公证。
- 自动更新未启用，请从本仓库 Releases 手动下载新版本。

---

## 许可 / License

本项目沿用 **GPL-3.0**。原始版权归原作者
**Gabriel "Squared" SAILLARD**（<https://gaby.dev>），见仓库 [LICENSE](https://github.com/yu14-k/edex-ui-next/blob/HEAD/LICENSE)。
本分支的修改同样以 GPL-3.0 发布。

Issues 与安全报告请提交到**本仓库**：
- Bug / 使用问题：<https://github.com/yu14-k/edex-ui-next/issues>
- 安全漏洞：见 [SECURITY.md](https://github.com/yu14-k/edex-ui-next/blob/HEAD/SECURITY.md)（请勿公开披露未修复漏洞）
