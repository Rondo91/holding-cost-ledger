/**
 * config.js — 云服务公开配置
 *
 * 这两个值在开通云服务时由后端返回，都是**端上公开值**：
 *   - publishableKey 只标识是哪个应用，本身不带任何权限；服务端按 Origin 精确匹配校验
 *   - endpoint 是当前应用的发布域名数据面地址，必须原样传入，不能从 location 或环境变量猜
 *
 * 两者为空时站点会以「纯本地模式」运行：埋点写入浏览器 localStorage，截图识别入口隐藏，
 * 页面其余功能完全不受影响。
 */

export const cloudConfig = {
  endpoint: 'https://holding-cost-ledger.app.workbuddy.host',
  publishableKey: 'wbpk_luR1UqYSQiVirNKLHuc6bI_YiqG5d7q4RuOm9kvMj5cvpQH1fGbAr46',
};

export function isCloudConfigured() {
  return Boolean(cloudConfig.endpoint && cloudConfig.publishableKey);
}
