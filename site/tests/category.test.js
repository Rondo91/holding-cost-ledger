import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CATEGORY_OPTIONS, categoryLabel, inferCategory } from '../assets/js/category.js';

test('CATEGORY_OPTIONS 不含重复 value，且 auto 在最前', () => {
  const values = CATEGORY_OPTIONS.map((o) => o.value);
  assert.equal(new Set(values).size, values.length);
  assert.equal(values[0], 'auto');
});

test('categoryLabel 返回中文标签，auto 与未知值返回 null', () => {
  assert.equal(categoryLabel('phone'), '手机');
  assert.equal(categoryLabel('watch'), '手表手环');
  assert.equal(categoryLabel('auto'), null);
  assert.equal(categoryLabel('nope'), null);
  assert.equal(categoryLabel(null), null);
});

test('常见型号按 specific 词命中正确品类', () => {
  assert.equal(inferCategory('iPhone 13 128G'), 'phone');
  assert.equal(inferCategory('华为 P40 Pro'), 'phone');
  assert.equal(inferCategory('红米K40'), 'phone');
  assert.equal(inferCategory('iPad Air'), 'tablet');
  assert.equal(inferCategory('Apple Watch Series 9'), 'watch');
  assert.equal(inferCategory('AirPods Pro 2'), 'earphones');
  assert.equal(inferCategory('GoPro 12'), 'camera');
});

test('品牌×品类冲突时最长命中优先：华为 MateBook 是笔记本不是手机', () => {
  assert.equal(inferCategory('华为 MateBook 14'), 'laptop');
  assert.equal(inferCategory('小米手环 8'), 'watch');
  assert.equal(inferCategory('小米平板 6'), 'tablet');
  assert.equal(inferCategory('华为平板'), 'tablet');
  assert.equal(inferCategory('小米耳机'), 'earphones');
});

test('品类泛词与品牌词同长时品类词优先（声明顺序）', () => {
  // 「三星平板」同时命中「三星」(phone generic) 与「平板」(tablet generic)，都是 2 字
  assert.equal(inferCategory('三星平板'), 'tablet');
  // 「三星手机」两个词都指向手机
  assert.equal(inferCategory('三星手机'), 'phone');
});

test('大小写与首尾空格不敏感', () => {
  assert.equal(inferCategory('  IPHONE 15 PRO '), 'phone');
  assert.equal(inferCategory('MacBook Air'), 'laptop');
});

test('无法推断时返回 null，绝不静默归入 other', () => {
  assert.equal(inferCategory('戴森吹风机'), null);
  assert.equal(inferCategory('一些完全无关的文字'), null);
  assert.equal(inferCategory(''), null);
  assert.equal(inferCategory('   '), null);
  assert.equal(inferCategory(null), null);
  assert.equal(inferCategory(undefined), null);
  assert.equal(inferCategory(123), null);
});
