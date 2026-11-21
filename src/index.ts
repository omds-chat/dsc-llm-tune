import { createBeforeRequestHandler } from './host/request-patch.js'
import {
  PARAMS_STORAGE_KEY,
  createParameterDocument,
  readStoredParameters,
} from './host/store.js'
import { manifest } from './manifest.js'
import { readParameters } from './tuning/params.js'
import type { ParameterError, ParameterSet } from './tuning/params.js'
import type { PluginContext, PluginStorageApi } from './types.js'

export { manifest }
export * from './tuning/params.js'
export * from './host/store.js'
export * from './host/request-patch.js'

// 首次激活提示使用的宿主文案键,取自宿主 i18n 的既有键,插件不自造文案
const INSTALL_NOTICE_KEY = 'pluginInstallDone'

// chat.onBeforeRequest 返回的释放函数由引擎在停用与卸载时自动执行,这里只保留引用用于观察
let releaseRequestHandler: (() => void) | null = null
let active = false
let firstActivation = true

/**
 * 当前生效的参数。
 * 由激活时的存储读取或 importParameters 交付给装配;null 表示用户没有设定,请求保持原样。
 */
let activeParams: ParameterSet | null = null

/** 激活时拿到的插件存储引用;未激活时为空,导入只装配到内存 */
let storage: PluginStorageApi | null = null

/** 激活时拿到的日志出口;未激活时不写日志 */
let logger: ((message: string) => void) | null = null

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const log = (message: string): void => {
  logger?.(manifest.id + ': ' + message)
}

/** 参数集合里出现过的字段名,用于激活与导入后的日志 */
const describeParameters = (params: ParameterSet): string => {
  const keys: string[] = []
  if (params.temperature !== undefined) keys.push('temperature')
  if (params.topP !== undefined) keys.push('topP')
  if (params.maxTokens !== undefined) keys.push('maxTokens')
  if (params.stop !== undefined && params.stop.length > 0) keys.push('stop')
  return keys.length === 0 ? 'none' : keys.join(', ')
}

/**
 * 当前生效的参数,供将来的插件设置面板读取。
 * 未激活或用户没有设定时返回 null。
 */
export const getActiveParameters = (): ParameterSet | null => activeParams

/**
 * 从插件存储读取参数文档并装配。
 *
 * 先清空再读:只有文档存在且合法才交付,缺失、版本不符、字段非法都保持未设定,
 * 请求按原样发出,不阻断激活,也不做部分保留。激活之后由 importParameters 与
 * clearParameters 替换状态,下一次激活重新以存储为准。
 */
const loadStoredParameters = (): void => {
  activeParams = null

  const target = storage
  if (target === null) return

  let raw: unknown
  try {
    raw = target.get(PARAMS_STORAGE_KEY)
  } catch (error) {
    log('读取参数文档失败,请求保持原样: ' + describeError(error))
    return
  }

  const result = readStoredParameters(raw)
  if (result.status === 'absent') {
    log('未找到参数文档(' + PARAMS_STORAGE_KEY + '),请求保持原样')
    return
  }
  if (result.status === 'invalid') {
    log('参数文档不可用(' + result.error.code + '),请求保持原样: ' + result.error.message)
    return
  }

  activeParams = result.params
  log('已装配参数: ' + describeParameters(result.params))
}

/** 参数导入结果:成功给出参数与是否已写入存储,失败给出校验错误 */
export type ParameterImportResult =
  | { ok: true; params: ParameterSet; persisted: boolean }
  | { ok: false; error: ParameterError }

/**
 * 显式导入一份参数文档(JSON 文本),供将来的插件设置面板与当前的过渡入口调用。
 *
 * 这是插件目前唯一的设定入口:宿主还没有提供插件设置界面能力,用户把 JSON 文本交给
 * 这个函数即可生效,形状见 docs/design/parameter-tuning.md 4 节。
 *
 * 与 activate 的分工:这一条走完整的读取与校验,成功才替换当前生效的参数,
 * 并在已激活时把同一份参数写进插件存储;写入失败不回滚内存里的装配结果,
 * 只把 persisted 置为 false 并写日志,因为请求已经能按新参数改写。
 * 未激活时只装配到内存,下次激活会重新读存储。
 */
export const importParameters = (jsonText: string): ParameterImportResult => {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText) as unknown
  } catch {
    return { ok: false, error: { code: 'invalid-json', message: '参数文档不是合法 JSON' } }
  }

  const result = readParameters(parsed)
  if (!result.ok) return { ok: false, error: result.error }

  const params = result.params
  activeParams = params

  const target = storage
  if (target === null) {
    log('导入参数(' + describeParameters(params) + '),当前未激活,只装配到内存')
    return { ok: true, params, persisted: false }
  }

  try {
    target.set(PARAMS_STORAGE_KEY, createParameterDocument(params))
    log('导入参数(' + describeParameters(params) + '),已写入插件存储')
    return { ok: true, params, persisted: true }
  } catch (error) {
    log('导入参数(' + describeParameters(params) + '),已装配但写入插件存储失败: ' + describeError(error))
    return { ok: true, params, persisted: false }
  }
}

/**
 * 清除用户设定的参数,请求回到原样。
 *
 * 已激活时同时删除插件存储里的参数文档;删除失败只写日志,内存里的参数仍然被清空。
 * 返回是否已从插件存储删除,未激活时返回 false,只清内存。
 */
export const clearParameters = (): boolean => {
  activeParams = null

  const target = storage
  if (target === null) {
    log('清除参数:当前未激活,只清内存')
    return false
  }

  try {
    target.remove(PARAMS_STORAGE_KEY)
    log('清除参数:已删除插件存储里的参数文档')
    return true
  } catch (error) {
    log('清除参数:删除插件存储里的参数文档失败: ' + describeError(error))
    return false
  }
}

/**
 * 启动入口,引擎在激活时调用,超时 5 秒。
 * 返回值被忽略,不要用它传递释放函数。
 */
export const activate = (context: PluginContext): void => {
  if (active) {
    context.log(manifest.id + ': already active, skip activate')
    return
  }

  active = true
  logger = (message) => context.log(message)
  storage = context.storage

  const conflicts = manifest.conflicts ?? []
  context.log(
    manifest.id + ': activated, capabilities ' + manifest.capabilities.join(', ')
    + ', conflicts ' + (conflicts.length === 0 ? 'none' : conflicts.join(', ')),
  )

  // 先取参数再登记处理器:处理器每次请求重新读取 activeParams,顺序不影响结果,
  // 但先装配能让激活日志与首次请求看到同一份参数
  loadStoredParameters()

  releaseRequestHandler = context.chat.onBeforeRequest(
    createBeforeRequestHandler({
      params: () => activeParams,
    }),
  )

  if (firstActivation) {
    firstActivation = false
    context.ui.notify(INSTALL_NOTICE_KEY)
  }
}

/**
 * 停用入口,引擎在停用与卸载时调用,超时 3 秒。
 *
 * 注意：请求前处理器的释放函数由引擎自动执行,此处不再重复调用,
 * 只丢弃本地引用并复位插件自身的状态。当前生效的参数在停用期间保留,
 * 下一次激活以插件存储为准。
 */
export const deactivate = (): void => {
  // 释放函数由引擎自动执行,这里不重复调用,只丢弃本地引用
  if (releaseRequestHandler !== null) {
    releaseRequestHandler = null
  }
  storage = null
  logger = null
  active = false
}
