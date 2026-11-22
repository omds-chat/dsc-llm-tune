# dsc-llm-tune

[简体中文] | [English](README.en-US.md)

dsc-llm-tune 是一个 dsc 插件,把 LLM 请求的常规参数直接交给用户设定:温度、top_p、max_tokens 与停止词。插件不提供预设,也不替用户判断「什么场景该用什么值」:用户给什么值,插件就把什么值写进请求;用户没给值,插件不改请求。

同一个请求的采样参数不该由两个插件同时决定,因此本插件与 dsc-humanize 互斥:两者都申请 `chat:request`、都声明 `chat:before-request`,同时安装时补丁会按登记顺序互相覆盖。互斥声明写在两侧的清单里,本仓库负责自己这一份。

插件最终由 dsc-inner-plugin 收录;参数在宿主插件详情页的设置表单里设定(总开关默认关),JSON 导入保留为兼容路径,取舍见 [docs/design/parameter-tuning.md](docs/design/parameter-tuning.md)。

## 定位

| 项 | 说明 |
|:---:|:---:|
| 面向用户 | 想精确控制采样参数、不需要助手形态编排的人 |
| 调节对象 | `temperature`、`top_p`、`max_tokens`、停止词四项 |
| 不提供 | 预设、场景模板、按意图自动选参数、提示词改写 |
| 与 dsc-humanize | 互斥:两者都改写同一次请求的采样参数 |
| 分布 | 由 dsc-inner-plugin 收录分发 |

## 仓库现状

- 一套从 dsc-plugin-template 沿用的工程骨架:清单、激活、停用、TypeScript 源码与 esbuild 单文件产物
- 一份契约类型的本地副本,脱离 DeepSeek-Chat-Enhanced 源码也有类型提示
- 一套构建流程:打包 `plugin.js`、从 `package.json` 生成并自校验 `meta.json`、写入 `MUST_PLUSH_WITH_PACKAGE` 标记、文本产物强制 LF
- 一套可校验的规范区:运行时规范、开发规范与 JSON Schema 的副本,随仓库保留用于本地校验
- 一层参数校验:四个参数的取值范围、类型与停止词规则,任一不合法整份拒绝
- 一条插件存储链路:参数文档存在 `dsc-llm-tune/params/v1`,激活时读取并装配
- 一条宿主请求前接线:申请 `chat:request` 能力并声明 `chat:before-request` 挂载点,把设置页取值与导入参数按优先级合并成宿主补丁;两侧都没有时返回 `null`
- 一份宿主设置表面登记:申请 `settings:locale` 与 `settings:surface`,激活期登记参数字段描述,宿主在插件详情页渲染设置表单
- 一个最小导入入口:`importParameters(jsonText)` 与 `clearParameters()`,作为兼容路径保留
- 一套零依赖测试:用 Node 内置的 `node:test` 覆盖参数校验、补丁映射、存储装配、导入导出与设置值合并
- 尚未实现的:参数文档导出

## 请求参数与补丁

| 参数 | 文档字段 | 取值 | 宿主补丁字段 | 说明 |
|:---:|:---:|:---:|:---:|:---:|
| 温度 | `temperature` | 0 到 2 | `temperature` | 越界拒绝,不裁剪 |
| top_p | `topP` | 0 到 1 | `topP` | 越界拒绝,不裁剪 |
| max_tokens | `maxTokens` | 1 到 4096 的整数 | `maxTokens` | 非整数或越界拒绝 |
| 停止词 | `stop` | 最多 4 条,每条最多 32 个字符 | `stop` | 按原样保留,只去完全重复项 |

- 四个字段都可以缺省;缺省的字段不进补丁,请求里的对应项保持宿主的原值。四项都不给时补丁为空,处理器返回 `null`。
- 校验发生在入口期:导入路径越界整份拒绝,设置页取值由宿主按登记的范围校验后才落盘;请求前不重复校验,也不裁剪。
- 不使用 `systemPromptAppend` 与 `systemPromptReplace`:提示词属于 dsc-humanize 的领域,本插件只碰采样参数与停止词。
- 补丁的字段范围、合并顺序与收敛规则见 [specs/plugin-runtime-spec.md](specs/plugin-runtime-spec.md) 5.8 节。

## 参数设定入口

参数有两个入口:宿主设置页(主入口)与 JSON 导入(兼容路径)。优先级逐字段判定,完整规则写在 [docs/design/parameter-tuning.md](docs/design/parameter-tuning.md) 6.3 节:

| 优先级 | 条件 | 结果 |
|:---:|:---:|:---:|
| 1 | 设置页总开关打开,且该字段在设置页改过(生效值不等于登记默认值) | 以设置页为准 |
| 2 | 该字段设置页没有覆盖值 | 回落导入值(存储里的参数文档) |
| 3 | 两侧都没有 | 该字段不进补丁;全部字段都没有时请求保持原样 |

### 设置页(主入口)

宿主已提供插件设置表面:已安装列表点插件名进详情页,表单由宿主按插件登记的字段描述渲染。本插件登记五个字段:

| 字段 | 控件 | 取值 | 登记默认值 |
|:---:|:---:|:---:|:---:|
| 启用设置页参数 | switch | 开 / 关 | 关 |
| 温度 temperature | number | 0 到 2 | `1` |
| top_p | number | 0 到 1 | `1` |
| 最大生成 token 数 | number | 1 到 4096 的整数 | `4096` |
| 停止词 | text | 逗号分隔,最多 4 条,每条最多 32 字符 | 留空 |

- 登记默认值不是预设:没改过的字段不进补丁,只有改过的字段才以设置页为准;总开关默认关,只导入不碰设置页时行为与旧版一致。
- 停止词文本框按逗号切分,每条去首尾空白;要保留空白字符的停止词请走导入入口。
- 字段标签按激活时的宿主语言渲染,激活后切换语言需要重新激活插件。

### JSON 导入(兼容路径)

参数以一份 JSON 文档整体存放,存在插件存储的 `dsc-llm-tune/params/v1` 键下:

```json
{
  "paramsVersion": 1,
  "temperature": 0.7,
  "topP": 0.9,
  "maxTokens": 2048,
  "stop": ["\n\nUser:"]
}
```

| 字段 | 必填 | 取值 |
|:---:|:---:|:---:|
| `paramsVersion` | 是 | 固定为 `1`,其他取值按 `unsupported-version` 拒绝 |
| `temperature` | 否 | 0 到 2 的数字 |
| `topP` | 否 | 0 到 1 的数字 |
| `maxTokens` | 否 | 1 到 4096 的整数 |
| `stop` | 否 | 字符串数组,最多 4 条,每条最多 32 个字符 |

调用入口在 [src/index.ts](src/index.ts),三个函数覆盖设定、撤销与查看:

```ts
import { clearParameters, getActiveParameters, importParameters } from 'dsc-llm-tune'

// 导入:解析并校验,成功才替换当前参数;已激活时同时写回插件存储
const result = importParameters(jsonText)
if (!result.ok) {
  // 错误带 code 与字段路径,例如 { code: 'invalid-parameters', message: '...', path: '/temperature' }
  console.log(result.error.code, result.error.path, result.error.message)
}

// 查看:当前生效的参数,未设定时为 null
getActiveParameters()

// 撤销:清空内存里的参数,并删除插件存储里的文档
clearParameters()
```

- `importParameters` 返回 `{ ok: true, params, persisted }` 或 `{ ok: false, error }`;`persisted` 为 `false` 表示只装配到内存,例如未激活或写入存储失败。
- 未激活时导入只装配到内存,下一次激活以插件存储为准。
- 导入路径的限制:入口是函数而非界面,适合批量粘贴、调试与保留空白字符的停止词;设置页有覆盖值的字段以设置页为准,导入值不生效。
- 撤销导入用 `clearParameters()`;设置页的取值由宿主的设置命名空间管理,不在这条路径里清除,要清空某个字段请在设置页把该项重置为默认。

## 与 dsc-humanize 互斥

| 项 | 内容 |
|:---:|:---:|
| 互斥原因 | 两者都改写同一次请求的采样参数,补丁按登记顺序合并,标量以后登记者为准,用户无法预测最终取值 |
| 本插件一侧 | [src/manifest.ts](src/manifest.ts) 的 `conflicts: ['dsc-humanize']` |
| 另一侧 | dsc-humanize 的清单需声明 `dsc-llm-tune`,由该仓库负责 |
| 宿主行为 | 两个插件同时安装会被拒绝(按清单的 `conflicts` 判定) |
| 关联范围 | 只影响采样参数;提示词由 dsc-humanize 负责,本插件不改提示词 |

需要助手形态与提示词编排时用 dsc-humanize,需要精确控制采样参数时用本插件;两者按需切换,不同时安装。

## 规范与 Schema

插件运行时规范、插件开发规范与配套 JSON Schema 的副本随本仓库保留,用于本地校验与分发前对照;规范的源头是 dsc-plugin-template,权威实现仍是 DeepSeek-Chat-Enhanced 的 `dsc-plugin-engine`:

| 内容 | 位置 |
|:---:|:---:|
| 规范区索引与已知差异 | [specs/README.md](specs/README.md) |
| 插件运行时规范 | [specs/plugin-runtime-spec.md](specs/plugin-runtime-spec.md) |
| 插件开发规范 | [specs/plugin-develop-spec.md](specs/plugin-develop-spec.md) |
| 规范版本与 Schema 路径 | [specs/spec-version.json](specs/spec-version.json) |
| 清单 Schema | [schemas/manifest/plugin-manifest.schema.json](schemas/manifest/plugin-manifest.schema.json) |
| 运行时 meta Schema | [schemas/runtime/meta.json](schemas/runtime/meta.json) |

- 规范以 DeepSeek-Chat-Enhanced 的 `dsc-plugin-engine` 实现为准,本仓库只做收拢与机器可校验化,不新增规则;正文与 dsc-plugin-template 逐字一致,实现与上游文档的口径差异由上游 specs/README.md 的「已知差异」表留痕,本仓只留本地差异。
- 本仓库不发布规范版本;需要引用规范的其他仓库请使用 dsc-plugin-template 的 `specs/spec-version.json`,并用 git 标签或提交固定。
- 校验命令:`node scripts/validate-specs.mjs`(自检)、`node scripts/validate-specs.mjs <清单文件>`(校验单个清单),不联网、不安装依赖。

## 目录结构

```text
dsc-llm-tune/
├── .env.example              # 本地联调地址模板
├── .gitattributes            # 全仓库统一 LF
├── .gitignore
├── .npmrc
├── COPYRIGHT                 # 版权声明
├── LICENSE
├── README.md                 # 面向开发者,中文主文本
├── README.en-US.md           # 英文版,与 README.md 同步维护
├── build.mjs                 # 构建入口:打包与 meta 自校验
├── package.json              # 工程信息,meta.json 的数据来源
├── pnpm-lock.yaml            # 依赖锁定
├── pnpm-workspace.yaml       # pnpm 12 的构建脚本白名单
├── tsconfig.json
├── docs/
│   ├── README.md             # 文档索引
│   └── design/
│       └── parameter-tuning.md # 参数调优设计:边界、互斥、设置表面、未定稿
├── schemas/                  # 清单与运行时 meta 的 JSON Schema 及样例
├── scripts/
│   ├── test/                 # 零依赖测试
│   │   ├── ts-hooks.mjs      # 让测试直接加载 .ts 源码的解析钩子
│   │   └── tuning.test.ts    # 参数校验、补丁映射、存储装配、导入与设置值合并
│   └── validate-specs.mjs    # 零依赖规范校验脚本
├── specs/                    # 规范副本:运行时规范、开发规范与版本信息
└── src/
    ├── index.ts              # 激活与停用入口,设置表面登记与参数导入清除
    ├── manifest.ts           # 运行时清单
    ├── types.ts              # 契约类型
    ├── host/
    │   ├── request-patch.ts  # 参数 -> 请求补丁
    │   ├── settings.ts       # 设置表面:字段描述、zh/en 词条与取值优先级合并
    │   └── store.ts          # 参数文档:键名、形状与读取校验
    └── tuning/
        └── params.ts         # 参数取值、校验与内存形状
```

## 环境要求

| 项 | 要求 |
|:---:|:---:|
| Node.js | 18 或更高版本;跑测试需要 22.18 或更高版本(内置类型剥离) |
| pnpm | 12 或更高版本 |
| 产物目标浏览器 | Chrome 105、Edge 105、Safari 16、Firefox 110 |

pnpm 12 默认不执行依赖的安装脚本,仓库里的 `pnpm-workspace.yaml` 通过 `allowBuilds` 显式允许 esbuild 的构建脚本,请不要删除这个文件。

## 快速开始

```bash
git clone https://github.com/omds-chat/dsc-llm-tune.git
cd dsc-llm-tune
pnpm install
pnpm run type
pnpm run build
pnpm run test
```

| 命令 | 作用 |
|:---:|:---:|
| `pnpm install` | 安装开发依赖 |
| `pnpm run type` | 运行 `tsc --noEmit` 做类型检查 |
| `pnpm run build` | 构建产物到 `dist/` |
| `pnpm run build -- --no-minify` | 关闭行压缩后再构建 |
| `pnpm run validate:specs` | 校验规范区的 Schema、样例与本仓库 meta 数据 |
| `pnpm run test` | 运行 `node --test` 的零依赖测试 |

测试用 Node 内置的 `node:test`,零依赖、离线可跑,直接加载 `src` 下的 TypeScript 源码;改完参数层或接线后跑 `pnpm run test` 即可。

## 构建产物

构建先清空 `dist/`,再依次产出以下文件:

```text
dist/
├── meta.json                  # 运行时元数据,从 package.json 生成
├── plugin.js                  # 运行时脚本,单文件 ESM
└── MUST_PLUSH_WITH_PACKAGE    # 标记文件,内容为空
```

| 产物 | 说明 |
|:---:|:---:|
| `meta.json` | 生成后立即自校验,不通过则构建失败 |
| `plugin.js` | 单文件 ESM,导出 `manifest`、`activate`、`deactivate` 与参数入口 |
| `MUST_PLUSH_WITH_PACKAGE` | 空文件,表示该目录内容必须随包分发 |

文件名按约定原样保留,`MUST_PLUSH_WITH_PACKAGE` 的拼写不要改成 `PUSH`。构建结束时脚本会打印每个产物的大小、压缩开关与体积,并检查 `dist/` 里没有预期之外的文件;文本产物按 LF 落盘,若检测到 CR 字节直接报错。

## meta.json 生成规则

`meta.json` 由 `package.json` 生成,不手工维护。

| `meta.json` 字段 | 来源 | 必填 |
|:---:|:---:|:---:|
| `name` | `package.json` 的 `name` | 是 |
| `version` | `package.json` 的 `version` | 是 |
| `license` | `package.json` 的 `license` | 是 |
| `author` | `package.json` 的 `author`,字符串形式 | 是 |
| `description` | `dsc.description`,对象,至少含 `zh-CN` 或 `en-US` | 是 |
| `repo_link` | `dsc.repo_link` | 是 |
| `dependencies.dsc` | `dsc.engines` | 是 |
| `home_page` | `dsc.home_page`,缺省则不写 | 否 |

改插件名时同步改 `package.json` 的 `name`:它必须匹配 `dsc-xxx` 或 `@scope/dsc-xxx`,否则 `meta.json` 校验失败。改版本时同步改 `version`,只允许 `x.y.z` 三段数字。

## 如何改 manifest

清单写在 [src/manifest.ts](src/manifest.ts),由 [src/index.ts](src/index.ts) 转出为具名导出,安装时以产物自带的 `manifest` 为准。

| 字段 | 必填 | 说明 |
|:---:|:---:|:---:|
| `id` | 是 | 插件标识,须匹配 `^[a-z][a-z0-9-]{2,63}$`,本插件为 `dsc-llm-tune` |
| `name` | 是 | 展示名称 `LLM Tune` |
| `version` | 是 | 插件自身版本,只允许三段数字 |
| `engines` | 否 | 兼容的 dsc-core 版本范围,当前为 `^1.0.0` |
| `dependencies` | 否 | 依赖的插件 id,本插件没有 |
| `conflicts` | 否 | 冲突的插件 id,本插件写 `dsc-humanize` |
| `capabilities` | 是 | 申请的能力:当前为 `notify`、`plugins:storage`、`chat:request`、`settings:locale`、`settings:surface` |
| `mounts` | 否 | 订阅的挂载点,当前只有 `chat:before-request` |

改清单时的注意事项:

- `id` 全局唯一,改动会改变插件身份与存储命名空间,已安装的实例不会自动迁移。
- `chat:request` 与挂载点 `chat:before-request` 必须同时存在:登记请求前处理器时缺任一项会抛 `PluginCapabilityError`。
- `conflicts` 要与 dsc-humanize 的清单互相对应;只改一侧等于没有互斥。
- 字段与校验规则的完整说明见 [specs/plugin-develop-spec.md](specs/plugin-develop-spec.md),可用 `node scripts/validate-specs.mjs <清单文件>` 校验。

## 能力清单

| 能力 | 上下文成员 | 限流 |
|:---:|:---:|:---:|
| `notify` | `context.ui.notify` | 10 次 / 10 秒 |
| `plugins:storage` | `context.storage` | 100 次 / 10 秒,单插件 64KB |
| `chat:request` | `context.chat.onBeforeRequest` | 10 次 / 10 秒(仅登记) |
| `settings:locale` | `context.settings.locale` | 60 次 / 10 秒 |
| `settings:surface` | `context.settings.register`、`context.settings.values` | 60 次 / 10 秒(登记与读取共窗) |
| `sessions:list`、`sessions:read`、`sessions:rename` | `context.sessions.*` | 本插件未申请 |
| `events:session` | `context.events.on` | 本插件未申请 |
| `net:fetch` | `context.net.*` | 仅内置插件可申请,本插件不联网 |

本插件申请 `notify`、`plugins:storage`、`chat:request`、`settings:locale` 与 `settings:surface` 五项能力,声明 `chat:before-request` 一个挂载点:参数要持久化所以需要存储,首次激活提示需要 `notify`,请求补丁需要 `chat:request`,设置页字段描述与取值需要 `settings:surface`,字段标签选词需要 `settings:locale`;会话列表、事件订阅与联网都用不到,不申请。

## 常见问题

### 参数设定后没有生效

按顺序检查:

1. 设置页路径:总开关「启用设置页参数」是否打开;改过的字段取值是否恰好等于登记默认值(等于默认值按未改动处理,回落导入值)。
2. 导入路径:参数是否导入成功(`importParameters` 返回的 `ok`)、是否被后续的清除或重新激活覆盖、插件日志里是否出现「已装配参数」或「未找到参数文档」。
3. 两条路径都看了再对照优先级:设置页改过的字段以设置页为准,其余字段以导入值为准;两侧都没有时请求保持原样。
4. 重新激活时导入路径以插件存储为准,未激活时导入只装配到内存;设置页取值在请求前实时读取,保存后无需重新激活。

### 存储里的值被判为不可用

常见原因是 `paramsVersion` 不是 `1`、字段名写成了下划线形式(例如 `top_p`、`max_tokens`)、数值越界、`stop` 超过 4 条或某条超过 32 个字符。日志会给出错误码与字段路径,按提示改好整份重新导入即可,插件不做部分保留。

### 与 dsc-humanize 同时安装被拒绝

这是设计如此:两者都改写同一次请求的采样参数,同时开启会出现互相覆盖。先卸载其中一个再装另一个;需要助手形态与提示词编排时用 dsc-humanize。

### dist 多出或少了一个文件

构建脚本会清空 `dist/` 并校验产物清单,只允许 `meta.json`、`plugin.js` 与 `MUST_PLUSH_WITH_PACKAGE`。出现其他文件说明源码用了动态 `import()` 或引入了需要单独输出的资源。

## 发布

- 交付 `dist/` 整个目录,不要只交付 `plugin.js`:`meta.json` 是市场识别插件的依据,`MUST_PLUSH_WITH_PACKAGE` 表明该目录必须随包分发。
- 目录结构与 `meta.json` 的字段名不要改动,市场与合集按约定解析。
- 产物托管在支持 `https` 的静态站点或 CDN 上,保持地址稳定;宿主安装时用 `fetch` 取字节,托管方需返回 `Access-Control-Allow-Origin`。
- 发布前在浏览器控制台执行一次 `import('https://你的地址/plugin.js')`,确认没有语法错误与缺失依赖。
- `dist/` 已被 `.gitignore` 忽略,需要交付产物时在 Release 中附带。
- 插件运行在用户浏览器中,可以读取当前会话的可见字段;分发时必须提示用户只安装信任来源的插件。
- 收录说明或用户说明里要写明:参数在宿主插件详情页的设置表单里设定,总开关默认关;JSON 导入入口作为兼容路径保留,宿主过旧没有设置表面时只有导入路径可用。
