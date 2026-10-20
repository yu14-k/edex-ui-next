# 发布指南（RELEASING）

本文件说明如何用 GitHub Actions 为 **eDEX-UI（Electron 31 分支）** 自动产出 Windows 与 Linux 的安装包，
以及发布时需要遵守的许可与署名要求。

工作流文件：[`.github/workflows/build-binaries.yaml`](../.github/workflows/build-binaries.yaml)

---

## 1. 触发条件一览

| 事件 | 是否构建 | 是否发布 Release |
| --- | --- | --- |
| push 到任意分支 | ✅ Windows x64 (NSIS) + Linux x64 (AppImage) | ❌ 只上传 artifact |
| Pull Request | ✅ 同上 | ❌ 只上传 artifact |
| push `v*` 标签（如 `v2.2.9`） | ✅ 同上 | ✅ 创建 Release 并附加安装包 |
| 手动 `workflow_dispatch` | ✅ 同上（额外构建 macOS dmg） | ❌（除非同时针对 tag 运行） |

工作流默认权限为 `contents: read`，只有 `release` job 提升为 `contents: write`，
因此普通 push / PR **不可能**误发布。

---

## 2. 发布一个新版本

发布前请确认（这几项由项目维护者负责，不在工作流职责内）：

1. `package.json` 与 `src/package.json` 两处 `version` 已改成新版本号，且两者一致。
   electron-builder 用 `package.json` 的 `version` 命名 Release 与更新元数据，
   标签与版本号不一致会让自动更新指向错误版本。
2. 构建顺序相关文件未被破坏：`prebuild-src` 必须由 `npm run prebuild-windows` / `prebuild-linux`
   生成（先复制 `src/` → 跑 `prebuild-minify.js` → 再 `npm install`），顺序不可颠倒。
3. 待发布提交已推到远端默认分支。

打标签并推送（标签必须以 `v` 开头，否则 workflow 不会触发 release job）：

```bash
git tag -a v2.2.9 -m "eDEX-UI 2.2.9"
git push origin v2.2.9
```

推送后：

1. `build-windows`、`build-linux` 两个 job 并行构建并各自上传 artifact；
2. 两者成功后，`release` job 下载全部 artifact，用 `softprops/action-gh-release@v2`
   创建 Release 并附加产物；
3. 在仓库的 **Releases** 页面确认产物已挂上。

含连字符的标签（如 `v2.3.0-beta.1`）会被自动标记为 **pre-release**。

> 若某个 job 失败：Release 不会创建（`release` 依赖 `build-windows` 与 `build-linux` 全部成功）。
> 修复后删除并重新推送同名标签，或手动运行一次工作流即可。

---

## 3. 产物在哪里

### 3.1 CI artifact（每次运行都有）

运行结束后在 Actions 运行页面的 **Artifacts** 区域下载：

| Artifact 名称 | 内容 | 文件 |
| --- | --- | --- |
| `Windows-Installer` | Windows x64 NSIS 安装包 + 更新元数据 | `eDEX-UI-Windows-x64.exe`、`*.exe.blockmap`、`latest.yml` |
| `Linux-AppImage` | Linux x64 AppImage + 更新元数据 | `eDEX-UI-Linux-x64.AppImage`、`latest-linux.yml` |
| `macOS-Image` | 仅手动触发时存在 | `eDEX-UI-macOS-x64.dmg` |

### 3.2 GitHub Release（仅 tag 触发）

Release 附件即上表中的安装包与元数据（`*.exe`、`*.AppImage`、`*.blockmap`、`*.yml`）。
`latest.yml` / `latest-linux.yml` 是 electron-builder 的自动更新元数据，
**不要删除**，应用内的更新检查依赖它们。

### 3.3 产物命名规则

| 平台 | 文件名 | 来源配置 |
| --- | --- | --- |
| Windows x64 | `eDEX-UI-Windows-x64.exe` | `build.nsis.artifactName` + `build.win.target.arch = x64` |
| Linux x64 | `eDEX-UI-Linux-x64.AppImage` | `build.appImage.artifactName` |
| macOS x64 | `eDEX-UI-macOS-x64.dmg` | `build.dmg.artifactName` |

---

## 4. 安装时的用户提示（非缺陷）

### Windows：SmartScreen 警告

当前 Release **未做代码签名**，用户首次运行 `eDEX-UI-Windows-x64.exe` 时会看到
「Windows 已保护你的电脑」（SmartScreen）。这是未签名安装包的预期行为，不是构建失败。

- 用户操作：**更多信息 → 仍要运行**。
- 企业环境可能被策略直接拦截，无法绕过。
- 想消除提示需要代码签名证书，在 workflow 中提供 `CSC_LINK` / `CSC_KEY_PASSWORD`
  两个 Secret 即可（本仓库目前未配置）。证书为付费资源，请勿在文档或仓库中提交私钥。

### Linux：AppImage 权限与 FUSE

```bash
chmod +x eDEX-UI-Linux-x64.AppImage
./eDEX-UI-Linux-x64.AppImage
```

- 部分发行版缺少 FUSE（常见于容器、WSL），可改用
  `./eDEX-UI-Linux-x64.AppImage --appimage-extract-and-run`。
- AppImage 的体积与启动依赖宿主的 glibc；过旧的发行版可能无法运行。

### macOS：Gatekeeper（仅手动构建产物）

dmg 未签名也未公证，首次打开需右键 → 打开，或执行
`xattr -dr com.apple.quarantine /Applications/eDEX-UI.app`。

---

## 5. 许可与署名要求（重要）

本项目是 **Gabriel "Squared" SAILLARD 的 [GitSquared/edex-ui](https://github.com/GitSquared/edex-ui) 的分支**，
上游以 **GPL-3.0** 许可发布，本分支沿用 GPL-3.0。发布时必须满足以下要求：

1. **保留版权与许可声明**：不得删除或修改 `LICENSE`、
   `package.json` 中的 `license` 与 `build.copyright` 字段，以及源码文件头部的版权注释。
2. **提供对应源码**：GPL-3.0 要求向二进制接收者提供对应的完整源码。
   发布 Release 时请确保对应的源码标签（本次的 `v*` tag）在同一仓库可见，
   并在 Release 说明中给出链接。
3. **标注修改**：GPL-3.0 要求标明修改过的文件与修改内容。发布说明中应写明本分支
   的主要改动，例如：从 Electron 12 迁移到 Electron 31.7.7、启用
   `contextIsolation` 与 preload 桥接的安全加固、Windows 目标架构收敛为 x64。
4. **不得更换许可证**：本分支的衍生发布不得改为非 GPL 兼容的许可证，
   也不能对 GPL 授予的权利附加额外限制。
5. **Release 说明（已自动化）**：

   Release 正文使用固定模板 **`docs/RELEASE_NOTES.md`**，CI 在打 tag 时会通过
   `body_path` 自动写入，无需手工编辑。模板中已包含：

   - 下载表（Windows x64 / Linux x64）
   - **Windows 未签名 → SmartScreen「更多信息 → 仍要运行」的处理步骤**
   - Linux AppImage 的 `chmod +x` 与无 FUSE 时的 `--appimage-extract-and-run` 用法
   - 校验方法（`Get-FileHash` / `sha256sum -c`）
   - 本次改动摘要、已知限制、GPL-3.0 许可与署名

   > 每次发布前如需更新「本次更新内容」，直接编辑 `docs/RELEASE_NOTES.md` 即可（保持版本无关的措辞）。

6. **校验和（已自动化）**：

   `release` job 会生成 `SHA256SUMS.txt` 并作为附件上传，供用户核对未签名二进制。
   手动发布时可在 `dist/` 下自行生成：

   ```powershell
   # Windows
   Get-FileHash .\eDEX-UI-Windows-x64.exe -Algorithm SHA256
   ```
   ```bash
   # Linux
   sha256sum eDEX-UI-Linux-x86_64.AppImage
   ```

   GPL-3.0 署名要求（供参考）：

   > 本版本基于 GitSquared/edex-ui（GPL-3.0，© Gabriel "Squared" SAILLARD）修改而来。
   > 主要改动：升级至 Electron 31.7.7；启用 contextIsolation + preload 安全桥；
   > Windows 仅提供 x64 安装包。完整源码见本仓库 `vX.Y.Z` 标签。
   > 本程序为自由软件，按 GPL-3.0 分发，不提供任何担保。

---

## 6. 架构选择与已知取舍

- **Windows**：默认只构建 **x64**。不要在同一次 electron-builder 调用里同时构建 x64 与 ia32，
  否则 `verifyInstallerSize` 会把两个架构的载荷求和后与单包大小比较而误报失败。
  需要 32 位时单独执行 `npm run build-windows-ia32`（并为其单独上传 artifact）。
- **Linux**：默认只构建 **x64 AppImage**。仓库的 `npm run build-linux` 会同时构建
  ia32/arm64/armv7l，需要 multilib 与 QEMU，成本高且容易失败，工作流改为直接调用
  `electron-builder build -l --x64 --publish never`。
  需要 arm64 时建议新增独立 job，先安装 `docker/setup-qemu-action@v3`（`platforms: arm64`），
  再在 arm64 容器里构建，避免污染 x64 job。
- **macOS**：`build-darwin` 仅在手动触发时运行，且**不参与 Release**；
  如需在 Release 中附带 dmg，把 `build-darwin` 加入 `release` 的 `needs` 列表。

### 网络受限环境的镜像兜底

GitHub 托管 runner 直连官方源即可，无需设置。自建 runner 或网络受限时可启用：

```yaml
env:
  ELECTRON_MIRROR: https://npmmirror.com/mirrors/electron/
  ELECTRON_BUILDER_BINARIES_MIRROR: https://npmmirror.com/mirrors/electron-builder-binaries/
```

---

## 7. 本地复现 CI 构建

```bash
# 根依赖（terser、clean-css、node-json-minify、electron-builder）
npm install

# Windows（PowerShell / cmd）
npm run prebuild-windows
npm run build-windows

# Linux（含 WSL）
npm run prebuild-linux
./node_modules/.bin/electron-builder build -l --x64 --publish never
```

注意事项：

- `prebuild-*` 脚本内部会 `cd prebuild-src` 并执行 `npm install`，这是**必需**的一步，
  `dist/` 与 `prebuild-src/` 均已在 `.gitignore` 中，不会被提交。
- 本地重复构建前先删掉 `prebuild-src` 与 `dist`（Windows 上 `prebuild-windows` 用 `mkdir`，目录已存在会报错；
  workflow 里已加入清理步骤）。
- Linux 上 `node-pty@1.1.0` 没有预编译包，需要现场用 node-gyp 编译，
  依赖 `python3`、`make`、`g++`（`ubuntu-latest` 已自带）。
- 仓库使用 git submodule 管理 `file-icons/*`，其中 `bytesize-icons` 是 SSH 地址。
  CI **刻意不拉取子模块**：打包不需要这些内容，且拉取会因缺少部署密钥而失败。
  只有需要重新生成图标时才本地执行 `npm run init-file-icons`。

---

## 8. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| Actions 报 `This request has been automatically failed because it uses a deprecated version of actions/...` | 使用了 Node 12/16 时代的旧 action。本工作流已固定为 `checkout@v4`、`setup-node@v4`、`cache@v4`、`upload-artifact@v4`。 |
| 构建中途尝试发布并报 `GH_TOKEN` 相关错误 | 构建 job 不应注入 `GH_TOKEN`；且命令需带 `--publish never`（`package.json` 中配置了 `"publish": "github"`）。 |
| `verifyInstallerSize` 校验失败 | 同一次构建里混进了多个架构，按第 6 节拆开构建。 |
| Electron 下载超时 | 启用第 6 节的镜像环境变量，缓存命中后通常不会再触发下载。 |
| 推送 tag 后没有 Release | 检查标签是否以 `v` 开头、`build-windows`/`build-linux` 是否都成功（`release` 依赖二者）。 |
| 找不到 `latest.yml` | 该文件由 electron-builder 与 `--publish never` 一起生成，属于更新元数据，不应手动删除。 |
