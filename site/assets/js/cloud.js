/**
 * cloud.js — 云服务客户端（单实例，惰性初始化）
 *
 * 全程只初始化一次，所有模块复用同一个 client。
 * CDN 形态下工厂函数挂在全局 WorkBuddyCloud 上，不使用 import。
 *
 * 初始化失败或未配置时返回 null，调用方必须自行降级——绝不因此让页面功能整体失效。
 */

import { cloudConfig, isCloudConfigured } from './config.js';

let client = null;
let attempted = false;

export function getCloud() {
  if (attempted) return client;
  attempted = true;

  if (!isCloudConfigured()) return null;

  const factory = globalThis.WorkBuddyCloud?.createWorkBuddyCloud;
  if (typeof factory !== 'function') {
    console.warn('[cloud] SDK 未加载，云能力降级为本地模式');
    return null;
  }

  try {
    client = factory({
      endpoint: cloudConfig.endpoint,
      publishableKey: cloudConfig.publishableKey,
    });
  } catch (err) {
    console.warn('[cloud] 初始化失败，云能力降级为本地模式', err?.message || err);
    client = null;
  }
  return client;
}
