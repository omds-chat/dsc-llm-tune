import assert from 'node:assert/strict'
import test from 'node:test'

import { createBeforeRequestHandler } from '../../src/host/request-patch.ts'
import { PARAMS_STORAGE_KEY } from '../../src/host/store.ts'
import {
  activate,
  clearParameters,
  deactivate,
  getActiveParameters,
  importParameters,
} from '../../src/index.ts'
import { readParameters } from '../../src/tuning/params.ts'
import type { ChatBeforeRequestHandler, PluginContext } from '../../src/types.ts'

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
}

/** 只实现本插件用到的成员:日志、notify、插件存储与 chat:request */
const createFakeContext = (initial?: Record<string, unknown>): FakeContext => {
  const handlers: ChatBeforeRequestHandler[] = []
  const logs: string[] = []
  const notices: string[] = []
  const values = new Map<string, unknown>(Object.entries(initial ?? {}))

  const context: PluginContext = {
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

  return { context, handlers, logs, notices, values }
}

/** 每个用例从未激活、无参数开始,避免模块级状态互相影响 */
const reset = (): void => {
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

test('activate: 申请 chat:request 并注册请求前处理器', () => {
  reset()
  const fake = createFakeContext()

  activate(fake.context)

  assert.equal(fake.handlers.length, 1)
  assert.deepEqual(fake.notices, ['pluginInstallDone'])
  assert.ok(fake.logs.some((message) => message.includes('未找到参数文档')))
  assert.equal(fake.handlers[0]?.({ lastUserMessage: 'hi' }), null)
})

test('activate: 从插件存储装配参数并写进补丁', () => {
  reset()
  const fake = createFakeContext({ [PARAMS_STORAGE_KEY]: JSON.parse(VALID_DOCUMENT) as unknown })

  activate(fake.context)

  assert.deepEqual(fake.handlers[0]?.({ lastUserMessage: 'hi' }), {
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    stop: ['\n\nUser:'],
  })
  assert.ok(fake.logs.some((message) => message.includes('已装配参数')))
})

test('activate: 存储里的参数文档不合法时保持未设定', () => {
  reset()
  const fake = createFakeContext({ [PARAMS_STORAGE_KEY]: { paramsVersion: 1, temperature: 9 } })

  activate(fake.context)

  assert.equal(fake.handlers[0]?.({ lastUserMessage: 'hi' }), null)
  assert.ok(fake.logs.some((message) => message.includes('参数文档不可用')))
})

test('importParameters: 激活后写入插件存储,清除后回到 null', () => {
  reset()
  const fake = createFakeContext()
  activate(fake.context)

  const imported = importParameters(VALID_DOCUMENT)
  assert.equal(imported.ok ? imported.persisted : null, true)
  assert.deepEqual(fake.values.get(PARAMS_STORAGE_KEY), JSON.parse(VALID_DOCUMENT) as unknown)
  assert.equal(fake.handlers[0]?.({ lastUserMessage: 'hi' })?.temperature, 0.7)

  assert.equal(clearParameters(), true)
  assert.equal(fake.values.has(PARAMS_STORAGE_KEY), false)
  assert.equal(getActiveParameters(), null)
  assert.equal(fake.handlers[0]?.({ lastUserMessage: 'hi' }), null)
})

test('importParameters: 写入存储失败时仍装配并返回 persisted=false', () => {
  reset()
  const fake = createFakeContext()
  fake.context.storage.set = () => {
    throw new Error('quota exceeded')
  }
  activate(fake.context)

  const imported = importParameters(VALID_DOCUMENT)
  assert.equal(imported.ok, true)
  assert.equal(imported.ok ? imported.persisted : null, false)
  assert.equal(getActiveParameters()?.maxTokens, 2048)
  assert.ok(fake.logs.some((message) => message.includes('quota exceeded')))
})

test('deactivate 后可以重新激活并重新注册处理器', () => {
  reset()

  const first = createFakeContext({ [PARAMS_STORAGE_KEY]: JSON.parse(VALID_DOCUMENT) as unknown })
  activate(first.context)
  deactivate()

  const second = createFakeContext({ [PARAMS_STORAGE_KEY]: JSON.parse(VALID_DOCUMENT) as unknown })
  activate(second.context)

  assert.equal(first.handlers.length, 1)
  assert.equal(second.handlers.length, 1)
  assert.equal(second.handlers[0]?.({ lastUserMessage: 'hi' })?.temperature, 0.7)
})
