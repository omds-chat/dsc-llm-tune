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
  | 'settings:surface'
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
 * 能力 settings:surface 的字段描述(契约的本地副本,形状以引擎 pluginSettings.ts 为准)。
 * 插件在激活期登记一份字段描述,宿主据此渲染设置表单;控件形态、样式与渲染归宿主。
 */
export type SettingFieldType = 'switch' | 'select' | 'number' | 'text' | 'secret'

/** 设置字段的值;只有标量 */
export type SettingValue = string | number | boolean

/** 单个设置字段的描述;只覆盖本插件用到的类型与约束 */
export interface SettingFieldDescriptor {
  /** 字段键,同一份描述内不得重复,也是设置存储的键 */
  readonly key: string
  readonly type: SettingFieldType
  /** 字段标签;labelKey 必须是宿主 i18n 字典里的键,与 label 二选一 */
  readonly labelKey?: string
  /** 字段标签;插件直给的文案(1 到 40 字符) */
  readonly label?: string
  /** 默认值;非 secret 字段必填,须通过该字段自己的取值校验 */
  readonly default?: SettingValue
  /** number 的取值范围 */
  readonly min?: number
  readonly max?: number
  /** number 的步进;只影响宿主控件交互,不参与校验 */
  readonly step?: number
  /** text 的长度上限 */
  readonly maxLength?: number
}

/** 一份设置表面描述 */
export interface SettingDescriptor {
  /** 字段清单;至少一个字段,同一插件只保留最后登记的一份 */
  readonly fields: readonly SettingFieldDescriptor[]
}

/**
 * 能力 settings:surface 与 settings:locale 的设置入口。
 * register 在激活期登记字段描述,返回释放函数,停用随引擎清理;描述非法时抛错。
 * values 只读自身设置命名空间:用户覆盖值优先,否则默认值;同步返回。
 */
export interface PluginSettingsApi {
  /** 当前宿主语言,用于插件直给文案的选词 */
  locale(): Promise<'zh-CN' | 'en-US'>
  register(descriptor: SettingDescriptor): () => void
  values(): Record<string, SettingValue>
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
 * 本插件申请 notify、plugins:storage、chat:request、settings:locale 与 settings:surface。
 */
export interface PluginContext {
  /** 当前插件 id,与清单一致 */
  readonly id: string
  /** 当前插件版本,与清单一致 */
  readonly version: string
  /** 写入该插件的日志,可在插件面板的「查看日志」中读取 */
  log(message: string): void
  ui: PluginUiApi
  settings: PluginSettingsApi
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
