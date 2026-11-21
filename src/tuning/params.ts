/**
 * 请求参数的取值、校验与内存形状。
 *
 * 这一层是纯函数:不读写宿主,也不读插件存储。存储读写由 src/host/store.ts 负责,
 * 参数到宿主补丁的映射由 src/host/request-patch.ts 负责。
 */

/** 参数文档的格式版本;形状变化时递增,读到其他版本按不支持处理 */
export const PARAMS_VERSION = 1

/** 温度的取值范围,与宿主补丁的上限一致 */
export const TEMPERATURE_MIN = 0
export const TEMPERATURE_MAX = 2

/** top_p 的取值范围 */
export const TOP_P_MIN = 0
export const TOP_P_MAX = 1

/** max_tokens 的取值范围 */
export const MAX_TOKENS_MIN = 1
export const MAX_TOKENS_MAX = 4096

/** 停止词的最大条数与每条的最大长度 */
export const STOP_MAX_COUNT = 4
export const STOP_MAX_LENGTH = 32

/**
 * 用户设定的请求参数。
 *
 * 字段全部可缺省:缺省的字段不进补丁,请求里的对应项保持宿主的原值。
 * 参数在导入时校验,越界值直接拒绝,不在请求时重复校验或裁剪。
 */
export interface ParameterSet {
  temperature?: number
  topP?: number
  maxTokens?: number
  stop?: readonly string[]
}

/** 参数文档读取失败的原因 */
export type ParameterErrorCode = 'invalid-json' | 'unsupported-version' | 'invalid-parameters'

/** 参数文档读取错误 */
export interface ParameterError {
  code: ParameterErrorCode
  message: string
  /** 文档内的字段路径,形如 /temperature */
  path?: string
}

/** 参数文档读取结果;不抛错,由调用方决定是否保持未设定状态 */
export type ParameterReadResult =
  | { ok: true; params: ParameterSet }
  | { ok: false; error: ParameterError }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 参数文档允许出现的顶层字段;多出来的字段一律按非法拒绝,避免写错了名字却静默生效 */
const KNOWN_FIELDS = ['paramsVersion', 'temperature', 'topP', 'maxTokens', 'stop']

const invalid = (message: string, path?: string): ParameterError =>
  path === undefined
    ? { code: 'invalid-parameters', message }
    : { code: 'invalid-parameters', message, path }

/**
 * 读取一个数值字段。
 * 缺省表示不改这一项,其它情况按类型、范围逐个校验,第一个问题写进 errors。
 */
const readNumber = (
  record: Record<string, unknown>,
  key: 'temperature' | 'topP' | 'maxTokens',
  min: number,
  max: number,
  errors: ParameterError[],
): number | undefined => {
  const raw = record[key]
  if (raw === undefined) return undefined

  const path = '/' + key
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    errors.push(invalid(key + ' 必须是数字', path))
    return undefined
  }
  if (key === 'maxTokens' && !Number.isInteger(raw)) {
    errors.push(invalid('maxTokens 必须是整数', path))
    return undefined
  }
  if (raw < min || raw > max) {
    errors.push(invalid(key + ' 必须在 ' + String(min) + ' 到 ' + String(max) + ' 之间', path))
    return undefined
  }
  return raw
}

/**
 * 读取停止词。
 *
 * 每条按原样保留,不去首尾空白:停止词经常就是换行、空格这类有意义的空白串,
 * 去空白会把用户想要的串改坏。只拒绝空字符串、重复项与超长项,条数按宿主补丁的上限;
 * 空数组按未设定处理,不进补丁。
 */
const readStop = (
  record: Record<string, unknown>,
  errors: ParameterError[],
): string[] | undefined => {
  const raw = record.stop
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    errors.push(invalid('stop 必须是字符串数组', '/stop'))
    return undefined
  }
  if (raw.length > STOP_MAX_COUNT) {
    errors.push(invalid('stop 最多 ' + String(STOP_MAX_COUNT) + ' 条', '/stop'))
    return undefined
  }

  const items: string[] = []
  for (const [index, item] of raw.entries()) {
    const path = '/stop/' + String(index)
    if (typeof item !== 'string') {
      errors.push(invalid('stop 的每一项必须是字符串', path))
      return undefined
    }
    if (item === '') {
      errors.push(invalid('stop 的每一项不能是空字符串', path))
      return undefined
    }
    if ([...item].length > STOP_MAX_LENGTH) {
      errors.push(invalid('stop 的每一项最多 ' + String(STOP_MAX_LENGTH) + ' 个字符', path))
      return undefined
    }
    items.push(item)
  }

  const unique = [...new Set(items)]
  return unique.length === 0 ? undefined : unique
}

/**
 * 读取并校验一份参数文档。
 *
 * 文档形状见 docs/design/parameter-tuning.md 4 节:顶层是 paramsVersion 与四个参数,
 * 版本不符按 unsupported-version 拒绝,字段越界或名字写错按 invalid-parameters 拒绝。
 * 任一字段不合法都整份拒绝,不做部分保留。
 */
export const readParameters = (value: unknown): ParameterReadResult => {
  if (!isObject(value)) return { ok: false, error: invalid('参数文档必须是对象') }

  if (value.paramsVersion !== PARAMS_VERSION) {
    return {
      ok: false,
      error: {
        code: 'unsupported-version',
        message: '参数文档的 paramsVersion 必须是 ' + String(PARAMS_VERSION),
        path: '/paramsVersion',
      },
    }
  }

  const errors: ParameterError[] = []
  for (const key of Object.keys(value)) {
    if (!KNOWN_FIELDS.includes(key)) errors.push(invalid('不允许的字段', '/' + key))
  }

  const temperature = readNumber(value, 'temperature', TEMPERATURE_MIN, TEMPERATURE_MAX, errors)
  const topP = readNumber(value, 'topP', TOP_P_MIN, TOP_P_MAX, errors)
  const maxTokens = readNumber(value, 'maxTokens', MAX_TOKENS_MIN, MAX_TOKENS_MAX, errors)
  const stop = readStop(value, errors)

  const first = errors[0]
  if (first !== undefined) return { ok: false, error: first }

  return {
    ok: true,
    params: {
      ...(temperature === undefined ? {} : { temperature }),
      ...(topP === undefined ? {} : { topP }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(stop === undefined ? {} : { stop }),
    },
  }
}
