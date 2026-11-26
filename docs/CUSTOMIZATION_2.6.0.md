# 可定制化 2.6.0 计划

目标：把「布局/主题/模块」从写死在代码里，变成**用户可配置、可校验、可热切换**的声明式系统。
所有改动保持现有默认外观不变——不配置就还是今天的样子。

## 0. 现状（实测）

| 项 | 现状 |
| --- | --- |
| 模块装配 | `_renderer.js` 里 9 个 `initModule(...)` 硬编码在左/右两列，顺序写死 |
| 列宽 / 终端宽 | 写死在 CSS（`mod_column.css` 17%、`main_shell.css` 65%），换比例只有 `extra_ratios.css` 四档 media query |
| 主题 | 21 套 JSON（`colors` / `cssvars` / `terminal` / `globe` / 可选 `injectCSS`），**无 schema**，字段写错只能运行时炸 |
| 换主题 | `window.location.reload()` —— 终端重连、boot 重跑、焦点丢失 |
| 设置面板 | 25 个键，全部是 shell/终端/外观布尔值，**没有任何布局项** |
| 校验 | `npm test` 只查 JS 语法 + manifest，主题/布局文件完全不校验 |

## 1. 阶段与验收

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **P1 布局配置** | `src/shared/layout.js`（schema + 归一化，渲染侧与 CI 共用）→ `userData/layout.json`；模块归属列/顺序、两列宽度、终端宽度、未知名容忍、隐藏模块 | 坏配置（越界/未知模块/全空）不白屏；`EDEX_PROBE_LAYOUT` 断言列宽与模块分布 |
| **P2 主题 schema** | `schemas/theme.schema.json` + ajv，CI 校验全部 21 套主题与 19 套键盘布局；主题新增可选字段（`effects` / `layout`） | `npm test` 对 21+19 个文件全绿；故意写坏一个主题 CI 必红 |
| **P3 设置面板** | 面板暴露：列宽（左/右/终端）、每列模块勾选、主题选择、`layout.json` 路径提示 | 改面板后立即生效（不需重启）；`EDEX_PROBE_SETTINGS` 断言新控件存在 |
| **P4 主题热切换** | `_loadTheme()` 拆 `applyTheme()`，各模块 `restyle(theme)`；`fs.watch(userData/themes)` 防抖 150ms 推送 | 存盘 1s 内换色，**终端不重连**；`EDEX_PROBE_THEME` 断言 |
| **P5 profile** | `profiles/<name>.json` = 布局 + 主题 + 键盘 + 模块开关；命令面板/快捷键切换 | 两个 profile 互相切换，外观与模块集合都变 |
| **P6 收口** | 版本 2.6.0、文档（`docs/CUSTOMIZATION.md`）、发布 | CI 全绿 + Release 产物 |

## 2. 关键设计决定

1. **单一 schema 来源**：`src/shared/layout.js` 用 UMD 形态，既能被 `<script>` 加载，也能被 `lib/check-syntax.js` `require` —— 避免「CI 用一套、运行时用另一套」。
2. **归一化而非报错**：未知模块名 → 丢弃并警告；宽度越界 → 钳制；全空 → 恢复默认。**手改配置文件不该白屏。**
3. **不动默认值**：`DEFAULT_LAYOUT` 精确复刻今天的左右两列，所以不配置的用户感觉不到任何变化。
4. **主题不动 CSS 注入契约**：`injectCSS` 保持现状（只做 `<` 净化），但 schema 里显式标注它是「受信任内容」，为将来在线分发留判定位。
5. **热切换优先于重载**：`location.reload()` 保留为逃生入口（「Reload UI」按钮还在），但换主题/换布局走增量应用。

## 3. 不做

- 插件系统 / 在线主题市场（沙箱与信任模型未定，见 `docs/UPGRADE_2.4.0.md`）
- 拖拽式布局编辑器（Qt 级交互成本，收益低）
- 任意 CSS 注入白名单化（需要 AST，单列任务）
- 移动端/平板专属布局

## 4. 风险

| 风险 | 缓解 |
| --- | --- |
| 布局改变后 xterm 的 `gcd` 补丁失准（`terminal.class.js` 用 `screen.width/height` 修正 cols/rows） | 列宽变化只影响容器，不改 `screen`；探针断言 `termMetrics.cell` 仍 ≤1% 偏差 |
| 模块在错误的列里宽度不够（`toplist` 表格、`conninfo` 双图） | 列宽钳制在 10–30%，并提供 `modules.<name>.compact` 开关 |
| 热切换时 globe 材质重建导致闪一帧 | 重建前先快照 pin 列表，重建后回填 |
| `fs.watch` 在 Windows 双触发 | 150ms 防抖 + 内容哈希比较 |
