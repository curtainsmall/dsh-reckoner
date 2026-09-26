# DeepSeek Harness Reckoner

面向 DeepSeek Harness 的计算引擎，用来强制 LLM 通过确定性程序求值，而不是靠文本生成。

[English](README.md)

## 目录

- [DeepSeek Harness Reckoner](#deepseek-harness-reckoner)
  - [目录](#目录)
  - [安装](#安装)
  - [Reckoner 预设](#reckoner-预设)
  - [引擎](#引擎)
    - [基础](#基础)
    - [记录](#记录)
  - [文章生成](#文章生成)
  - [配置](#配置)
  - [文档](#文档)
  - [许可](#许可)

## 安装

```sh
dsh plugin --profile <profile> add dsh-reckoner
```

## Reckoner 预设

本包附带两个智能体预设：
| 预设 | id | 工具 | 外部来源 |
|---|---|---|---|
| **Reckoner** | `reckoner` | 记录工具与求值工具 | 全部知识来自 LLM |
| **Reckoner with search** | `reckoner-with-search` | 与 Reckoner 预设相同的工具，外加网页检索工具 | 包含网页检索结果 |


会话只拿到本插件的工具，别无其他：没有 shell、没有文件系统、没有网络、没有子代理。因此一次求值中的每个数字，要么是 LLM 用 `set` 存入的值，要么是 `eval` 产生的结果。当给出的条件不足以求解时，LLM 应停下并指出。

**Reckoner with search** 预设另外提供检索工具，供 LLM 到网上查找外部知识。

## 引擎

### 基础

每个宿主进程运行一台引擎，所有会话的调用都作用于它。它是一台不含领域知识的计算器。LLM 把条件中给出的量 `set` 进引擎，自行构思思路并写下公式交给 `eval` 求值，再取回结果用于输出。
| 工具 | 作用 |
|---|---|
| `set` | 写入一个槽；`value: null` 删除该槽 |
| `get` | 读回一个槽；这是读取值的唯一方式 |
| `eval` | 把一条公式的结果写入 `target` 指定的槽 |
| `record_start` / `record_end` | 开启与封闭一条记录 |
|`record_message`|把说明写进记录|
`search`（仅 **Reckoner with search** 预设）|在网页上检索|

一个值是数字、复数、值的数组或具名值的对象。在引擎里，单位以 SI 基本单位的组合表示。一条公式就是作用于各槽的一个表达式，含 `+ - * / ^` 以及一组 `$` 符号与常量。没有比较、没有逻辑、没有赋值。调用返回 `{ok: true, ...}` 或 `{ok: false, code, error}`，被拒绝时不改变任何状态。


### 记录

一条记录就是一次计算的过程：它的标题、条件、说明、求值步骤与可选的结束语。

已封闭的记录在 `<home>/records/<id>.jsonl`，尚未封闭的那条在 `<home>/open-record.jsonl`，封闭时后者被重命名为前者，因此封闭的记录总是完整的。

完整参考见[引擎手册](docs/engine.zh-CN.md)（[English](docs/engine.md)）。
## 文章生成

每条已封闭的记录都可以写成一篇独立的文章。宿主侧 LLM 调用以纯文本接收记录事实，数字截到最多四位小数。
| 格式 | 产物 |
|---|---|
| Markdown | 平铺的 `.md` 文件 |
| LaTeX | `.tex` 源文件写入以文件名命名的目录，按需编译为 PDF |

对 LaTeX，PDF 编译交由 latexmk 或 MiKTeX 的 texify 完成，并需要 `xelatex` 引擎；勾选编译而没有可用驱动或引擎时，「生成」按钮禁用，对话框指明缺少的部分。

## 配置

| 设置 | 含义 |
|---|---|
| `DSH_RECKONER_HOME` | 插件主目录，默认 `~/.dsh-reckoner` |
| `DSH_RECKONER_LOG_LEVEL` | `debug`、`info`、`warn`、`error` 或 `off`；默认 `info` |

主目录存放未封闭的记录（`open-record.jsonl`）、已封闭的记录（`records/<id>.jsonl`）、插件状态与日志（`logs/<YYYY-MM-DD_HH-mm-ss.SSS>.log`，每次插件挂载一个文件）。状态文件 `state.json` 是一棵树：每个会记忆设置的模块一个子树，外加扁平的 `restartRequired` 标记。

## 文档

| 文档 | 内容 |
|---|---|
| [引擎手册](docs/engine.zh-CN.md)（[English](docs/engine.md)） | 引擎的长篇参考 |
| [reckoner-interface](skills/reckoner-interface.md)、[reckoner-template](skills/reckoner-template.md) | Reckoner 模式下智能体所读的手册 |
| [参与贡献](docs/CONTRIBUTING.zh-CN.md)（[English](.github/CONTRIBUTING.md)） | 环境搭建、提交规范、发布流程 |

## 许可

MIT。Copyright (c) 2026 curtainsmall
