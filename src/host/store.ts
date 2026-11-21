import { PARAMS_VERSION, readParameters } from '../tuning/params.js'
import type { ParameterError, ParameterSet } from '../tuning/params.js'

/**
 * 参数文档在插件存储里的键名。
 *
 * 键名与形状按 docs/design/parameter-tuning.md 4 节的过渡约定先定一版,标注为可调整:
 * 宿主的「插件设置」表面落定后,参数可能改由宿主设置项承载,这一层再跟着换。
 */
export const PARAMS_STORAGE_KEY = 'dsc-llm-tune/params/v1'

/** 参数文档:插件存储里的值,也是导入入口接受的 JSON 文本形状 */
export interface ParameterDocument {
  paramsVersion: number
  temperature?: number
  topP?: number
  maxTokens?: number
  stop?: readonly string[]
}

/**
 * 参数文档在存储里的读取结果。
 * absent 表示键不存在,invalid 表示值不可用,两种都按未设定处理。
 */
export type StoredParameterRead =
  | { status: 'absent' }
  | { status: 'invalid'; error: ParameterError }
  | { status: 'ok'; params: ParameterSet }

/** 把参数集合包成一份参数文档,写法固定为一个键值,便于整份替换 */
export const createParameterDocument = (params: ParameterSet): ParameterDocument => ({
  paramsVersion: PARAMS_VERSION,
  ...(params.temperature === undefined ? {} : { temperature: params.temperature }),
  ...(params.topP === undefined ? {} : { topP: params.topP }),
  ...(params.maxTokens === undefined ? {} : { maxTokens: params.maxTokens }),
  ...(params.stop === undefined ? {} : { stop: params.stop }),
})

/**
 * 读取插件存储里的参数文档。
 *
 * 存储里的值可能来自旧版本或被外部改写,这里只接受约定的版本与形状:
 * 版本不支持、字段不合法都整份拒绝,调用方据此保持未设定,不做部分保留。
 */
export const readStoredParameters = (raw: unknown): StoredParameterRead => {
  if (raw === null || raw === undefined) return { status: 'absent' }

  const result = readParameters(raw)
  if (!result.ok) return { status: 'invalid', error: result.error }

  return { status: 'ok', params: result.params }
}
