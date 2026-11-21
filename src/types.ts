/**
 * dsc 插件契约的精简类型声明。
 *
 * 这份声明是契约的本地副本,只覆盖本插件用到的字段与能力对象。
 * 若与 DeepSeek-Chat-Enhanced 源码不一致,以该源码为准。
 * 契约速查：.agents/dsc-plugin-contract.md(组织内只读文件)。
 */

/** 清单中的能力名,取值来自引擎的能力表 */
export type DscCapability =
  | 'sessions:list'
  | 'sessions:read'
  | 'sessions:rename'
  | 'events:session'
  | 'notify'
  | 'settings:locale'
  | 'plugins:storage'
  | 'net:fetch'
  | 'chat:request'

/** 挂载点:会话切换事件与请求前环节 */
export type DscMount = 'session:changed' | 'chat:before-request'

/**
 * 插件清单。
 * id 须匹配 ^[a-z][a-z0-9-]{2,63}$,version 为三段数字,capabilities 不得重复。
 */
export interface PluginManifest {
  id: string
  name: string
  version: string
  /** 兼容的 dsc-core 版本范围,支持 ^ ~ >= <= 与精确版本 */
  engines?: string
  /** 依赖的插件 id,安装时须已存在,激活时须已激活 */
  dependencies?: string[]
  /** 冲突的插件 id,同时安装会被拒绝 */
  conflicts?: string[]
  capabilities: DscCapability[]
  mounts?: DscMount[]
}

/**
 * 能力 notify。
 * key 取自宿主 i18n 的既有文案键,插件不自造文案。
 */
export interface PluginUiApi {
  notify(key: string, params?: Record<string, string | number>): void
}

/**
 * 能力 plugins:storage。
 * 值须可 JSON 序列化,单插件上限 64KB,键名非空且不超过 64 字符,缺失的键返回 null。
 */
export interface PluginStorageApi {
  get(key: string): unknown
  set(key: string, value: unknown): void
  remove(key: string): void
}

/** 请求前的只读切片;本插件不读切片内容,参数与用户消息无关 */
export interface ChatRequestPreview {
  readonly lastUserMessage: string
}

/**
 * 请求补丁,插件能返回的全部字段,全部可缺省。
 * 引擎按白名单收敛:未知字段丢弃,越界值按边界裁剪,超时或抛错时整份补丁作废。
 */
export interface ChatRequestPatch {
  /** 0 到 2 */
  temperature?: number
  /** 0 到 1 */
  topP?: number
  /** 1 到 4096 的正整数 */
  maxTokens?: number
  /** 最多 4 条,每条最多 32 字符 */
  stop?: string[]
  /** 追加到系统提示词之后,最多 2000 字符 */
  systemPromptAppend?: string
  /** 整体替换系统提示词,最多 8000 字符 */
  systemPromptReplace?: string
}

/** 请求前处理器;返回补丁、null 或什么都不返回,三者都表示不改请求 */
export type ChatBeforeRequestHandler = (
  preview: ChatRequestPreview,
) => ChatRequestPatch | null | undefined

/**
 * 能力 chat:request。
 * 处理器在每次发请求前同步调用一次,全部处理器共用 10 毫秒预算;
 * 返回释放函数,引擎在停用与卸载时自动执行,插件不要自行重复调用。
 */
export interface PluginChatApi {
  onBeforeRequest(handler: ChatBeforeRequestHandler): () => void
}

/**
 * 激活时注入的上下文。
 * 各能力成员只在清单申请了对应能力时可用,未申请时调用抛 PluginCapabilityError。
 * 本插件只申请 notify、plugins:storage 与 chat:request,因此只声明这三项能力对象。
 */
export interface PluginContext {
  /** 当前插件 id,与清单一致 */
  readonly id: string
  /** 当前插件版本,与清单一致 */
  readonly version: string
  /** 写入该插件的日志,可在插件面板的「查看日志」中读取 */
  log(message: string): void
  ui: PluginUiApi
  storage: PluginStorageApi
  chat: PluginChatApi
}

/**
 * 插件对象。
 * activate 超时 5 秒,deactivate 超时 3 秒,返回值均被忽略。
 */
export interface DscPlugin {
  activate(context: PluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
