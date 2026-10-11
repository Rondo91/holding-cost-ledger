# 视觉规范（Design Tokens）

> 本文由 `site/assets/css/styles.css` 反推整理，作为独立可查阅的视觉规范。
> 原始事实来源是样式表本身：头部注释写明了设计原则，`:root` 定义了全部变量。
> 若两者冲突，以 `styles.css` 为准。

---

## 设计原则（styles.css 头部注释，原文）

> 浅色中性背景 / 深灰近黑正文 / 单一低饱和强调色 / 圆角 6–8px
> 移动端优先 / 无渐变 / 无装饰插画 / 无光效
> 数字层级：主金额 > 百分比与日均 > 公式与说明

> **v2.1 修订**：上表是 v1.x 的原话，保留以记录演进。v2.1 后有四处变化——
> 色板由冷灰改为**暖纸（墨与铜）**、圆角 6–8 → **8–10px**、「无渐变」仍是硬约束、
> 标题与主数字改用**宋体栈**。见文末「v2.1 变更摘要」。

---

## 颜色

> **v2.1 起色板整体换成「墨与铜」**（暖纸底 + 铜色信号）。下表是**当前值**；
> v1.x 的旧值见文末「v2.1 变更摘要」。

### 表面与文字（中性色，暖调）

| 变量 | 值 | 用途 |
|---|---|---|
| `--bg` | `#F6F3EE` | 页面背景（同时是 `theme-color`） |
| `--surface` | `#FFFFFF` | 卡片 / 输入框表面 |
| `--surface-sunken` | `#EFEBE3` | 下沉区域 |
| `--border` | `#E8E1D5` | 常规描边 |
| `--border-strong` | `#D6CFC2` | 强描边 |
| `--text` | `#1B1712` | 正文（暖墨近黑，不是纯黑） |
| `--text-secondary` | `#5C564C` | 次级文字 |
| `--text-muted` | `#676052` | 弱化文字（标签、说明）。**v2.1 随底色变暖重新校准**（原 #63635D 在暖纸上偏冷），仍过 AA |
| `--text-faint` | `#706A5A` | 最弱文字。**v2.1 重新校准**；与 `--surface-sunken` 组合为全站最差值 **4.53:1**（刚过 AA 4.5:1） |
| `--text-placeholder` | `#A39C90` | 仅用于输入占位符等纯装饰场景 |

### 强调色（全站唯一，铜色）

| 变量 | 值 |
|---|---|
| `--accent` | `#A65B2E` |
| `--accent-dark` | `#8A4A24` |
| `--accent-tint` | `#F2E8DE` |
| `--accent-line` | `#E0CDBB` |

### 深色面（v2.1 新增）

首屏陈述卡与页脚使用深墨 `#201A14`，其上的文字色为局部覆盖值（不是全局 token）：

| 用途 | 值 | 相对深墨的对比度 |
|---|---|---|
| 主文字 | `#F2EDE5` | 14.78:1 |
| 次文字 | `#B8AFA2` | 7.95:1 |
| 链接 / 强调 | `#C87F4A` | 5.41:1 |
| 强调（备用） | `#D18B57` | 6.19:1 |


### 状态色（低饱和；注释明确「不表达涨跌」）

| 变量 | 值 |
|---|---|
| `--warn-text / --warn-bg / --warn-line` | `#7A5C22` / `#FBF6EA` / `#E8D9B5` |
| `--error-text / --error-bg / --error-line` | `#8A4A42` / `#FBF1EF` / `#E8CBC6` |

---

## 字体

| 变量 | 值 |
|---|---|
| `--font` | `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", "Helvetica Neue", Arial, sans-serif` |
| `--font-display`（v2.1 新增） | `"Source Han Serif SC", "Source Han Serif CN", "Noto Serif SC", "Songti SC", "STSong", "SimSun", serif` |
| `--font-mono` | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace` |

基础字号 **15px**，行高 **1.65**，开启 antialiased 与 optimizeLegibility。

> `--font-display` 是**宋体栈，全为系统字体**——零网络加载、不引入依赖。
> 用于标题与主数字，建立「账本 / 出版物」的气质；正文仍是 `--font`（系统无衬线）。

### 字号层级

| 层级 | 字号 | 字重 | 备注 |
|---|---|---|---|
| 结果主数字 `.result-hero__value` | `clamp(34px, 9.5vw, 56px)` | 600 | 宋体栈，`tabular-nums`（v2.1 由固定 44px 改为 clamp） |
| 最终数字 `.result-hero--final .result-hero__value` | `clamp(36px, 10vw, 60px)` | 600 | 宋体栈，左侧竖条 3px |
| 首屏示例读数 `.hero-demo__value` | 40px | 600 | 宋体栈，深色面上 |
| 设计说明页标题 `.doc__title` | 31px | 600 | 宋体栈（v2.1 由 26px 放大） |
| 工具页主标题 `.page__title` | 31px | 600 | 宋体栈（v2.1 由 25px 放大，比例由 1.67 提到 2.07） |
| 次级数值 `.stat__value` | 21px | 600 | `tabular-nums` |
| 输入框（`.field__input` / `.input-affix__input` / `.ocr-review__input`） | 16px | — | 注释：**16px 避免移动端聚焦缩放**（v1.5 起 ocr-review 也从 14px 归一） |
| 正文/按钮 | 14–15px | 500–600 | |
| 标签/说明 | 12–13.5px | 400–600 | 标签用 `letter-spacing: 0.06–0.08em` 区分 |

数字统一 `font-variant-numeric: tabular-nums`（等宽数字，防跳动）。

---

## 尺寸与布局

| 变量 | 值 | 说明 |
|---|---|---|
| `--radius` | 10px | 常规圆角（v2.1 由 7px 放大） |
| `--radius-sm` | 8px | 小圆角（v2.1 由 6px 放大） |
| `--radius-pill` | 999px | 胶囊（分段控件） |
| `--measure` | 660px | 正文最大行宽 |
| `--gutter` | 20px | 页面留白 |
| `--shadow-card`（v2.1 新增） | `0 1px 2px rgba(62,44,26,0.05), 0 3px 12px rgba(62,44,26,0.06)` | 白卡阴影。**用暖棕而非纯黑**——纯黑在暖纸上发脏 |

**版心覆盖（v2.1）**：`body.app { --measure: 1040px; }`——工具页 `index.html` 的 `<body class="app">`
用 1040px 桌面版心；`design.html` 不加 `.app`，保持 660px 的阅读测量宽度。

**断点：只有一个 —— `min-width: 560px`**（移动端优先，桌面只是"不窄于 560px"）。用于反馈弹层居中与圆角。
v2.1 新增：`max-width: 880px` 时首屏双栏回退单栏。


---

## 组件清单（styles.css 实际包含）

`topbar`（吸顶导航）· `field / field__input / field__error / field__hint`（表单）·
`input-affix`（¥ 前缀输入）· `segmented`（一个价格/价格区间切换）·
`btn`（primary / ghost / quiet 三档）· `notice`（提示块，含 `--accent` 变体）·
`result-hero / stat`（结果数字）· `details`（公式口径折叠）·
`ocr / ocr-result / ocr__progress`（截图识别区）· `feedback`（弹层，`role="dialog"`）·
`doc`（设计说明页版式）

**v2.0 新增**：`field__select`（品类下拉，与输入框同高同宽，自绘箭头不用外部图标）·
`save-row`（记入账本，ghost 次级动作，不抢结果区权重）·
`curve__svg` 系列（内联 SVG：网格 / 标签 / 实线已发生 + 虚线假设 / 当前点竖线与圆点）·
`details--hint`（参考锚点，与公式块同层级）·
`rank`（多设备日均排行）· `history__row / history__list`（账本列表）·
`history__confirm`（清空的行内确认条，warn 三件套）·
`recall-banner`（回看提示条，accent 三件套 + `role="status"`）

**v2.1 新增 / 改动**：`brand__mark`（品牌名左侧铜色斜线记号，内联 SVG）·
`hero-grid`（首屏双栏容器）· `hero-pitch / hero-pitch__kicker / hero-pitch__sub / hero-pitch__hint`
（深墨陈述卡）· `hero-demo / hero-demo__value / hero-demo__ticks`（卡内示例读数 + 刻度）·
`form-card / form-card__foot / form-card__hint`（表单整卡与底部提示）·
`link-action`（文字按钮）· `reading-panel`（读数面板白卡，替代散落的 1px 分隔线）·
`curve-block / curve-block__title / curve-block__summary`（**替代 v2.0 的 `details--curve`**，
曲线由折叠改常显）· `curve__area`（面积填充，`fill-opacity: 0.1`）·
`rank__bar / rank__bar i`（排行对比条，宽度按相对首名日均，最小 8%）
· `result-hero__ticks`（时间刻度母题，纯装饰 `aria-hidden`，**不承载数据含义**）
· `.footer` 改深色面


---

## 已知缺陷（2026-09-30 浏览器实测发现）→ 已修复

**`.range-inputs` 的 `display: flex` 覆盖了 `[hidden]` 的 UA 样式。**

- 位置：`styles.css` 第 290 行 `.range-inputs { display: flex; }`
- 后果：`#sh-range-wrap`（价格区间输入）加了 `hidden` 属性也**不会隐藏**。实测确认：选「一个价格」时，区间输入框（最低 – 最高）仍然显示，与单价格输入框同屏出现；移动端同样复现。
- 状态：**已于 v1.4 修复**——reset 区新增全局规则 `[hidden] { display: none !important; }`，一次收口同类问题，不再逐类打补丁。修复后的实测截图见 `实测截图/修复后-*.png`。

## v1.5 变更摘要（设计层）

- **对比度**：`--text-muted` / `--text-faint` 加深至 AA 达标（上表）；placeholder 拆为独立 token
- **触摸目标**：`.segmented__btn` 30px → ≈40px、`.btn--quiet` 33px → ≈43px（padding 9px 16px / 10px 14px）
- **新增**：`.reveal-in` 结果区出现动画（.28s，reduced-motion 下自动失效）；`.ocr__progress.is-busy` 不确定进度条（纯色滑动块，无渐变）；`.ocr__thumb` 截图缩略图（44px，本地 object URL）；`favicon.svg`
- **焦点**：全局 `:focus-visible` 统一焦点框；反馈弹层面板 `tabindex="-1"` 接收程序化焦点
- **可达性**：`#f-sh` 补 `<label for>`；错误提示节点加 `role="status"`，输入框同步 `aria-invalid`

## v2.0 变更摘要（设计层）

- **层级原则**：曲线与锚点都用 `<details>`，与公式块同级——它们是**解释与旁证**，不是结果；
  曲线的**结论句写在 `<summary>` 上**，点开只是看形状
- **不引入图表库**：衰减曲线是内联 SVG + polyline，零依赖（零构建约束）
- **新增组件一律沿用既有 token**：排行 / 列表 / 确认条 / 提示条都由
  `accent`、`warn`、`border`、`surface-sunken` 四套既有色拼出，没有新增颜色
- **可达性**：品类下拉是真 `<label for>` + 16px（防 iOS 聚焦缩放）；
  曲线 SVG 带 `role="img"` + `aria-label` 概括；回看提示条 `role="status"`
- **减少动效**：新组件没有新增任何动画，全局 reduced-motion 规则自动覆盖
- **发布工程**：`styles.css` 与 JS 入口带 `?v=2.0.0`（改动模块的 import 同步带），
  避免老访客拿到"新 HTML + 旧 JS"

## v2.1 变更摘要（设计层）

**主题：视觉升级与改版——「墨与铜」，从换色走到重排结构。**
功能层与 v2.0 完全相同；计算、埋点白名单、隐私承诺、四组取舍与六项指标一字未改。

### 色彩：冷灰 → 墨与铜

| 变量 | v1.x / v2.0 | v2.1 |
|---|---|---|
| `--bg` | `#FAFAF8` | `#F6F3EE` |
| `--surface-sunken` | `#F3F3F0` | `#EFEBE3` |
| `--border` / `--border-strong` | `#E3E3DF` / `#D0D0CB` | `#E8E1D5` / `#D6CFC2` |
| `--text` | `#1E1E1C` | `#1B1712` |
| `--text-secondary` | `#585853` | `#5C564C` |
| `--text-muted` | `#63635D` | `#676052` |
| `--text-faint` | `#70706A` | `#706A5A` |
| `--text-placeholder` | `#A8A8A2` | `#A39C90` |
| `--accent` | `#3E6580`（灰蓝） | `#A65B2E`（铜） |
| `--accent-dark` | `#32536A` | `#8A4A24` |
| `--accent-tint` | `#EDF2F5` | `#F2E8DE` |
| `--accent-line` | `#C3D2DC` | `#E0CDBB` |

**全部色值经 WCAG 对比度脚本逐组合校验**——最差组合 `--text-faint` on `--surface-sunken`
= **4.53:1**，全部过 AA 4.5:1。「说明性文字再小也必须可读」是口径承诺的一部分。

### 字体：标题与主数字改宋体栈

- 新增 `--font-display`（全系统字体，零加载）；`.page__title` / `.doc__title` /
  `.result-hero__value` / `.hero-demo__value` 使用
- 主数字由固定 44/52px 改为 `clamp()`，移动端下限 36–40px（经区间形态溢出验算）
- 标题比例由 1.67 提到 2.07

### 结构与图形

- `body.app { --measure: 1040px }`：工具页桌面版心放大；design.html 保持 660px
- 首屏双栏（`hero-grid`）、深墨陈述卡与页脚（`#201A14`）、读数面板（`reading-panel`）
- 曲线常显（`curve-block` 替代 `details--curve`）、面积填充、虚线网格、限宽 720px 居中
- 排行对比条（`rank__bar`）；桌面端账本数字右对齐成列
- 时间刻度母题（`result-hero__ticks`，纯装饰、`aria-hidden`、不承载数据含义）

### 动效与可达性

- 结果区**首次**揭示时主数字 450ms 滚动出场（`prefers-reduced-motion` 直接显示终值；
  区间形态不滚）——**全站唯一新增动效**
- 深色面文字对比度：纸白 14.78:1 / 次文 7.95:1 / 亮铜 5.41:1 / 6.19:1
- 刻度线、面积填充均 `aria-hidden`，不进入可访问性树

### 发布工程

`styles.css` / `app.js`（含 `design.html`）带 `?v=2.1.0`；**被改动的模块 import 同步带**
（`views.js` / `views-history.js`）；未改动的 `analytics.js` / `ocr.js` / `creator.js` 保持 `?v=2.0.0`。
