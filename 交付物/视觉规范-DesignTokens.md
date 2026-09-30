# 视觉规范（Design Tokens）

> 本文由 `site/assets/css/styles.css` 反推整理，作为独立可查阅的视觉规范。
> 原始事实来源是样式表本身：头部注释写明了设计原则，`:root` 定义了全部变量。
> 若两者冲突，以 `styles.css` 为准。

---

## 设计原则（styles.css 头部注释，原文）

> 浅色中性背景 / 深灰近黑正文 / 单一低饱和强调色 / 圆角 6–8px
> 移动端优先 / 无渐变 / 无装饰插画 / 无光效
> 数字层级：主金额 > 百分比与日均 > 公式与说明

---

## 颜色

### 表面与文字（中性色，暖灰调）

| 变量 | 值 | 用途 |
|---|---|---|
| `--bg` | `#FAFAF8` | 页面背景（同时是 `theme-color`） |
| `--surface` | `#FFFFFF` | 卡片 / 输入框表面 |
| `--surface-sunken` | `#F3F3F0` | 下沉区域 |
| `--border` | `#E3E3DF` | 常规描边 |
| `--border-strong` | `#D0D0CB` | 强描边 |
| `--text` | `#1E1E1C` | 正文（深灰近黑，不是纯黑） |
| `--text-secondary` | `#585853` | 次级文字 |
| `--text-muted` | `#8C8C86` | 弱化文字（标签、说明） |
| `--text-faint` | `#A8A8A2` | 最弱文字 |

### 强调色（全站唯一，低饱和蓝灰）

| 变量 | 值 |
|---|---|
| `--accent` | `#3E6580` |
| `--accent-dark` | `#32536A` |
| `--accent-tint` | `#EDF2F5` |
| `--accent-line` | `#C3D2DC` |

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
| `--font-mono` | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace` |

基础字号 **15px**，行高 **1.65**，开启 antialiased 与 optimizeLegibility。

### 字号层级

| 层级 | 字号 | 字重 | 备注 |
|---|---|---|---|
| 结果主数字 `.result-hero__value` | **44px** | 600 | `letter-spacing: -0.02em`，`tabular-nums` |
| 设计说明页标题 `.doc__title` | 26px | 600 | |
| 工具页主标题 `.page__title` | 25px | 600 | |
| 次级数值 `.stat__value` | 21px | 600 | `tabular-nums` |
| 输入框 | 16px | — | 注释：**16px 避免移动端聚焦缩放** |
| 正文/按钮 | 14–15px | 500–600 | |
| 标签/说明 | 12–13.5px | 400–600 | 标签用 `letter-spacing: 0.06–0.08em` 区分 |

数字统一 `font-variant-numeric: tabular-nums`（等宽数字，防跳动）。

---

## 尺寸与布局

| 变量 | 值 | 说明 |
|---|---|---|
| `--radius` | 7px | 常规圆角 |
| `--radius-sm` | 6px | 小圆角 |
| `--radius-pill` | 999px | 胶囊（分段控件） |
| `--measure` | 660px | 正文最大行宽 |
| `--gutter` | 20px | 页面留白 |

**断点：只有一个 —— `min-width: 560px`**（移动端优先，桌面只是"不窄于 560px"）。用于反馈弹层居中与圆角。

---

## 组件清单（styles.css 实际包含）

`topbar`（吸顶导航）· `field / field__input / field__error / field__hint`（表单）·
`input-affix`（¥ 前缀输入）· `segmented`（一个价格/价格区间切换）·
`btn`（primary / ghost / quiet 三档）· `notice`（提示块，含 `--accent` 变体）·
`result-hero / stat`（结果数字）· `details`（公式口径折叠）·
`ocr / ocr-result / ocr__progress`（截图识别区）· `feedback`（弹层，`role="dialog"`）·
`doc`（设计说明页版式）

---

## 已知缺陷（2026-09-30 浏览器实测发现）

**`.range-inputs` 的 `display: flex` 覆盖了 `[hidden]` 的 UA 样式。**

- 位置：`styles.css` 第 290 行 `.range-inputs { display: flex; }`
- 后果：`#sh-range-wrap`（价格区间输入）加了 `hidden` 属性也**不会隐藏**。实测确认：选「一个价格」时，区间输入框（最低 – 最高）仍然显示，与单价格输入框同屏出现；移动端同样复现。
- 旁证：样式表里 `.section`、`.field__error`、`.ocr__progress`、`.ocr-result`、`.feedback` 都单独写了 `[hidden] { display: none }` 补丁——说明作者遇到过同类问题，但漏掉了 `.range-inputs`。
- 修法（一行）：`.range-inputs[hidden] { display: none; }`
- 状态：**尚未修复，未发布**。
