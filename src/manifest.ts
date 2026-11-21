import type { PluginManifest } from './types.js'

/**
 * 插件清单,从地址安装时由产物自带的 manifest 提供。
 *
 * conflicts 是本插件这一侧的互斥声明:dsc-humanize 也改写同一次请求的采样参数,
 * 两者同时安装时补丁会按登记顺序互相覆盖,因此按「同时安装即拒绝」处理。
 * 双向互斥的另一侧由 dsc-humanize 的清单声明。
 *
 * settings:locale 与 settings:surface 是宿主插件设置表面的两项申请:前者读宿主语言
 * 用于字段标签选词,后者在激活期登记参数字段描述,由宿主渲染设置表单。
 */
export const manifest: PluginManifest = {
  id: 'dsc-llm-tune',
  name: 'LLM Tune',
  version: '0.1.0',
  engines: '^1.0.0',
  conflicts: ['dsc-humanize'],
  capabilities: ['notify', 'plugins:storage', 'chat:request', 'settings:locale', 'settings:surface'],
  mounts: ['chat:before-request'],
}
