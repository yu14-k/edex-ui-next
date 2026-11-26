# eDEX-UI 定制化指南 / Customization

2.6.0 把「布局、主题、模块」从写死改成可配置。所有默认值都复刻了旧行为，**不改配置就跟以前一模一样**。

所有配置文件都在用户数据目录：

| 平台 | 路径 |
| --- | --- |
| Windows | `%APPDATA%\eDEX-UI\` |
| Linux | `~/.config/eDEX-UI/` |
| macOS | `~/Library/Application Support/eDEX-UI/` |

---

## 1. 布局：`layout.json`

首次启动自动生成。改完直接重启即生效；列宽也可以在设置面板里改并**立即生效**。

```json
{
    "version": 1,
    "columns": {
        "left":  { "width": 17, "modules": ["clock", "sysinfo", "hardwareInspector", "cpuinfo", "ramwatcher", "toplist"] },
        "right": { "width": 17, "modules": ["netstat", "globe", "conninfo"] }
    },
    "terminal": { "width": 65 },
    "modules": {}
}
```

**字段**

| 字段 | 范围 | 说明 |
| --- | --- | --- |
| `columns.left.width` / `columns.right.width` | 10–30（%） | 左右面板列宽 |
| `terminal.width` | 40–80（%） | 终端区域宽度；三者之和建议 ≤ 100 |
| `columns.*.modules` | 模块名数组 | 该列显示哪些模块、什么顺序 |
| `modules.<name>` | 对象 | 每模块的预留选项（当前未全部消费，未知键会保留） |

**可用模块名**

`clock`、`sysinfo`、`hardwareInspector`、`cpuinfo`、`ramwatcher`、`toplist`、`netstat`、`globe`、`conninfo`

**容错规则**（实在的，`npm test` 也在测）：

- 未知模块名 → **丢弃并告警**，不会白屏
- 宽度越界 → **钳制到范围内**，并告警
- 所有模块都被移除 → **恢复默认布局**
- 重复模块名 → 只保留第一个

例：把地球挪到左列、只留 3 个模块、左列加宽

```json
{
    "version": 1,
    "columns": {
        "left":  { "width": 22, "modules": ["clock", "cpuinfo", "globe"] },
        "right": { "width": 14, "modules": ["netstat", "toplist", "conninfo"] }
    },
    "terminal": { "width": 60 }
}
```

---

## 2. 设置面板里的布局项

设置面板（`Ctrl+Shift+S`）新增 **Layout** 分区：

- `columns.left.width` / `columns.right.width` / `terminal.width` —— 保存后**立即生效**
- `modules.left` / `modules.right` —— 逗号分隔，保存后需**重启**
- 「Open layout.json」按钮 —— 直接打开配置文件

保存时会先归一化（钳制 + 丢未知模块），有问题会弹窗列出具体哪一项被调整。

---

## 3. 主题：`themes/*.json`

21 套内置主题，每套都是纯 JSON，字段现在**有 schema 校验**（`schemas/theme.schema.json`），
写错字段 `npm test` 会直接指出是哪一套、哪一个字段。

必填：`colors`（`r/g/b/black/light_black/grey`）、`cssvars`（`font_main` / `font_main_light`）、`terminal`（`fontFamily` / `foreground` / `background`）、`globe`。

可选常用字段：`terminal.fontSize`、`terminal.cursorStyle`（`block`/`underline`/`bar`）、`terminal.letterSpacing`（0–4）、`terminal.lineHeight`（0.8–2）、`terminal.colorFilter`、`injectCSS`。

**颜色格式**：`#rgb`、`#rrggbb`、`rgb()/rgba()/hsl()/hsla()`。

**`injectCSS` 是受信任内容**：只做了去 `<` 的净化。只在自己的主题里用，别把别人给的 CSS 直接塞进去。

### 主题热切换

- 文件面板里双击主题文件 → **立即换色，不重载页面**（终端不会重连、scrollback 不丢）
- 设置面板改 `theme` 后保存 → 同样立即生效
- 唯一例外：**3D 地球**的配色烘在 encom-globe 实例的构造参数里，重建会丢连接 pin，
  所以它需要重启才能换色（`window.globeThemeStale` 会标记这一状态，不假装成功）

---

## 4. Profile：`profiles/<name>.json`

一个 profile = 主题 + 键盘布局 + 布局配置。按 `Ctrl+Shift+O` 打开切换器。

```json
{
    "theme": "cyborg",
    "keyboard": "en-US",
    "layout": { "columns": { "left": { "width": 20, "modules": ["clock", "cpuinfo"] } } }
}
```

- **应用**：主题立刻生效；列宽立刻生效；模块集合/键盘变化需要重启（切换器会明说）
- **新建**：切换器里输入名字，会把当前状态存成 profile

---

## 5. 键盘布局：`keyboards/*.json`

19 套内置布局，schema 在 `schemas/kb_layout.schema.json`。
注意：**内置的 `en-WORKMAN.json` 在 2.6.0 之前是损坏的**（文件末尾少一个闭合括号，
因为从来没被校验过所以一直没人发现）。2.6.0 修好了，并把这件事故变成了 CI 检查。

---

## 6. 校验

```bash
npm test        # 语法 + manifest + 21 套主题 + 19 套键盘布局 + 布局归一化行为
npm run test:probe   # 真机：布局是否真的套到 DOM、主题热切换是否保活终端、profile 往返
```

改坏任何一套主题或用例，CI 会红并指出具体文件与字段。
