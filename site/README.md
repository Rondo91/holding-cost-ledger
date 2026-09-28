# 持有成本账本

帮用户在出售或更换电子设备前，算清这台设备每天的持有成本和现在的价值回收情况。

技术上是零构建的静态站点：没有打包器、没有依赖、没有 node_modules。

---

## 目录

```
site/
├── index.html                工具页（发布入口）
├── design.html               设计说明与取舍记录
├── assets/
│   ├── css/styles.css        设计 token 与全部样式
│   └── js/
│       ├── config.js         云服务公开配置（未填写时全程本地模式）
│       ├── cloud.js          SDK 单实例初始化
│       ├── calc.js           持有成本计算（纯函数）
│       ├── format.js         数值格式化与分桶（纯函数）
│       ├── validate.js       输入校验（纯函数）
│       ├── views.js          结果区渲染（数据 → HTML）
│       ├── ocr.js            订单截图识别与降级
│       ├── analytics.js      匿名埋点（云端 / 本地双模式）
│       └── app.js            入口：状态机、事件绑定、即时计算
├── tests/                    node --test 单元测试
└── README.md
```

---

## 本地预览

页面使用 ES Modules，**file:// 直接打开会被浏览器拦截**，必须走 HTTP：

```bash
cd site
python -m http.server 8123 --bind 127.0.0.1
# 打开 http://127.0.0.1:8123/index.html
```

> **注意**：`config.js` 填好之后，云能力只在**发布域名**下可用——服务端按 Origin 精确匹配校验。
> 所以从 `127.0.0.1` 打开时，截图识别会显示不可用、埋点也不会写入云端（控制台会有一行警告）。
> 这是预期行为，不是故障。要在本机验证云能力，只能走发布链接。

## 运行测试

```bash
node --test tests/calc.test.js tests/format.test.js tests/validate.test.js tests/views.test.js tests/ocr.test.js
```

测试只覆盖纯逻辑层（计算、格式化、校验、渲染字符串、模型选型），不依赖浏览器，也不需要装任何东西。
**DOM 交互层（事件绑定、状态流转）没有自动化测试**——改交互逻辑时请手动走一遍。

---

## 计算口径

符号：`P` 实际支付金额 · `S` 当前预计二手价 · `D` 持有天数 · `T` 计算日期

```
D = max(1, T − 购买日期 + 1)      自然日，含购买当天，所以当天买入记为 1 天
已投入金额      = P
日均购置成本    = P ÷ D
估算净持有支出  = P − S
日均净持有支出  = (P − S) ÷ D
按实付回收率    = S ÷ P
```

填写价格区间 `[a, b]` 时：

```
净持有支出 = [P − b, P − a]
日均净支出 = [(P − b) ÷ D, (P − a) ÷ D]
回收率     = [a ÷ P, b ÷ P]
```

两条必须守住的行为约定：

- **未填写二手价时，不显示净持有支出、日均净支出和回收率，而是明确说明「未计入残值」。**
  显示 0 元会被读成"这台设备已经一文不值"，与事实不符。
- **`S > P` 时净额为负是正常结果**（以旧换新、设备升值），文案改写为「已回本，净收益」，
  不把负号原样抛给用户。

---

## 隐私

承诺与实现是一一对应的，不是标语：

| 承诺 | 实现方式 |
|---|---|
| 不收集姓名、地址、手机号、订单号 | 数据表里根本没有这些字段 |
| 截图不上传 | 只在浏览器内读成 data URL，直接交给模型，不经过任何存储 |
| 不记录你填的数值 | 埋点只上报金额/天数/回收率所属的**区间**，不上报原文 |
| 不要求注册 | 没有账号体系，会话标识由浏览器生成，关闭标签页即失效 |

数据库层用 CHECK 约束白名单把"只能写这几个键"钉死，应用层写错也会被拒。

---

## 云服务（可选）

站点在**没有云服务的情况下也能完整使用**：计算、结果、公式、反馈全部正常，
只是截图识别不可用、埋点写入本机 `localStorage`。

接入后可以解锁两项能力：真实模型调用 + 跨用户的指标聚合。

### 1. 填写配置

开通后把返回的 `publicConfig` 填进 `assets/js/config.js`：

```js
export const cloudConfig = {
  endpoint: '……',
  publishableKey: '……',
};
```

两个值都是端上公开值。`publishableKey` 只标识是哪个应用、本身不带权限，
服务端按 Origin 精确匹配校验；`endpoint` 必须原样使用，不能从 `location` 或环境变量推断。

### 2. 建表

```sql
CREATE TABLE calc_events (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id TEXT NOT NULL CHECK (char_length(session_id) BETWEEN 8 AND 64),
  event_name TEXT NOT NULL CHECK (event_name IN (
    'page_view','input_started','field_completed','base_result_viewed',
    'residual_prompt_shown','residual_entered','residual_skipped','full_result_viewed',
    'formula_expanded','formula_collapsed','feedback_opened','feedback_answered',
    'feedback_dismissed','ocr_upload_started','ocr_result','ocr_field_confirmed',
    'ocr_field_edited','ocr_fallback_manual','client_error'
  )),
  step  TEXT CHECK (step IN ('input','base','residual','full')),
  props JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (props - ARRAY['field','price_band','days_band','residual_type',
                             'recovery_band','status','reason','code','page',
                             'fields_found','fields_unsure','section',
                             'model','duration_ms'] = '{}'::jsonb),
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON calc_events (ts);

CREATE TABLE calc_feedback (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  TEXT NOT NULL CHECK (char_length(session_id) BETWEEN 8 AND 64),
  helpful     TEXT NOT NULL CHECK (helpful IN ('yes','no','unsure')),
  next_action TEXT NOT NULL CHECK (next_action IN ('continue','check_price','sell','replace','unsure')),
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3. 开放匿名写入，但不开放读取

两张表都是 insert-only：前端能写、读不回来，只有服务端能查。

```sql
ALTER TABLE calc_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE calc_feedback ENABLE ROW LEVEL SECURITY;

GRANT INSERT ON TABLE public.calc_events   TO anon, authenticated;
GRANT INSERT ON TABLE public.calc_feedback TO anon, authenticated;

CREATE POLICY calc_events_insert ON calc_events
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY calc_feedback_insert ON calc_feedback
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- 刻意不建任何 SELECT 策略
```

匿名调用者没有 `auth.uid()`，所以这里不能套用 owner_id 模式。

### 4. 查看指标（服务端）

埋点表刻意不开放任何读取策略，所以指标由服务端直接查询：

```sql
SELECT date_trunc('day', ts) AS day, event_name,
       count(*) AS n, count(DISTINCT session_id) AS sessions
FROM calc_events
GROUP BY 1, 2 ORDER BY 1 DESC;
```

**刻意不建派生视图。** 视图不继承表的 RLS，多一个对象就多一条可能被匿名角色反向读取的路径。
聚合查询跑在服务端就够了，不需要为此暴露一个可查询对象。

### 5. 完成后自检

```sql
SELECT count(*) FROM calc_events;
SELECT helpful, next_action, count(*) FROM calc_feedback GROUP BY 1, 2;
```

在浏览器控制台执行 `__hcbEvents.mode()` 应返回 `'cloud'`。
如果仍是 `'local'`，说明 `config.js` 没生效或 Origin 不匹配（访问域名必须与 `endpoint` 一致）。

---

## 本地模式下自检埋点

未接入后端时，事件写在 `localStorage`。浏览器控制台可用：

```js
__hcbEvents.mode()          // 'local' | 'cloud'
__hcbEvents.dump()          // 全部事件
__hcbEvents.dumpFeedback()  // 反馈记录
__hcbEvents.clear()
```

---

## 已知局限

- 六项指标目前没有真实数据，页面上展示的是口径与目标值，不是达成情况。
- 埋点在页面关闭时会丢失最后一批事件，真实指标应视为下界估计。
- 二手价由用户手填，平台挂牌价普遍高于实际成交价，本身就是估算。
- 访谈样本 12 人且集中在熟人圈，百分比只能当方向，不能当结论。

详见 `design.html` 第 04 节。
