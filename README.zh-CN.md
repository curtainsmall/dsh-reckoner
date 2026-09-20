# DeepSeek Harness Reckoner

面向 DeepSeek Harness 的电气与电子计算插件。

本项目基于 [dsh-electro-lab](https://github.com/curtainsmall/dsh-electro-lab) v0.13.0（MIT，© curtainsmall）改造：沿用其引擎工作，更名后继续推进，工具面将在下一步变动。版本线自 0.1.0 重新开始，两者不构成 API 连续。

[English](README.md)

## 目录

- [DeepSeek Harness Reckoner](#deepseek-harness-reckoner)
  - [目录](#目录)
  - [安装](#安装)
  - [Reckoner 模式](#reckoner-模式)
  - [记录](#记录)
  - [文章生成](#文章生成)
  - [外部求解器](#外部求解器)
  - [配置](#配置)
  - [文档](#文档)
  - [许可](#许可)

## 安装

```sh
dsh plugin --profile web add dsh-reckoner
```

## Reckoner 模式

插件以智能体预设的形式工作：启动会话时选择 **Reckoner 模式**，用自然语言提出任何电气或电子问题即可。该会话被隔离在插件工具内，没有 shell、文件系统与网络，因此答案中的每个数字都来自引擎；条件不足时，智能体会停下来询问。

全部计算都在一台确定性的**引擎**内完成。智能体把类型化值写入槽、调用 38 个内置求解器之一，再把结果读回；引擎在计算边界换算单位，并把每一步记录成一条可回读的记录。

| 原语 | 作用 |
|---|---|
| `set` | 把一个类型化值写入槽 |
| `get` | 读回一个槽 |
| `call` | 运行一个已注册求解器并存下结果 |
| `solver_info` | 在调用前返回求解器的签名 |
| `record_question` / `record_analyse` / `record_answer` | 把一次求解括成一条记录 |

目录覆盖表达式代数、数列求和、传递函数、数字信号处理与 DFT、信号质量、电路、电子学、射频与史密斯圆图、传输线、噪声与滤波器设计。

## 记录

已结算的记录列在客户端面板的 **「记录」页**，每 5 秒刷新；从未封口的记录会标记为未完成。点开一条记录即进入时间线：每次写入、读取、调用与失败各一张可折叠卡片，值为 JSON 树，工具栏与标题固定、仅时间线滚动。列表支持多选与删除。

一条记录就是一次求解的过程：每一步都能独立阅读，被中断的求解会在宿主重启后从它的记录继续。

## 文章生成

每条记录都可以写成一篇独立的解题文章。宿主 LLM 依据轨迹撰写——问题、条件、分析、带参数与结果的求解步骤、最终答案——以模型自己的口吻呈现，正文绝不提及本插件。

| 格式 | 产物 |
|---|---|
| Markdown | 平铺的 `.md` 文件，从不编译 |
| LaTeX | XeLaTeX 文档，由 LaTeX 驱动编译为 PDF |

设置对话框会记住文章语言、输出目录与文件名。编译需要 latexmk 或 MiKTeX 的 texify，并需要 `xelatex` 引擎；对话框在宿主每次启动时检查一次工具链，没有可用驱动时「生成」按钮会禁用并给出原因。任务可取消，其进度对话框可最小化为角落胶囊、在页面切换间存活；生成的文件或其目录可以从该对话框直接打开。

## 外部求解器

除内置目录外，你还可以注册自己的求解器，经 http 访问。声明存放在 `~/.dsh-reckoner/external-solvers.jsonl`，在引擎启动时编译进 solver 注册表，因此 `solver_info` 与 `call` 对它与内置求解器一视同仁。

| 声明途径 | 方式 |
|---|---|
| 面板 | **「外部求解器」页**：列出、添加、编辑、启用、停用、删除 |
| 智能体 | `external_solver_add`、`external_solver_update`、`external_solver_delete` |
| 文件 | 直接编辑归档 |

声明包含名称、描述、参数、显式的 `returns` 形状与端点，可以用面板的引导式表单填写。更改在宿主重启后生效，在此之前面板会显示待重启提示。

对端收到 `{ "requestId": …, "args": … }` 的 POST 后，以 `{ "requestId": …, "result": … }` 应答；要报告失败则返回 `{ "requestId": …, "error": "…" }`。参数与结果都是类型化值，因此单位以 SI 数字传输，而不是符号或单位词。

完整契约见[引擎手册 §6](docs/engine.zh-CN.md#6-外部求解器)；[`external-solvers-example/`](external-solvers-example/README.zh-CN.md) 是可运行的对端与逐字段注册指南。

## 配置

| 设置 | 含义 |
|---|---|
| `DSH_RECKONER_HOME` | 插件主目录，默认 `~/.dsh-reckoner` |
| `DSH_RECKONER_LOG_LEVEL` | `debug`、`info`、`warn`、`error` 或 `off`；默认 `info` |

主目录存放记录、声明归档、插件状态，以及每次宿主运行一个日志文件。两者都在引擎手册中说明：[存储](docs/engine.zh-CN.md#7-存储)与[日志](docs/engine.zh-CN.md#8-日志)。

## 文档

| 文档 | 内容 |
|---|---|
| [引擎手册](docs/engine.zh-CN.md) · [English](docs/engine.md) | 类型化值、原语、求解器目录、外部求解器、存储、日志 |
| [external-solvers-example](external-solvers-example/README.zh-CN.md) · [English](external-solvers-example/README.md) | 可运行的回显对端与逐字段注册指南 |
| [参与贡献](docs/CONTRIBUTING.zh-CN.md) · [English](.github/CONTRIBUTING.md) | 环境搭建、提交规范、发布流程 |

## 许可

MIT © 2026 curtainsmall
