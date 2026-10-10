/**
 * category.js — 设备品类（纯函数）
 *
 * 品类的唯一用途：给「参考回收率锚点」匹配数据段。它不参与任何计算，
 * 推断错了最多是参考区间没出现或品类不对，用户随时可以手动改。
 *
 * 推断规则：收集设备名称里命中的所有关键词，取「最长命中」所属品类。
 * 这样「华为 MateBook 14」里 laptop 的 'matebook'(8 字符) 会压过
 * phone 泛词的 '华为'(2 字符)，不会被品牌词带偏。
 *
 * 未命中返回 null（界面不显示锚点），不静默归入「其他」——
 * 「没识别出」和「识别为无参考数据的品类」是两件事。
 */

export const CATEGORY_OPTIONS = [
  { value: 'auto', label: '自动识别' },
  { value: 'phone', label: '手机' },
  { value: 'tablet', label: '平板' },
  { value: 'laptop', label: '笔记本' },
  { value: 'watch', label: '手表手环' },
  { value: 'earphones', label: '耳机' },
  { value: 'camera', label: '相机' },
  { value: 'other', label: '其他' },
];

/**
 * 两层关键词：
 *   specific —— 品类确定的型号 / 系列词，命中即可较有把握地归类
 *   generic  —— 品类泛词。其中「平板 / 手表 / 手环 / 耳机 / 相机」等
 *               品类词声明在品牌词之前：与品牌词同长时（如「小米平板」
 *               同时命中「小米」与「平板」）品类词优先。
 */
const KEYWORD_TABLE = {
  phone: {
    specific: [
      'iphone', 'galaxy s', 'galaxy z', '红米k', '红米note', 'mate ', 'p40', 'p50', 'p60', 'p70',
      '荣耀magic', 'find x', 'find x6', 'find x7',
    ],
    generic: ['手机', '华为', '小米', '荣耀', '三星', 'oppo', 'vivo', '一加', '红米', '真我', 'iqoo', '努比亚', '魅族'],
  },
  tablet: {
    specific: [
      'ipad', 'matepad', 'galaxy tab', 'redmipad', '小新pad', '小米平板', '华为平板', '荣耀平板',
      'surface pro', 'surface go',
    ],
    generic: ['平板'],
  },
  laptop: {
    specific: [
      'macbook', 'thinkpad', 'ideapad', 'matebook', '拯救者', 'rog', '外星人', 'surface laptop',
      '游匣', '暗影精灵', 'yoga', '灵耀', '无畏pro',
    ],
    generic: ['笔记本', '轻薄本', '游戏本'],
  },
  watch: {
    specific: [
      'apple watch', 'galaxy watch', 'mi band', '小米手环', '华为手环', '荣耀手环',
      'gt 2', 'gt 3', 'gt 4', 'watch fit', 'watch s', '红米watch',
    ],
    generic: ['手表', '手环', 'watch'],
  },
  earphones: {
    specific: ['airpods', 'airpod', 'freebuds', 'redmi buds', 'wf-', 'wh-', 'xm4', 'xm5', 'qc45', 'qc ultra'],
    generic: ['耳机', '降噪豆', '耳塞', 'buds'],
  },
  camera: {
    specific: ['a7m', 'a7r', 'a7c', 'eos r', 'r50', 'r62', 'z6', 'z7', 'z8', 'gfx', 'gopro', 'insta360', '大疆', '微单', '单反', '镜头'],
    generic: ['相机'],
  },
};

/** 摊平成 [{ kw, cat }]。品类泛词先声明、品牌泛词后声明：同长平局时品类词胜出 */
const KEYWORDS = (() => {
  const flat = [];
  // 「小米耳机」会同时命中 phone 泛词「小米」与 earphones 泛词「耳机」（同 2 字），
  // 此时品类词应该赢——歧义词（品牌名）默认偏向手机是错的。
  // 所以按「非手机品类 → 手机」的顺序声明泛词，phone 的品牌词永远排最后。
  const GENERIC_ORDER = ['tablet', 'watch', 'earphones', 'camera', 'laptop', 'phone'];
  for (const cat of GENERIC_ORDER) {
    for (const kw of KEYWORD_TABLE[cat].generic) flat.push({ kw, cat });
  }
  for (const [cat, table] of Object.entries(KEYWORD_TABLE)) {
    for (const kw of table.specific) flat.push({ kw, cat });
  }
  return flat;
})();

/** 品类 value → 中文标签；未知值返回 null */
export function categoryLabel(value) {
  const opt = CATEGORY_OPTIONS.find((o) => o.value === value && o.value !== 'auto');
  return opt ? opt.label : null;
}

/**
 * 从设备名称推断品类。
 * @param {string} deviceName
 * @returns {'phone'|'tablet'|'laptop'|'watch'|'earphones'|'camera'|null}
 *   null 表示无法推断。绝不返回 'other'——那等于替用户做了「没有参考数据」的判断。
 */
export function inferCategory(deviceName) {
  if (typeof deviceName !== 'string') return null;
  const name = deviceName.trim().toLowerCase();
  if (!name) return null;

  let best = null;
  for (const { kw, cat } of KEYWORDS) {
    if (!name.includes(kw)) continue;
    // 最长命中优先；同长时先声明者优先（品类泛词先于品牌泛词）
    if (!best || kw.length > best.kw.length) best = { kw, cat };
  }
  return best ? best.cat : null;
}
