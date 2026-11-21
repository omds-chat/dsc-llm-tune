import type { ParameterSet } from '../tuning/params.js'
import type { ChatBeforeRequestHandler, ChatRequestPatch } from '../types.js'

/** 请求前处理器的装配参数 */
export interface RequestHandlerOptions {
  /** 当前生效的参数;null 表示用户没有设定,处理器不改请求 */
  params: () => ParameterSet | null
}

/**
 * 把参数集合映射成宿主补丁。
 *
 * 只给宿主支持的字段,四个参数一一对应;数值与长度不在插件里二次裁剪,
 * 导入时已按同一套边界校验,越界值到不了这一层。
 * 没有任何字段时返回 null,表示不改请求。
 */
const toPatch = (params: ParameterSet): ChatRequestPatch | null => {
  const patch: ChatRequestPatch = {}

  if (params.temperature !== undefined) patch.temperature = params.temperature
  if (params.topP !== undefined) patch.topP = params.topP
  if (params.maxTokens !== undefined) patch.maxTokens = params.maxTokens
  if (params.stop !== undefined && params.stop.length > 0) patch.stop = [...params.stop]

  return Object.keys(patch).length === 0 ? null : patch
}

/**
 * 创建宿主请求前处理器。
 *
 * 链路:读取当前生效的参数 -> 映射成宿主补丁。参数与最后一条用户消息无关,
 * 处理器不读请求切片,也不按内容分支;没有设定时返回 null,请求保持原样。
 * 处理器在每次请求前同步调用一次,全部处理器共用 10 毫秒预算,这一层只做字段拷贝。
 */
export const createBeforeRequestHandler = (
  options: RequestHandlerOptions,
): ChatBeforeRequestHandler => () => {
  const params = options.params()
  if (params === null) return null

  return toPatch(params)
}
