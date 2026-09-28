import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rankVisionModels } from '../assets/js/ocr.js';

const M = (props) => ({ id: props.id, name: props.name ?? props.id, ...props });

test('目录为空或不是数组时返回空列表', () => {
  assert.deepEqual(rankVisionModels([]), []);
  assert.deepEqual(rankVisionModels(null), []);
  assert.deepEqual(rankVisionModels(undefined), []);
  assert.deepEqual(rankVisionModels('nope'), []);
});

test('剔除不可用、不支持图片、以及被显式关闭多模态的模型', () => {
  const models = [
    M({ id: 'disabled-one', supportsImages: true, disabled: true }),
    M({ id: 'text-only', supportsImages: false }),
    M({ id: 'multimodal-off', supportsImages: true, disabledMultimodal: true }),
    M({ id: 'no-flag' }),                       // 稀疏字段：没有 supportsImages 就不算支持
    M({ id: 'ok', supportsImages: true }),
  ];
  assert.deepEqual(rankVisionModels(models).map((m) => m.id), ['ok']);
});

test('不支持图片的默认模型也不能入选', () => {
  const models = [
    M({ id: 'default', supportsImages: false, isDefault: true }),
    M({ id: 'vision', supportsImages: true }),
  ];
  assert.deepEqual(rankVisionModels(models).map((m) => m.id), ['vision']);
});

test('非推理模型排在推理模型前面', () => {
  const models = [
    M({ id: 'thinking', supportsImages: true, onlyReasoning: true }),
    M({ id: 'plain-vision', supportsImages: true }),
  ];
  assert.equal(rankVisionModels(models)[0].id, 'plain-vision');
});

test('同档位内保持目录原有顺序（排序稳定）', () => {
  const models = [
    M({ id: 'a', supportsImages: true }),
    M({ id: 'b', supportsImages: true }),
    M({ id: 'c', supportsImages: true, onlyReasoning: true }),
  ];
  assert.deepEqual(rankVisionModels(models).map((m) => m.id), ['a', 'b', 'c']);
});

test('非推理且是平台默认的排最前', () => {
  const models = [
    M({ id: 'plain', supportsImages: true }),
    M({ id: 'plain-default', supportsImages: true, isDefault: true }),
    M({ id: 'thinking-default', supportsImages: true, onlyReasoning: true, isDefault: true }),
  ];
  assert.deepEqual(rankVisionModels(models).map((m) => m.id),
    ['plain-default', 'plain', 'thinking-default']);
});

test('稀疏字段：onlyReasoning 缺失视为未知，不因此被排到推理模型后面', () => {
  const models = [
    M({ id: 'declared-thinking', supportsImages: true, onlyReasoning: true }),
    M({ id: 'unknown', supportsImages: true }),   // 没有 onlyReasoning 字段
  ];
  assert.equal(rankVisionModels(models)[0].id, 'unknown');
});

test('纯推理的模型即使身为平台默认，也要排在非推理模型之后', () => {
  const base = [
    M({ id: 'auto', supportsImages: true, onlyReasoning: true, isDefault: true }),
    M({ id: 'glm-4.6v', supportsImages: true }),
  ];
  // 纯推理但身为平台默认，只能排在非推理之后
  assert.deepEqual(rankVisionModels(base).map((m) => m.id), ['glm-4.6v', 'auto']);
});

test('真实目录形状：优先挑到非推理的视觉模型，而不是平台默认的推理模型', () => {
  const models = [
    M({ id: 'auto', supportsImages: true, onlyReasoning: true, isDefault: true }),
    M({ id: 'hy3', supportsImages: true, onlyReasoning: true }),
    M({ id: 'glm-5.3', supportsImages: true, onlyReasoning: true }),
    M({ id: 'glm-4.6v', supportsImages: true }),
    M({ id: 'default', supportsImages: false }),
    M({ id: 'glm-4.7', supportsImages: false }),
    M({ id: 'kimi-k2.6', supportsImages: true, onlyReasoning: true }),
  ];
  const ranked = rankVisionModels(models).map((m) => m.id);
  assert.equal(ranked[0], 'glm-4.6v');
  assert.equal(ranked[1], 'auto', '平台默认排在第二，作为换模型重试的兜底');
});

test('不修改传入的原数组', () => {
  const models = [
    M({ id: 'thinking', supportsImages: true, onlyReasoning: true }),
    M({ id: 'plain', supportsImages: true }),
  ];
  rankVisionModels(models);
  assert.deepEqual(models.map((m) => m.id), ['thinking', 'plain']);
});
