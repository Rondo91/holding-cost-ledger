# 持有成本账本

帮你在出售或更换电子设备前，算清这台设备的**真实持有成本**和**价值回收情况**。

**在线使用**：https://holding-cost-ledger.app.workbuddy.host/

这是一个 AI 产品经理作品集项目。它刻意保持小——价值不在功能数量，而在**每一个决策的取舍与依据都留有痕迹**：为什么砍掉高频诱惑功能、为什么指标只有六个、为什么 AI 只做识别不做计算。

---

## 文档导览（建议阅读顺序）

| # | 文件 | 内容 |
|---|---|---|
| 1 | [CHANGELOG.md](CHANGELOG.md) | 每个版本改了什么、**为什么改** |
| 2 | [site/design.html](site/design.html) | 四组关键取舍、指标口径、已知局限——**整个作品的核心论据** |
| 3 | [交付物/案例复盘-持有成本账本.md](交付物/案例复盘-持有成本账本.md) | 决策复盘与追问应答 |
| 4 | [交付物/PRD-持有成本账本.md](交付物/PRD-持有成本账本.md) | 规范化需求文档，含「明确不做」清单 |
| 5 | [交付物/独立审查报告.md](交付物/独立审查报告.md) | 针对自己设计的批判性审查 |
| 6 | [site/README.md](site/README.md) | 技术实现、怎么跑、怎么测 |

## 怎么跑

零构建、零 npm 依赖，原生 ES Modules。本地预览必须走 HTTP（`file://` 会被浏览器拦截）：

```bash
cd site
python -m http.server 8123 --bind 127.0.0.1
node --test tests/calc.test.js tests/format.test.js tests/validate.test.js tests/views.test.js tests/ocr.test.js tests/benchmark.test.js tests/category.test.js tests/curve.test.js tests/history-store.test.js tests/views-history.test.js
```

## 隐私承诺（设计的一部分，不是宣传语)

- 不收集姓名、手机号、订单号——数据表里没有这些字段
- 订单截图**不上传**：只在浏览器内读成 data URL 直接交给模型
- 填入的数字不上传；主动记入账本的记录只存在你的浏览器里
- 埋点只上报数值所属区间，且数据表仅有 INSERT 权限、无任何 SELECT 权限，统计无法被反向读取

## 关键技术约束

- AI 只做字段识别，**所有计算由确定性纯函数完成**；识别不确定的字段标「待确认」，绝不自动写入
- 纯逻辑（计算/格式化/校验）全部单测覆盖；DOM 交互层依赖手动验证
