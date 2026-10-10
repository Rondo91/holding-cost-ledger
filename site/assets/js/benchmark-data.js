/**
 * benchmark-data.js — 参考回收率数据（纯数据，无逻辑）
 *
 * 数据原则（与「编造的价格比没有价格更糟」同一条）：
 *   - 每个区间必须来自可公开引用的来源，来源与时间写进 sources / asOf，界面原样展示
 *   - 查不到可靠公开数据的品类（耳机 / 其他）bands 保持 null，界面显示「暂无可靠的公开参考数据」
 *   - 持有超过 3 年的段同样标记为「没有数据」（range: null），不拿 3 年的数值顶替
 *   - 绝不拍脑袋填一个「看起来合理」的平均数
 *
 * bands 按持有年限分段（maxMonths 升序，null 为无上限的兜底段）：
 *   保值率随年限陡降，单一数字会把「持有 3 个月」与「持有 3 年」混为一谈，
 *   口径不一致的比较是伪精确，比没有参考更糟。
 *
 * range 为「还能卖到的价钱 ÷ 原价」的区间 [lo, hi]，0 < lo < hi ≤ 1。
 * 口径差异（caliberNote）必须在界面上原样展示：这些数字多来自回收商报价、
 * 且按发售价统计；本工具的回收率按实付金额算，两者不是一回事。
 */

export const BENCHMARK_META = {
  /** 数据截止时间的兜底值；品类有 asOf 时以品类为准 */
  cutoff: '2026 年 10 月',
  /** 口径差异声明，渲染时必须原样出现 */
  caliberNote:
    '行业保值率大多按发售价口径统计，且多来自回收商报价（通常低于个人之间的成交价）；'
    + '本工具的回收率按实付金额计算。你买得比发售价便宜时，按参考区间折算会低估你的实际回收率，'
    + '反过来会高估。这是参考，不是你这台设备现在的真实价格。',
  /** 无数据品类的降级文案 */
  noDataNote: '这个品类暂无可靠的公开参考数据。与其给你一个编的数字，不如不显示。',
  /** 有数据、但持有年限超出统计范围的降级文案 */
  noDataForBandNote:
    '公开数据大多只统计到 3 年。持有超过 3 年的设备没有可引用的公开区间'
    + '——用 3 年的数值顶上会高估，所以这里不给数字。',
};

/**
 * 手机用中文来源（平台实测报价），其余品类用同一张海外回收商折旧表，
 * 每个品类的来源单独标注，不混着引用。
 */
export const BENCHMARKS = {
  phone: {
    label: '手机',
    asOf: '2026 年 7 月',
    // 区间取 12 款主力机型实测值的最小与最大：iPhone 与安卓差距极大，
    // 给一个「平均值」两头都不像，如实给出宽区间才有参考价值
    bands: [
      { maxMonths: 12, label: '1 年以内', range: [0.42, 0.78] },
      { maxMonths: 24, label: '1–2 年', range: [0.25, 0.63] },
      { maxMonths: 36, label: '2–3 年', range: [0.15, 0.50] },
      { maxMonths: null, label: '3 年以上', range: null, note: BENCHMARK_META.noDataForBandNote },
    ],
    sources: [
      '12 款主力机型三年保值实测（2026-07，综合转转、爱回收报价与线下商户收机均价，95 新 256G）',
      '转转与澎湃新闻《2025-2026 二手手机报告》',
    ],
  },

  tablet: {
    label: '平板',
    asOf: '2026 年 10 月',
    // iPad 65/50/32 与 Android 平板 60/45/30（回收商报价口径）
    bands: [
      { maxMonths: 12, label: '1 年以内', range: [0.60, 0.65] },
      { maxMonths: 24, label: '1–2 年', range: [0.45, 0.50] },
      { maxMonths: 36, label: '2–3 年', range: [0.30, 0.32] },
      { maxMonths: null, label: '3 年以上', range: null, note: BENCHMARK_META.noDataForBandNote },
    ],
    sources: ['设备折旧表（2026-10，回收商报价：iPad 与 Android 平板）'],
  },

  laptop: {
    label: '笔记本',
    asOf: '2026 年 10 月',
    // MacBook 65/50/35 与 Windows 笔记本 55/35/22（回收商报价口径）
    bands: [
      { maxMonths: 12, label: '1 年以内', range: [0.55, 0.65] },
      { maxMonths: 24, label: '1–2 年', range: [0.35, 0.50] },
      { maxMonths: 36, label: '2–3 年', range: [0.22, 0.35] },
      { maxMonths: null, label: '3 年以上', range: null, note: BENCHMARK_META.noDataForBandNote },
    ],
    sources: ['设备折旧表（2026-10，回收商报价：MacBook 与 Windows 笔记本）'],
  },

  watch: {
    label: '手表手环',
    asOf: '2026 年 10 月',
    // 该表只有一条 Watch 曲线（58/38/22），没有子品类可拆，
    // 因此上下各放宽 5 个百分点成区间——比虚报一个「实测分布」诚实
    bands: [
      { maxMonths: 12, label: '1 年以内', range: [0.50, 0.60] },
      { maxMonths: 24, label: '1–2 年', range: [0.33, 0.43] },
      { maxMonths: 36, label: '2–3 年', range: [0.17, 0.27] },
      { maxMonths: null, label: '3 年以上', range: null, note: BENCHMARK_META.noDataForBandNote },
    ],
    sources: [
      '设备折旧表（2026-10，回收商报价：Watch 单一曲线上下各放宽 5 个百分点成区间）',
    ],
  },

  earphones: {
    label: '耳机',
    asOf: '',
    // 二手耳机价格几乎由电池健康度决定，且没有按年限分段的公开数据，
    // 只有零散的单型号报价。拼一个区间出来等于编数，因此如实留空。
    bands: null,
    sources: [],
    note: '耳机暂时没有可参考的公开数据：二手价主要由电池健康度决定，公开来源只有零散的单型号报价，'
      + '拼不出按年限分段的区间。与其给你一个编的数字，不如不显示。',
  },

  camera: {
    label: '相机',
    asOf: '2026 年 10 月',
    // Camera 70/52/38（回收商报价口径），单一曲线上下各放宽 5 个百分点
    bands: [
      { maxMonths: 12, label: '1 年以内', range: [0.65, 0.75] },
      { maxMonths: 24, label: '1–2 年', range: [0.47, 0.57] },
      { maxMonths: 36, label: '2–3 年', range: [0.33, 0.43] },
      { maxMonths: null, label: '3 年以上', range: null, note: BENCHMARK_META.noDataForBandNote },
    ],
    sources: [
      '设备折旧表（2026-10，回收商报价：Camera 单一曲线上下各放宽 5 个百分点成区间）',
    ],
  },

  other: {
    label: '其他',
    asOf: '',
    bands: null,
    sources: [],
    note: '这个品类没有对应的公开参考数据。',
  },
};
