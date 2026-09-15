# DeepSeek Harness ElectroLab

面向 DeepSeek Harness 的电气电子计算插件。

[English](README.md)

## 安装

```sh
dsh plugin --profile web add dsh-electro-lab
```

## ElectroLab 模式

插件以智能体预设的方式工作：新建会话时选择 **ElectroLab 模式**，然后用自然语言提出任意电气电子计算问题即可。会话被隔离在插件的工具内——无 shell、无文件系统、无网络——因此答案里的每个数字都来自引擎；条件不足时智能体会停下并追问。

全部计算都发生在一台确定性的**引擎**内。智能体通过三个原语操作它——`set`（把一个类型化值写入槽）、`get`（读取一个槽）与 `call`（运行 38 个数学求解器之一并存储结果）——两端由记录标记 `record_question` / `record_analyse` / `record_answer` 括起。类型化值自带 kind、variant 与 prefix（例如 `{type: "number", value: 25, kind: "temperature", variant: "degC"}`）；引擎按原样存储它们，只在计算边界执行 SI 与单位换算。每一步都落在每条记录专属的轨迹文件中，因此每次求解都是一条可重现的过程，可在不重新计算的前提下重放。

求解器目录覆盖表达式代数、级数、传递函数、DSP/DFT、信号质量（THD、抖动、ADC 预算）、电路（阻抗、谐振、瞬态、交流功率）、电子学（运放、分压器、LED）、射频与史密斯圆图（反射、匹配网络）、传输线、噪声与滤波器设计。详见[引擎手册](docs/engine.zh-CN.md)。

已结算记录列在客户端面板的 **「记录」页** 中（由 `record-index.jsonl` 索引，每 5 秒刷新）；未完成的记录会挂上「未完成」徽标。记录本体是 `~/.dsh-electro-lab/records/` 下的过程轨迹。列表支持选择模式（多选、全选、确认后删除）；点开任意记录即进入时间线详情页：写入/读取/失败与调用卡片可折叠、JSON 树值带斑马纹，工具栏与标题区固定、仅时间线区域滚动。

## 文章生成

详情页右侧栏提供 **Markdown** 与 **LaTeX** 两种生成：宿主 LLM 依据记录轨迹（问题、已建立的条件、分析笔记、带已解析参数与结果的求解步骤、最终答案）写出流畅、自洽的解题文章——以模型"自己完成计算"的口吻呈现，正文绝不提及 ElectroLab、求解器或生成过程。每个按钮各开自己的设置对话框（文章语言、经宿主目录浏览选择的输出目录、文件名；记忆上次设置），随后运行可取消的后台任务，其进度对话框可最小化为角落胶囊、在任意页面切换间存活。LaTeX 文章是规范的 XeLaTeX 文档（zh-CN 用 ctexart，en 用 fontspec + unicode-math + siunitx——全程纯 Unicode）；**PDF 编译仅限 LaTeX**（xelatex 跑两遍）。Markdown 以 `.md` 平铺写出、从不编译。生成的文件是主产物：可在进度对话框中直接打开文件或所在目录。

## 外部求解器

除内置目录外，你还可以注册自己的计算求解器，经 **http** 传输访问。声明（名称、描述、参数、显式的 **returns** 形状、传输选项）存放于 `~/.dsh-electro-lab/external-solvers.jsonl`；引擎启动时，每条启用的声明都会直接注册进 solver 注册表——与内置求解器共用同一套签名语言，因此 `solver_info` 与 `call` 对它们无需任何特判即可工作。更改在宿主重启后生效（生效前面板会显示待重启提示）。

注册与管理有三条路径：管理工具（`external_solver_add` / `external_solver_update` / `external_solver_delete`），或面板的**「外部求解器」页**——该页可列出、添加、编辑、启用/停用与删除声明。注册要求 **returns 显式给出**（一个 spec，或 `null` 表示 void）；缺少 returns 的声明只会被存档、启动时跳过并给出告警。

线协议是类型化信封，只发 POST：`{requestId, args}` → `{requestId, result}`（类型化值，void 时为 `null`）或 `{requestId, error}`。线上只传类型化值——不出现符号，也不出现 variant/prefix 词。失败与本地求解器走同一套错误收据（`EXTERNAL_ERROR` / `EXTERNAL_HTTP` / `EXTERNAL_TIMEOUT` / `EXTERNAL_RESPONSE`）并落入记录轨迹；结果作为事实存储，重放时绝不重算。

[`external-solvers-example/`](external-solvers-example/README.zh-CN.md) 是独立的 npm 工程，内含手动测试对端——`node src/echo.ts http` 可将信封协议端到端回显；注册指南逐字段列出应填内容。

## 日志

插件把每个事件记成一行文本，同时写入 stdout 与每次宿主运行一个文件：`~/.dsh-electro-lab/logs/<YYYY-MM-DD_HH-mm-ss.SSS>.log`。

唯一的设置是 `DSH_ELECTRO_LAB_LOG_LEVEL=debug|info|warn|error|off`（默认 `info`）。保留最新 20 个文件、总量不超过 50 MB。末行不是 `plugin unmounted` 的日志属于被杀掉的 run。

## 开发

开发环境、提交规范与发布流程详见[参与贡献](docs/CONTRIBUTING.zh-CN.md)。

## 文档

- [引擎手册](docs/engine.zh-CN.md)（另见 [English](docs/engine.md)）
- [external-solvers-example](external-solvers-example/README.zh-CN.md)
- [参与贡献](docs/CONTRIBUTING.zh-CN.md)

## 许可

MIT © 2026 curtainsmall
