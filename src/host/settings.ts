import type { ParameterSet } from '../tuning/params.js'
import { MAX_TOKENS_MAX, MAX_TOKENS_MIN, STOP_MAX_COUNT, STOP_MAX_LENGTH, TEMPERATURE_MAX, TEMPERATURE_MIN, TOP_P_MAX, TOP_P_MIN } from '../tuning/params.js'
import type { SettingDescriptor, SettingValue } from '../types.js'

/**
 * 宿主设置表面(settings:surface)这一侧的形状与取值。
 *
 * 插件在激活期用 context.settings.register 登记一份字段描述,宿主据此渲染设置表单;
 * 请求前用 context.settings.values() 读当前生效值,与导入参数按优先级合并。
 * 这里只交描述与读取,渲染、样式与写侧全部归宿主:插件用 storage.set 写不到设置表。
 */

/** 设置表面字段键;也是设置存储里的键,登记后不得改名 */
export const SETTINGS_KEY_ENABLED = 'enabled'
export const SETTINGS_KEY_TEMPERATURE = 'temperature'
export const SETTINGS_KEY_TOP_P = 'topP'
export const SETTINGS_KEY_MAX_TOKENS = 'maxTokens'
export const SETTINGS_KEY_STOP = 'stop'

/**
 * 各字段的登记默认值。
 *
 * 引擎要求非 secret 字段必须给 default,而本插件不提供预设:默认值在这里只承担
 * 「未被用户改动」的哨兵职责。请求前按「生效值 != 默认值」判定用户是否真的改过
 * 这一字段,未改动的字段回落导入参数,因此默认值平时不会进补丁。
 * 三个数值取 DeepSeek API 的默认口径(1 / 1 / 4096),开关与停止词按关闭与留空处理。
 */
export const SETTINGS_DEFAULTS: Record<string, SettingValue> = {
  [SETTINGS_KEY_ENABLED]: false,
  [SETTINGS_KEY_TEMPERATURE]: 1,
  [SETTINGS_KEY_TOP_P]: 1,
  [SETTINGS_KEY_MAX_TOKENS]: MAX_TOKENS_MAX,
  [SETTINGS_KEY_STOP]: '',
}

/** 停止词文本的长度上限;4 条 32 字符加逗号分隔绰绰有余,再长按无效输入拒绝 */
export const SETTINGS_STOP_MAX_LENGTH = 200

/** 字段标签的 zh/en 词条成对登记,激活时按宿主语言取一侧 */
type SettingLabelTable = Record<
  | typeof SETTINGS_KEY_ENABLED
  | typeof SETTINGS_KEY_TEMPERATURE
  | typeof SETTINGS_KEY_TOP_P
  | typeof SETTINGS_KEY_MAX_TOKENS
  | typeof SETTINGS_KEY_STOP,
  { 'zh-CN': string; 'en-US': string }
>

const SETTING_LABELS: SettingLabelTable = {
  [SETTINGS_KEY_ENABLED]: {
    'zh-CN': '启用设置页参数',
    'en-US': 'Use settings page values',
  },
  [SETTINGS_KEY_TEMPERATURE]: {
    'zh-CN': '温度 temperature(0 到 2)',
    'en-US': 'Temperature (0 to 2)',
  },
  [SETTINGS_KEY_TOP_P]: {
    'zh-CN': 'top_p(0 到 1)',
    'en-US': 'top_p (0 to 1)',
  },
  [SETTINGS_KEY_MAX_TOKENS]: {
    'zh-CN': '最大生成 token 数(1 到 4096)',
    'en-US': 'Max tokens (1 to 4096)',
  },
  [SETTINGS_KEY_STOP]: {
    'zh-CN': '停止词,逗号分隔(最多 4 条)',
    'en-US': 'Stop sequences, comma separated (up to 4)',
  },
}

/** 描述登记接受的宿主语言;缺省按中文处理 */
export type SettingsLocale = 'zh-CN' | 'en-US'

const labelOf = (key: keyof SettingLabelTable, locale: SettingsLocale): string =>
  SETTING_LABELS[key][locale]

/**
 * 构造设置表面描述。
 *
 * 字段边界与参数校验层(tuning/params.ts)共用同一组常量,两侧不会各自漂移;
 * default 由引擎按字段自身校验,数值默认取 API 默认口径,见 SETTINGS_DEFAULTS 的说明。
 */
export const createSettingsDescriptor = (locale: SettingsLocale): SettingDescriptor => ({
  fields: [
    { key: SETTINGS_KEY_ENABLED, type: 'switch', label: labelOf(SETTINGS_KEY_ENABLED, locale), default: SETTINGS_DEFAULTS[SETTINGS_KEY_ENABLED] as boolean },
    { key: SETTINGS_KEY_TEMPERATURE, type: 'number', label: labelOf(SETTINGS_KEY_TEMPERATURE, locale), default: SETTINGS_DEFAULTS[SETTINGS_KEY_TEMPERATURE] as number, min: TEMPERATURE_MIN, max: TEMPERATURE_MAX, step: 0.1 },
    { key: SETTINGS_KEY_TOP_P, type: 'number', label: labelOf(SETTINGS_KEY_TOP_P, locale), default: SETTINGS_DEFAULTS[SETTINGS_KEY_TOP_P] as number, min: TOP_P_MIN, max: TOP_P_MAX, step: 0.01 },
    { key: SETTINGS_KEY_MAX_TOKENS, type: 'number', label: labelOf(SETTINGS_KEY_MAX_TOKENS, locale), default: SETTINGS_DEFAULTS[SETTINGS_KEY_MAX_TOKENS] as number, min: MAX_TOKENS_MIN, max: MAX_TOKENS_MAX, step: 1 },
    { key: SETTINGS_KEY_STOP, type: 'text', label: labelOf(SETTINGS_KEY_STOP, locale), default: SETTINGS_DEFAULTS[SETTINGS_KEY_STOP] as string, maxLength: SETTINGS_STOP_MAX_LENGTH },
  ],
})

/**
 * 停止词文本 -> 停止词数组。
 *
 * 设置页只有一个文本框,按逗号分隔;分隔与导入路径的数组形状不同,这里每条去掉
 * 首尾空白(逗号分隔的一行文本里,条目周围的空白按分隔格式处理,不算停止词内容,
 * 要保留空白的停止词请走导入入口),空条目丢弃,重复项保留第一份。
 * 超过 4 条或某条超过 32 个字符时整份返回 null,由调用方回落导入值,不做裁剪。
 */
export const stopFromText = (text: string): string[] | null => {
  const items: string[] = []
  for (const piece of text.split(',')) {
    const item = piece.trim()
    if (item === '') continue
    if ([...item].length > STOP_MAX_LENGTH) return null
    if (!items.includes(item)) items.push(item)
  }
  if (items.length === 0 || items.length > STOP_MAX_COUNT) return null
  return items
}

/** 设置字段声明可用的字段键,用于逐字段核对类型与边界 */
const NUMBER_RANGES = {
  [SETTINGS_KEY_TEMPERATURE]: { min: TEMPERATURE_MIN, max: TEMPERATURE_MAX },
  [SETTINGS_KEY_TOP_P]: { min: TOP_P_MIN, max: TOP_P_MAX },
  [SETTINGS_KEY_MAX_TOKENS]: { min: MAX_TOKENS_MIN, max: MAX_TOKENS_MAX },
} as const

/**
 * 读设置里的一个数值字段;无效或未改动(等于登记默认值)时返回 undefined。
 *
 * 宿主写侧已按 min/max 校验,这里再核一遍范围是防描述变更后的旧值:
 * 越界值不进补丁,宁可回落导入值,也不把一个可疑数字发给宿主。
 */
const readSettingsNumber = (
  values: Record<string, SettingValue>,
  key: keyof typeof NUMBER_RANGES,
): number | undefined => {
  const raw = values[key]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  if (raw === SETTINGS_DEFAULTS[key]) return undefined
  const { min, max } = NUMBER_RANGES[key]
  if (raw < min || raw > max) return undefined
  if (key === SETTINGS_KEY_MAX_TOKENS && !Number.isInteger(raw)) return undefined
  return raw
}

/**
 * 按优先级合并设置值与导入参数。
 *
 * 优先级(逐字段判定,写进 docs/design/parameter-tuning.md 6.3 节):
 *   1. 总开关 enabled 打开且该字段的生效值不等于登记默认值(即用户在设置页改过)
 *      -> 以设置页为准;
 *   2. 否则回落导入参数(存储读取或 importParameters 交付的那一份);
 *   3. 两侧都没有 -> 该字段不进补丁;四个字段都没有时返回 null。
 *
 * 总开关关闭时设置页整体不参与,参数完全由导入路径决定,这是导入入口保持兼容
 * 可用的前提:老用户只导入不碰设置页时,行为与设置表面落地前一致。
 * settingsValues 为 null 表示读不到设置值(未申请能力、宿主过旧或读取抛错),
 * 与「开关关闭」同样按回落导入处理。
 */
export const resolveParameters = (
  settingsValues: Record<string, SettingValue> | null,
  imported: ParameterSet | null,
): ParameterSet | null => {
  const armed = settingsValues !== null && settingsValues[SETTINGS_KEY_ENABLED] === true

  let settingsTemperature: number | undefined
  let settingsTopP: number | undefined
  let settingsMaxTokens: number | undefined
  let settingsStop: readonly string[] | undefined

  if (armed && settingsValues !== null) {
    settingsTemperature = readSettingsNumber(settingsValues, SETTINGS_KEY_TEMPERATURE)
    settingsTopP = readSettingsNumber(settingsValues, SETTINGS_KEY_TOP_P)
    settingsMaxTokens = readSettingsNumber(settingsValues, SETTINGS_KEY_MAX_TOKENS)

    const stopRaw = settingsValues[SETTINGS_KEY_STOP]
    if (typeof stopRaw === 'string' && stopRaw !== SETTINGS_DEFAULTS[SETTINGS_KEY_STOP]) {
      const stop = stopFromText(stopRaw)
      if (stop !== null) settingsStop = stop
    }
  }

  // 设置页有取值用设置页,否则用导入层;两处都没有时该字段缺省
  const temperature = settingsTemperature !== undefined ? settingsTemperature : imported?.temperature
  const topP = settingsTopP !== undefined ? settingsTopP : imported?.topP
  const maxTokens = settingsMaxTokens !== undefined ? settingsMaxTokens : imported?.maxTokens
  const stop = settingsStop !== undefined ? settingsStop : imported?.stop

  const params: ParameterSet = {}
  if (temperature !== undefined) params.temperature = temperature
  if (topP !== undefined) params.topP = topP
  if (maxTokens !== undefined) params.maxTokens = maxTokens
  if (stop !== undefined) params.stop = stop

  return Object.keys(params).length === 0 ? null : params
}
