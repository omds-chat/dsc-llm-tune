import assert from 'node:assert/strict'
import test from 'node:test'

import { createBeforeRequestHandler } from '../../src/host/request-patch.ts'
import { createSettingsDescriptor, SETTINGS_DEFAULTS, stopFromText } from '../../src/host/settings.ts'
import { PARAMS_STORAGE_KEY } from '../../src/host/store.ts'
import {
  activate,
  clearParameters,
  deactivate,
  getActiveParameters,
  importParameters,
} from '../../src/index.ts'
import { resolveParameters } from '../../src/host/settings.ts'
import { readParameters } from '../../src/tuning/params.ts'
import type { ParameterSet } from '../../src/tuning/params.ts'
import type {
  ChatBeforeRequestHandler,
  PluginContext,
  SettingDescriptor,
  SettingValue,
} from '../../src/types.ts'

/** 合法参数文档,各字段都在边界内 */
const VALID_DOCUMENT = JSON.stringify({
  paramsVersion: 1,
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 2048,
  stop: ['\n\nUser:'],
})

interface FakeContext {
  context: PluginContext
  handlers: ChatBeforeRequestHandler[]
  logs: string[]
  notices: string[]
  values: Map<string, unknown>
  /** 设置表面:登记的描述与设置页的当前值,由用例按需改写 */
  registered: SettingDescriptor | null
  settingsValues: Record<string, SettingValue>
  /** 设置值读取是否抛错;模拟限流等读取失败 */
  failValues: boolean
}

/**
 * 只实现本插件用到的成员:日志、notify、设置表面、插件存储与 chat:request。
 * 设置页默认没有任何覆盖值,settingsValues 为空对象等价于「开关关闭、无覆盖值」。
 */
const createFakeContext = (initial?: Record<string, unknown>): FakeContext => {
  const handlers: ChatBeforeRequestHandler[] = []
  const logs: string[] = []
  const notices: string[] = []
  const values = new Map<string, unknown>(Object.entries(initial ?? {}))

  const fake: FakeContext = {
    context: null as unknown as PluginContext,
    handlers,
    logs,
    notices,
    values,
    registered: null,
    settingsValues: {},
    failValues: false,
  }

  fake.context = {
    id: 'dsc-llm-tune',
    version: '0.1.0',
    log: (message) => {
      logs.push(message)
    },
    ui: {
      notify: (key) => {
        notices.push(key)
      },
    },
    settings: {
      locale: () => Promise.resolve('zh-CN'),
      register: (descriptor) => {
        fake.registered = descriptor
        return () => {
          fake.registered = null
        }
      },
      values: () => {
        if (fake.failValues) throw new Error('rate limited')
        return { ...fake.settingsValues }
      },
    },
    storage: {
      get: (key) => (values.has(key) ? values.get(key) : null),
      set: (key, value) => {
        values.set(key, value)
      },
      remove: (key) => {
        values.delete(key)
      },
    },
    chat: {
      onBeforeRequest: (handler) => {
        handlers.push(handler)
        return () => undefined
      },
    },
  }

  return fake
}

/** 每个用例从未激活、无参数开始,避免模块级状态互相影响 */
const reset = async (): Promise<void> => {
  deactivate()
  clearParameters()
}

test('请求前处理器: 没有设定参数时返回 null', () => {
  const handler = createBeforeRequestHandler({ params: () => null })
  assert.equal(handler({ lastUserMessage: 'hi' }), null)
})

test('请求前处理器: 参数映射成宿主补丁', () => {
  const handler = createBeforeRequestHandler({
    params: () => ({ temperature: 0.7, topP: 0.9, maxTokens: 2048, stop: ['END'] }),
  })

  assert.deepEqual(handler({ lastUserMessage: 'hi' }), {
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    stop: ['END'],
  })
})

test('请求前处理器: 参数集合为空对象时返回 null', () => {
  const handler = createBeforeRequestHandler({ params: () => ({}) })
  assert.equal(handler({ lastUserMessage: 'hi' }), null)
})

test('请求前处理器: 停止词为空数组时不进补丁', () => {
  const handler = createBeforeRequestHandler({ params: () => ({ temperature: 1, stop: [] }) })
  assert.deepEqual(handler({ lastUserMessage: 'hi' }), { temperature: 1 })
})

test('readParameters: 合法文档被接受', () => {
  const result = readParameters(JSON.parse(VALID_DOCUMENT) as unknown)
  assert.equal(result.ok, true)
  assert.deepEqual(result.ok ? result.params : null, {
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    stop: ['\n\nUser:'],
  })
})

test('readParameters: 版本不符按 unsupported-version 拒绝', () => {
  const result = readParameters({ paramsVersion: 2, temperature: 0.5 })
  assert.equal(result.ok, false)
  assert.equal(result.ok ? null : result.error.code, 'unsupported-version')
})

test('readParameters: 越界与类型错误按 invalid-parameters 拒绝', () => {
  const cases: [unknown, string][] = [
    [{ paramsVersion: 1, temperature: 3 }, '/temperature'],
    [{ paramsVersion: 1, topP: 1.5 }, '/topP'],
    [{ paramsVersion: 1, maxTokens: 0 }, '/maxTokens'],
    [{ paramsVersion: 1, maxTokens: 12.5 }, '/maxTokens'],
    [{ paramsVersion: 1, temperature: 'warm' }, '/temperature'],
    [{ paramsVersion: 1, stop: 'END' }, '/stop'],
    [{ paramsVersion: 1, stop: ['a', 'b', 'c', 'd', 'e'] }, '/stop'],
    [{ paramsVersion: 1, stop: ['x'.repeat(33)] }, '/stop/0'],
    [{ paramsVersion: 1, stop: [''] }, '/stop/0'],
    [{ paramsVersion: 1, temperature: 0.5, top_p: 0.9 }, '/top_p'],
    ['not-an-object', undefined],
  ]

  for (const [document, path] of cases) {
    const result = readParameters(document)
    assert.equal(result.ok, false, JSON.stringify(document))
    if (!result.ok) {
      assert.equal(result.error.code, 'invalid-parameters')
      assert.equal(result.error.path, path)
    }
  }
})

test('readParameters: 空停止词数组按未设定处理', () => {
  const result = readParameters({ paramsVersion: 1, temperature: 1, stop: [] })
  assert.equal(result.ok, true)
  assert.equal(result.ok ? 'stop' in result.params : true, false)
})

test('readParameters: 停止词按原样保留,只去掉完全重复的项', () => {
  const result = readParameters({ paramsVersion: 1, stop: [' END ', ' END ', '\n\n'] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.ok ? result.params.stop : null, [' END ', '\n\n'])
})

test('importParameters: 非法 JSON 返回 invalid-json', () => {
  const result = importParameters('{ not json')
  assert.equal(result.ok, false)
  assert.equal(result.ok ? null : result.error.code, 'invalid-json')
})

test('importParameters: 未激活时只装配到内存', () => {
  reset()
  const result = importParameters(VALID_DOCUMENT)
  assert.equal(result.ok, true)
  assert.equal(result.ok ? result.persisted : null, false)
  assert.equal(getActiveParameters()?.temperature, 0.7)
})

test('activate: 申请 chat:request 并注册请求前处理器', async () => {
  await reset()
  const fake = createFakeContext()

  await activate(fake.context)

  assert.equal(fake.handlers.length, 1)
  assert.deepEqual(fake.notices, ['pluginInstallDone'])
  assert.ok(fake.registered !== null, '设置表面已登记')
  assert.ok(fake.logs.some((message) => message.includes('未找到参数文档')))
  assert.equal(fake.handlers[0]?.({ lastUserMessage: 'hi' }), null)
})

test('activate: 从插件存储装配参数并写进补丁', async () => {
  await reset()
  const fake = createFakeContext({ [PARAMS_STORAGE_KEY]: JSON.parse(VALID_DOCUMENT) as unknown })

  await activate(fake.context)

  assert.deepEqual(fake.handlers[0]?.({ lastUserMessage: 'hi' }), {
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    stop: ['\n\nUser:'],
  })
  assert.ok(fake.logs.some((message) => message.includes('已装配参数')))
})

test('activate: 存储里的参数文档不合法时保持未设定', async () => {
  await reset()
  const fake = createFakeContext({ [PARAMS_STORAGE_KEY]: { paramsVersion: 1, temperature: 9 } })

  await activate(fake.context)

  assert.equal(fake.handlers[0]?.({ lastUserMessage: 'hi' }), null)
  assert.ok(fake.logs.some((message) => message.includes('参数文档不可用')))
})

test('importParameters: 激活后写入插件存储,清除后回到 null', async () => {
  await reset()
  const fake = createFakeContext()
  await activate(fake.context)

  const imported = importParameters(VALID_DOCUMENT)
  assert.equal(imported.ok ? imported.persisted : null, true)
  assert.deepEqual(fake.values.get(PARAMS_STORAGE_KEY), JSON.parse(VALID_DOCUMENT) as unknown)
  assert.equal(fake.handlers[0]?.({ lastUserMessage: 'hi' })?.temperature, 0.7)

  assert.equal(clearParameters(), true)
  assert.equal(fake.values.has(PARAMS_STORAGE_KEY), false)
  assert.equal(getActiveParameters(), null)
  assert.equal(fake.handlers[0]?.({ lastUserMessage: 'hi' }), null)
})

test('importParameters: 写入存储失败时仍装配并返回 persisted=false', async () => {
  await reset()
  const fake = createFakeContext()
  fake.context.storage.set = () => {
    throw new Error('quota exceeded')
  }
  await activate(fake.context)

  const imported = importParameters(VALID_DOCUMENT)
  assert.equal(imported.ok, true)
  assert.equal(imported.ok ? imported.persisted : null, false)
  assert.equal(getActiveParameters()?.maxTokens, 2048)
  assert.ok(fake.logs.some((message) => message.includes('quota exceeded')))
})

test('deactivate 后可以重新激活并重新注册处理器', async () => {
  await reset()

  const first = createFakeContext({ [PARAMS_STORAGE_KEY]: JSON.parse(VALID_DOCUMENT) as unknown })
  await activate(first.context)
  deactivate()

  const second = createFakeContext({ [PARAMS_STORAGE_KEY]: JSON.parse(VALID_DOCUMENT) as unknown })
  await activate(second.context)

  assert.equal(first.handlers.length, 1)
  assert.equal(second.handlers.length, 1)
  assert.equal(second.handlers[0]?.({ lastUserMessage: 'hi' })?.temperature, 0.7)
})

/** 设置页的登记默认值,给用例构造「只有部分字段被改过」的值表 */
const DEFAULT_SETTINGS: Record<string, SettingValue> = {
  enabled: SETTINGS_DEFAULTS.enabled as boolean,
  temperature: SETTINGS_DEFAULTS.temperature as number,
  topP: SETTINGS_DEFAULTS.topP as number,
  maxTokens: SETTINGS_DEFAULTS.maxTokens as number,
  stop: SETTINGS_DEFAULTS.stop as string,
}

test('resolveParameters: 设置值生效,开关打开且字段被改过时以设置页为准', () => {
  const values: Record<string, SettingValue> = {
    ...DEFAULT_SETTINGS,
    enabled: true,
    temperature: 0.3,
    topP: 0.5,
    maxTokens: 512,
    stop: 'END, DONE',
  }

  assert.deepEqual(resolveParameters(values, null), {
    temperature: 0.3,
    topP: 0.5,
    maxTokens: 512,
    stop: ['END', 'DONE'],
  })
})

test('resolveParameters: 开关关闭时回落导入值,设置值不参与', () => {
  const values: Record<string, SettingValue> = {
    ...DEFAULT_SETTINGS,
    enabled: false,
    temperature: 0.3,
    stop: 'SETTINGS-STOP',
  }
  const imported: ParameterSet = { temperature: 0.7, topP: 0.9, stop: ['\n\nUser:'] }

  assert.deepEqual(resolveParameters(values, imported), {
    temperature: 0.7,
    topP: 0.9,
    stop: ['\n\nUser:'],
  })
})

test('resolveParameters: 两侧皆无时返回 null', () => {
  assert.equal(resolveParameters(null, null), null)
  assert.equal(resolveParameters({}, null), null)
  assert.equal(resolveParameters(DEFAULT_SETTINGS, null), null)
  assert.equal(resolveParameters({ ...DEFAULT_SETTINGS, enabled: true }, null), null)
})

test('resolveParameters: 逐字段合并,设置页没改过的字段回落导入值', () => {
  const values: Record<string, SettingValue> = { ...DEFAULT_SETTINGS, enabled: true, temperature: 0.3 }
  const imported: ParameterSet = { temperature: 0.7, topP: 0.9, maxTokens: 2048, stop: ['A'] }

  assert.deepEqual(resolveParameters(values, imported), {
    temperature: 0.3,
    topP: 0.9,
    maxTokens: 2048,
    stop: ['A'],
  })
})

test('resolveParameters: 设置值等于登记默认值按未改动处理,回落导入值', () => {
  const values: Record<string, SettingValue> = {
    ...DEFAULT_SETTINGS,
    enabled: true,
    maxTokens: SETTINGS_DEFAULTS.maxTokens as number,
  }
  const imported: ParameterSet = { maxTokens: 2048 }

  assert.deepEqual(resolveParameters(values, imported), { maxTokens: 2048 })
})

test('resolveParameters: 停止词文本非法时该字段回落导入值', () => {
  const tooMany: Record<string, SettingValue> = {
    ...DEFAULT_SETTINGS,
    enabled: true,
    stop: 'a,b,c,d,e',
  }
  const tooLong: Record<string, SettingValue> = {
    ...DEFAULT_SETTINGS,
    enabled: true,
    stop: 'x'.repeat(33),
  }

  const imported: ParameterSet = { stop: ['IMPORTED'] }
  assert.deepEqual(resolveParameters(tooMany, imported), { stop: ['IMPORTED'] })
  assert.deepEqual(resolveParameters(tooLong, imported), { stop: ['IMPORTED'] })
  assert.deepEqual(resolveParameters(tooMany, null), null)
})

test('resolveParameters: 数值越界或类型不对时该字段回落导入值', () => {
  const values: Record<string, SettingValue> = {
    ...DEFAULT_SETTINGS,
    enabled: true,
    temperature: 3,
    topP: 'high',
    maxTokens: 12.5,
  }
  const imported: ParameterSet = { temperature: 0.7, topP: 0.9, maxTokens: 2048 }

  assert.deepEqual(resolveParameters(values, imported), {
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
  })
})

test('resolveParameters: 读取设置失败(null)与开关关闭一样回落导入值', () => {
  const imported: ParameterSet = { temperature: 0.7 }
  assert.deepEqual(resolveParameters(null, imported), { temperature: 0.7 })
})

test('stopFromText: 逗号分隔、去条目空白、去空条目并去重', () => {
  assert.deepEqual(stopFromText(' END , DONE,, END '), ['END', 'DONE'])
  assert.equal(stopFromText('   '), null)
  assert.equal(stopFromText(''), null)
  // 条目首尾的空白(含换行)按分隔格式去掉,要保留空白的停止词请走导入入口
  assert.deepEqual(stopFromText('\n\nUser:'), ['User:'])
})

test('stopFromText: 超过 4 条或单条超长整份拒绝', () => {
  assert.equal(stopFromText('a,b,c,d,e'), null)
  assert.equal(stopFromText('x'.repeat(33)), null)
})

test('createSettingsDescriptor: 字段、边界与 zh/en 词条成对', () => {
  for (const locale of ['zh-CN', 'en-US'] as const) {
    const descriptor = createSettingsDescriptor(locale)
    const keys = descriptor.fields.map((field) => field.key)
    assert.deepEqual(keys, ['enabled', 'temperature', 'topP', 'maxTokens', 'stop'])

    const byKey = new Map(descriptor.fields.map((field) => [field.key, field]))
    assert.deepEqual(byKey.get('enabled'), {
      key: 'enabled',
      type: 'switch',
      label: locale === 'zh-CN' ? '启用设置页参数' : 'Use settings page values',
      default: false,
    })
    assert.equal(byKey.get('temperature')?.min, 0)
    assert.equal(byKey.get('temperature')?.max, 2)
    assert.equal(byKey.get('topP')?.min, 0)
    assert.equal(byKey.get('topP')?.max, 1)
    assert.equal(byKey.get('maxTokens')?.min, 1)
    assert.equal(byKey.get('maxTokens')?.max, 4096)
    assert.equal(byKey.get('stop')?.maxLength, 200)
    for (const field of descriptor.fields) {
      assert.ok(typeof field.label === 'string' && field.label.length > 0)
      assert.ok(field.default !== undefined)
    }
  }
})

test('activate: 设置值生效,处理器按设置页取值进补丁', async () => {
  await reset()
  const fake = createFakeContext()
  fake.settingsValues = {
    ...DEFAULT_SETTINGS,
    enabled: true,
    temperature: 0.3,
    topP: 0.5,
    maxTokens: 512,
    stop: 'END, DONE',
  }

  await activate(fake.context)

  assert.deepEqual(fake.handlers[0]?.({ lastUserMessage: 'hi' }), {
    temperature: 0.3,
    topP: 0.5,
    maxTokens: 512,
    stop: ['END', 'DONE'],
  })
  assert.ok(fake.logs.some((message) => message.includes('已登记设置表面')))
})

test('activate: 开关关闭时处理器回落导入值,设置值不参与', async () => {
  await reset()
  const fake = createFakeContext({ [PARAMS_STORAGE_KEY]: JSON.parse(VALID_DOCUMENT) as unknown })
  fake.settingsValues = { ...DEFAULT_SETTINGS, enabled: false, temperature: 0.3 }

  await activate(fake.context)

  assert.deepEqual(fake.handlers[0]?.({ lastUserMessage: 'hi' }), {
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    stop: ['\n\nUser:'],
  })
})

test('activate: 设置与导入皆无时处理器返回 null', async () => {
  await reset()
  const fake = createFakeContext()
  fake.settingsValues = DEFAULT_SETTINGS

  await activate(fake.context)

  assert.equal(fake.handlers[0]?.({ lastUserMessage: 'hi' }), null)
})

test('activate: 设置页改一个字段,其余字段回落导入值', async () => {
  await reset()
  const fake = createFakeContext({ [PARAMS_STORAGE_KEY]: JSON.parse(VALID_DOCUMENT) as unknown })
  fake.settingsValues = { ...DEFAULT_SETTINGS, enabled: true, temperature: 0.3 }

  await activate(fake.context)

  assert.deepEqual(fake.handlers[0]?.({ lastUserMessage: 'hi' }), {
    temperature: 0.3,
    topP: 0.9,
    maxTokens: 2048,
    stop: ['\n\nUser:'],
  })
})

test('activate: 读取设置值抛错时回落导入值并写日志', async () => {
  await reset()
  const fake = createFakeContext({ [PARAMS_STORAGE_KEY]: JSON.parse(VALID_DOCUMENT) as unknown })
  fake.settingsValues = { ...DEFAULT_SETTINGS, enabled: true, temperature: 0.3 }
  fake.failValues = true

  await activate(fake.context)

  assert.deepEqual(fake.handlers[0]?.({ lastUserMessage: 'hi' }), {
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    stop: ['\n\nUser:'],
  })
  assert.ok(fake.logs.some((message) => message.includes('读取设置值失败')))
})

test('activate: 宿主没有 settings 成员时按旧宿主处理,导入路径照常工作', async () => {
  await reset()
  const fake = createFakeContext({ [PARAMS_STORAGE_KEY]: JSON.parse(VALID_DOCUMENT) as unknown })
  const legacy = { ...fake.context } as Partial<PluginContext>
  delete legacy.settings
  fake.context = legacy as PluginContext

  await activate(fake.context)

  assert.equal(fake.registered, null)
  assert.ok(fake.logs.some((message) => message.includes('宿主未提供设置表面')))
  assert.deepEqual(fake.handlers[0]?.({ lastUserMessage: 'hi' }), {
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    stop: ['\n\nUser:'],
  })
})

test('activate: 设置表面登记失败不阻断激活,回落导入值', async () => {
  await reset()
  const fake = createFakeContext({ [PARAMS_STORAGE_KEY]: JSON.parse(VALID_DOCUMENT) as unknown })
  fake.context.settings.locale = () => Promise.reject(new Error('denied'))

  await activate(fake.context)

  assert.equal(fake.registered, null)
  assert.ok(fake.logs.some((message) => message.includes('登记设置表面失败')))
  assert.deepEqual(fake.handlers[0]?.({ lastUserMessage: 'hi' }), {
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    stop: ['\n\nUser:'],
  })
})

test('activate: 英文宿主登记英文标签', async () => {
  await reset()
  const fake = createFakeContext()
  fake.context.settings.locale = () => Promise.resolve('en-US')

  await activate(fake.context)

  const descriptor = fake.registered
  assert.ok(descriptor !== null)
  assert.equal(descriptor.fields[0]?.label, 'Use settings page values')
})

