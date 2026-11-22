# 文档索引

> 本文件是本仓库全部文档的索引入口:按行找到文档,按「什么时候需要读」决定先读哪一份,按「冲突时以谁为准」判断结论不一致时听谁的。
> 本文件只写文档的职责与定位,不复制文档正文,也不记录文档的写作时间或维护进度。

## 一、文档清单

| 文档 | 职责一句话 | 主要内容 | 什么时候需要读 | 主要读者 |
|:---:|:---:|:---:|:---:|:---:|
| [README.md](../README.md) | 本仓库的开发者入口 | 插件定位、参数集合与补丁映射、当前的设定入口、工程结构、构建与自检方式 | 首次进入本仓库、要改源码或构建产物时 | 贡献者、维护者 |
| [README.en-US.md](../README.en-US.md) | 上文 README.md 的英文版 | 与中文版同构的英文说明 | 需要英文说明、对外引用仓库说明时 | 贡献者、用户 |
| [docs/README.md](README.md) | 本索引:文档总入口 | 文档清单、冲突时的准据、文档分层、维护约定 | 查找任意文档、判断两份文档说法不一致时 | Agent、贡献者、维护者 |
| [docs/design/parameter-tuning.md](design/parameter-tuning.md) | 请求参数调优的设计定稿与未定稿 | 定位与边界、与 dsc-humanize 的互斥、参数集合、参数文档与插件存储、请求前补丁、宿主设置表面接入与取值优先级、已排除做法、与 dsc-inner-plugin 的关系、未定稿项 | 改动参数集合、存储键、导入入口、设置字段、互斥声明,或判断宿主能力是否够用时 | 维护者、Agent |
| [specs/README.md](../specs/README.md) | 规范区的索引与差异留痕 | 规范文件清单、权威来源与引用约定、校验命令、与宿主实现的已知差异 | 引用规范、核对两侧口径、运行规范校验时 | 贡献者、维护者、Agent |
| [specs/plugin-runtime-spec.md](../specs/plugin-runtime-spec.md) | 插件运行时规范 | 产物形态、导出契约、生命周期与超时、能力与限流、上下文成员、安全边界、错误降级 | 写运行时行为、申请能力、对接宿主时 | 贡献者、Agent |
| [specs/plugin-develop-spec.md](../specs/plugin-develop-spec.md) | 插件开发规范 | 清单字段与校验、版本与依赖、运行时 meta、分发要求、请求前补丁 | 改清单、改构建产物、改请求前补丁时 | 贡献者、维护者 |

- JSON Schema、样例与 `specs/spec-version.json` 属于机器可校验的资产,不按文档计入本表,由 [specs/README.md](../specs/README.md) 统一收拢与说明。
- `LICENSE` 与 `COPYRIGHT` 不属于说明性文档,不列入本表。
- 本仓库还没有面向普通用户的 `README.user.md`:插件的可执行操作已收拢在 [README.md](../README.md) 的「参数设定入口」一节,需要单独拆分用户文档时再新建。

## 二、冲突时以谁为准

结论不一致时,按下面的顺序取准据,序号小的优先:

| 顺序 | 准据 | 含义 | 两侧不一致时怎么办 |
|:---:|:---:|:---:|:---:|
| 1 | 宿主 `dsc-plugin-engine` 的实现 | 清单校验、能力表、限流、请求补丁收敛、加载的实际行为 | 以实现为准;文档与规范都按实现修正 |
| 2 | 本仓库的规范与 Schema | 宿主实现的可校验副本:`specs/` 两份规范、`schemas/`、`specs/spec-version.json` | 以规范为准;实现与上游文档的口径差异由上游 specs/README.md 的「已知差异」表留痕,本仓本地差异记入 [specs/README.md](../specs/README.md),不修改上游文档 |
| 3 | 脚本与测试的行为 | [scripts/validate-specs.mjs](../scripts/validate-specs.mjs)、[scripts/test/](../scripts/test/) 下的测试、构建脚本的校验结果 | 脚本与规范冲突时以规范为准并修脚本;脚本拒绝而文档放行时,先按规范定口径,再同时修文档与脚本 |
| 4 | 设计文档 | [docs/design/parameter-tuning.md](design/parameter-tuning.md) 中的已定约束 | 与规范冲突时规范优先;与源码、测试冲突时以设计文档为准,由实现与测试对齐(未定稿条目除外) |
| 5 | README | [README.md](../README.md)、[README.en-US.md](../README.en-US.md) | 与设计文档冲突时以设计文档为准,并同步修正 README |
| 6 | 本索引 | 只负责导航与上述优先级说明,不含机制结论 | 与任何被指向的文档冲突时,以被指向的文档为准,并修正本索引 |

补充两条:

- `README.md` 是中文主文本,`README.en-US.md` 是它的译本;两者不一致时以中文版为准。
- 设计文档里标注「未定稿」的条目不是准据:它们是待定问题与已排除做法的记录,不能引用其中一种可能当结论;已定条目才是约束。

## 三、文档分层

| 分层 | 文档 | 用途 |
|:---:|:---:|:---:|
| 开发者与贡献者文档 | [README.md](../README.md)、[README.en-US.md](../README.en-US.md)、[specs/README.md](../specs/README.md)、[specs/plugin-runtime-spec.md](../specs/plugin-runtime-spec.md)、[specs/plugin-develop-spec.md](../specs/plugin-develop-spec.md) | 给要改本仓库的人看:实现范围、工程结构、规范约束与校验方式 |
| 维护者文档 | [docs/design/parameter-tuning.md](design/parameter-tuning.md) | 记录机制定稿与取舍理由:为什么这样定、排除了哪些做法、还差哪块宿主能力 |
| Agent 执行文档 | 本索引、[docs/design/parameter-tuning.md](design/parameter-tuning.md)、`specs/` 与 `schemas/` | Agent 的执行依据:先按本索引找文档,再按设计文档的已定约束与规范、Schema 的硬规则动手,改完用 `scripts/` 下的校验与测试自查 |

- 三类读者读到的内容不同:贡献者需要开发者文档与规范;维护者还要看设计文档的取舍理由;Agent 按第一节的「什么时候需要读」取文档,并按第二节的优先级判断结论。新增文档时先判断它属于哪一层,再决定写多深。
- 设计文档是唯一记录「为什么这样定」的地方,规范与 README 不复述取舍理由,只给结论与用法。

## 四、维护约定

- 新增或删除文档时,当轮更新本文档第一节的主表:补行、删行、改「职责一句话」与「什么时候需要读」,不留死链。
- 机制变更当轮更新对应文档:参数集合、存储键、导入入口、互斥声明有变化时改 [docs/design/parameter-tuning.md](design/parameter-tuning.md);规范变化时先改上游规范与 Schema,再把副本同步到本仓库;对用户可见的行为变化同步到 [README.md](../README.md) 与 [README.en-US.md](../README.en-US.md)。
- 文档与代码在同一轮内保持一致:已定约束改了就对齐实现与测试,不留下「文档这么写、代码那么做」的状态。
- 本文档只写职责与定位,不复制正文:文档内容变化时通常不需要改本索引,只有职责、读者或分层变化时才改。
- 本文档不写时间戳、不写维护进度与计划,也不引入 emoji。
- 目录结构保持不变:设计类文档放在 `docs/design/`,本索引固定在 `docs/README.md`;新增文档沿用既有分层,不新建与现有目录平行的顶层说明目录。
- 本索引与文档正文不一致时,以文档正文为准,并修正本索引。
