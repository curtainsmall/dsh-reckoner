# DeepSeek Harness Reckoner

面向 DeepSeek Harness 的确定性计算引擎：公式由模型书写，数值规则由引擎掌握。

本项目基于 [dsh-electro-lab](https://github.com/curtainsmall/dsh-electro-lab) v0.13.0（MIT，© curtainsmall）改造：沿用其引擎工作、更名后继续推进，内置求解器目录已全部移除，数学改由模型提供；版本线自 0.1.0 重新开始，两者不构成 API 连续。

[English](README.md)

## 目录

- [安装](#安装)
- [Reckoner 模式](#reckoner-模式)
- [计算引擎](#计算引擎)
- [记录](#记录)
- [文章生成](#文章生成)
- [配置](#配置)
- [文档](#文档)
- [许可](#许可)

## 安装

```sh
dsh plugin --profile web add dsh-reckoner
```

本包自带 bundle patch，该命令会把插件行插入 profile 清单。

## Reckoner 模式

插件以智能体预设的形式工作：启动会话时选择 **Reckoner 模式**，用自然语言提出任何计算问题即可。该会话被隔离在插件工具内，没有 shell、文件系统与网络，因此答案中的每个数字都来自引擎；条件不足时，智能体会指明缺少哪个量并停下。

## 计算引擎

全部计算都在一台确定性的**引擎**内完成：它解析值、求值智能体书写的公式、在求值过程中推导量纲，并把每一步记录下来。它不附带任何求解器，也不含领域知识——数学来自模型，数值规则（单位、前缀、复数运算、量纲）来自引擎。

| 工具 | 作用 |
|---|---|
| `set` | 把用户给出的一个值写入槽 |
| `get` | 读回一个槽的打印文本 |
| `eval` | 求值一条公式，并把结果写入 `target` 指定的槽 |
| `record_question` / `record_analyse` / `record_answer` | 把一次计算括成一条记录 |

- 一个值就是一个普通字符串，按读法书写：`4.7kohm`、`12volt`、`25degC`、`2j`、`1e5`、`[100ohm, 220ohm]`、`{v: 12volt, r: 100ohm}`——绝不是 JSON 信封。前缀只有一个字母（`p n u m k M G T`），单位与变体是完整单词（`ohm`，不是 `Ω`；`second`，不是 `s`；`degC`，不是 `°C`），因此值与公式都是 ASCII。
- 存储的值一律是 SI：`4.7kohm` 与 `4700ohm` 是同一个值，`25degC` 变为 298.15 kelvin。`get` 的 `format` 可以按你指定的单位、前缀或变体把槽打印回来，该字符串可以直接再喂回去。
- 一条公式就是一个表达式。`@name` 读取槽，接收结果的槽是 `eval` 的 `target`；`eval` 不返回结果值，模型要用 `get` 把它读回。
- `$` 记法提供 5 个常量、23 个函数与 6 种有界形式：`$sum`、`$prod`、`$seq` 可求值，`$integral`、`$diff`、`$limit` 能写但不可求值。运算符是 `+ - * / ^`，乘法必须写 `*`。
- 引擎把七个 SI 基本量纲带过整个表达式：`@V/@R` 是电流；若结果的种类与将要写入的槽相矛盾，会在写入之前被拒绝。
- 没有比较、没有逻辑、没有条件、没有赋值，也没有 `boolean`：指示量就是 `0`/`1`。

## 记录

记录列在 **Reckoner** 面板（同名侧边栏入口）中，每 5 秒刷新；从未封口的记录会标记为未完成。点开一条记录即进入时间线：问题、分析与答案各一张标记卡片，每个 `eval` 步骤一张卡片（含公式与它代入的槽值），写入与读取折叠成组，`@name` 芯片可跳到定义该槽的 `set` 行。失败的尝试默认不进时间线，打开 **显示全部** 才会出现。面板文本跟随 DSH 语言设置（内置英文与简体中文词典），列表支持多选与删除。

一条记录就是一次计算的过程：每一步都能独立阅读；被宿主重启打断的计算会从它的记录继续。

## 文章生成

每条记录都可以写成一篇独立的解题文章。宿主 LLM 依据轨迹撰写——问题、条件、分析、带公式与结果的 `eval` 步骤，以及最终答案——以模型自己的口吻呈现，产品名只出现在文档固定的标题与作者行中。

| 格式 | 产物 |
|---|---|
| Markdown | 平铺的 `.md` 文件，从不编译 |
| LaTeX | XeLaTeX 文档，写入以文件名命名的目录，按需由 LaTeX 驱动编译为 PDF |

设置对话框会记住文章语言与输出目录，LaTeX 还会记住是否编译 PDF；文件名每次生成时填写，默认由记录 id 预填。编译需要 latexmk 或 MiKTeX 的 texify，并需要 `xelatex` 引擎；对话框在插件每次挂载时检查一次工具链：勾选编译 PDF 而没有可用驱动时，「生成」按钮会禁用并给出原因。任务可取消，其进度对话框可最小化为角落胶囊、在页面切换间存活；生成的文件或其目录可以从该对话框直接打开。

## 配置

| 设置 | 含义 |
|---|---|
| `DSH_RECKONER_HOME` | 插件主目录，默认 `~/.dsh-reckoner` |
| `DSH_RECKONER_LOG_LEVEL` | `debug`、`info`、`warn`、`error` 或 `off`；默认 `info` |

主目录存放记录（`record-index.jsonl`，以及每条记录一个 `records/<id>.jsonl` 轨迹）、插件状态（`state.json`）与日志（`logs/<YYYY-MM-DD_HH-mm-ss.SSS>.log`，每次宿主运行一个文件）。存储布局与日志行格式见引擎手册。

## 文档

| 文档 | 内容 |
|---|---|
| [引擎手册](docs/engine.zh-CN.md) · [English](docs/engine.md) | 值、`set`/`get`/`eval` 工具、`$` 记法、量纲、记录、存储、日志 |
| [reckoner-interface](skills/reckoner-interface.md) | Reckoner 模式下智能体所读的手册：值语法、记法、量纲规则 |
| [参与贡献](docs/CONTRIBUTING.zh-CN.md) · [English](.github/CONTRIBUTING.md) | 环境搭建、提交规范、发布流程 |

## 许可

MIT © 2026 curtainsmall
