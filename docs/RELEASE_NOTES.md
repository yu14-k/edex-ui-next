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
**Gabriel "Squared" SAILLARD**（<https://gaby.dev>），见仓库 [LICENSE](LICENSE)。
本分支的修改同样以 GPL-3.0 发布。

Issues 与安全报告请提交到**本仓库**：
- Bug / 使用问题：<https://github.com/yu14-k/edex-ui-next/issues>
- 安全漏洞：见 [SECURITY.md](SECURITY.md)（请勿公开披露未修复漏洞）
