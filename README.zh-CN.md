# DeepSeek Harness Reckoner

面向 DeepSeek Harness 的确定性计算引擎：公式由模型书写，数值规则由引擎掌握。

本项目基于 [dsh-electro-lab](https://github.com/curtainsmall/dsh-electro-lab) v0.13.0（MIT，Copyright (c) curtainsmall）改造：沿用其引擎工作、更名后继续推进，内置求解器目录已全部移除，数学改由模型提供；版本线自 0.1.0 重新开始，两者不构成 API 连续。

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
dsh plugin --profile <profile> add dsh-reckoner
```

本地检出改用路径安装，即 `add link:<path>`。该命令会把 `dsh-reckoner` 追加进 profile 的 `dsh.profile.bundles`，profile 启动时再合并本包自带的 `dsh.bundle.patch`（`cordis.patch.yml`），由它插入插件行。

## Reckoner 模式

本包附带两个智能体预设。会话在创建时选定其一：除了问题需要外部事实，否则就该选纯粹的 `reckoner` 预设——会话一旦产出过内容，就无法再换预设。

| 预设 | 计算沙箱 | 外部检索 |
|---|---|---|
| **Reckoner**（`reckoner`） | 六个插件工具，无网络 | 无 |
| **Reckoner with search**（`reckoner-with-search`） | 同样的六个工具，外加 `search` | 一次一个事实，连同出处写进记录 |

纯粹预设中的会话只暴露六个插件工具，没有 shell、文件系统、网络与子代理，因此答案中的每个数字都来自 `set` 的转录或 `eval` 的结果；缺少用户未给出的量时，智能体按人设停下并指明该量。每个提问都由一条记录承载，而记录里的引擎是可选的：`set` 与 `eval` 只承载需要数字的部分，不需要数字的提问由记录自身的说明文字作答。检索预设只多加一个工具 `search`，别的什么也不加：通用的 `web_search` 与 `web_fetch` 工具两个预设都不挂载，所以模型永远无法自行检索或抓取。

插件每次挂载都会把两个预设目录复制到 `$DSH_HOME/.agent-presets/`；两个预设都只提供人设，因为插件本身由 bundle patch 全局挂载。

一次检索只接收一个问题，只给模型一句答案——查询词、页面与出处都不给它。记录保存的正是模型看不到的东西：问题、提供方返回的每一个候选出处、策略允许的出处，以及写出答案的抽取步骤所用的路由与提示词版本。取数策略就是该预设行的配置：严格层级只保留允许列表上的参考资料主机，一条记录默认最多带四次检索。

## 计算引擎

每个宿主进程只有一个引擎，所有会话的工具调用都作用于它。它是一台不含领域知识的计算器：没有求解器、没有注册表、没有具名公式。它解析收到的值，在求值模型书写的公式时检查量纲，并记录每一次调用。

| 工具 | 作用 |
|---|---|
| `set` | 写入一个槽；`value: null` 删除该槽 |
| `get` | 读回一个槽；这是读取值的唯一方式 |
| `eval` | 把一条公式的结果写入 `target` 指定的槽 |
| `record_start` / `record_message` / `record_end` | 开启、批注并封闭一条记录 |

- 一个值由数字、复数（按直角坐标存储）、数组或对象，加上一个 SI 向量构成；向量的 7 个整数指数按 ISO 80000-1 顺序排列（m、kg、s、A、K、mol、cd）。`set` 接收带标签的值：`{"num": 4500, "dim": "ohm"}`、`{re, im}`、`{mag, ang}`、`{array: [...]}`、`{object: {...}}`，其中 `dim` 是表中的名称或这 7 个整数本身。表中只有 SI 名称，其他单位一律由模型在调用前换算；`degC` 是唯一的仿射名称，以开尔文存储。
- 一条公式就是一个表达式：`@name` 读取槽，`@name[i]` 读取数组元素，`@name.field` 读取对象字段。`$` 记法提供 5 个常量、20 个一元函数、4 个二元函数与 6 种有界形式；`$sum`、`$prod`、`$seq` 可求值，`$integral`、`$limit`、`$diff` 能写但不可求值。运算符为 `+ - * / ^`，乘法必须写 `*`；公式里没有比较、逻辑、条件与赋值。
- 量纲在求值过程中推导：指数必须无量纲；实数指数按倍数缩放底数的向量，复数指数要求底数无量纲；`+`/`-` 要求两侧向量相同，`*`/`/` 则对向量做加减。分数向量在写入槽时被拒绝。
- 每次调用返回一个回执：`{ok: true, ...}` 或 `{ok: false, code, error}`；被拒绝的调用不改变任何状态，并给出 19 个稳定错误码之一。

## 记录

一条记录就是一次计算的过程：标题、求解所依据的条件、过程中的说明、求值步骤与可选的结束语。记录已开启时 `record_start {title}` 被拒绝，无记录时 `record_end {text?}` 被拒绝；`record_message` 的 `hide: true` 使该说明不进记录视图，但文章生成仍会收到它。

没有记录时 `set`、`get`、`eval` 一律被拒绝；封闭记录会清空槽表，因此槽表非空恰好等价于存在一条未封闭的记录。开启期间其行写在 `<home>/open-record.jsonl`；封闭时该文件被重命名为 `<home>/records/<id>.jsonl`，故封闭是原子操作，`records/` 下的文件总是完整记录。记录文件的首行是 `{seq: 0, version: 1}`；无此行或版本更旧者计为未知记录，不会列出、提供或用于生成。这里没有索引文件。

**Reckoner** 面板即同名侧边栏入口（钢笔与直尺图标）；它读取 `/api/dsh-reckoner/` 下的十一条 HTTP 路径（记录两条、生成八条、设置一条），每 5 秒刷新一次。它有两个标签页。**记录** 给出已封闭的记录、置顶的未封闭记录，以及一行红色的 `N 条未知记录`（点击即可删除这些文件）；选中项以行的边框标示。打开记录即进入其时间线：标记卡片，每个 `eval` 步骤一张卡片（含公式与代入的槽值）；隐藏的说明仅在 **显示全部** 下显示，该开关的初值就是 **设置** 保存的偏好。**设置** 给出每种文章格式的生成默认值、检索策略与上述显示偏好，并在有改动等待宿主重启时显示一行。

## 文章生成

每条已封闭的记录都可以写成一篇独立的文章。宿主侧 LLM 调用以纯文本接收记录事实：标题、仍然成立的条件、按 `seq` 顺序交错的说明与求值步骤、结束语；数字截到最多四位小数，`hide: true` 的说明以作者注交给写作者且不得写进文章；产品名只出现在固定标题 `DeepSeek Harness Reckoner Solution` 与固定作者行中。

| 格式 | 产物 |
|---|---|
| Markdown | 平铺的 `.md` 文件，从不编译 |
| LaTeX | `.tex` 源文件写入以文件名命名的目录，按需编译为 PDF |

每种格式各自记住自己的输出目录与语言，LaTeX 还会记住是否编译：设置对话框以该格式记住的值打开，设置标签页编辑的是同一批值。文件名默认由记录标识符预填。PDF 编译交由 latexmk 或 MiKTeX 的 texify 完成，并需要 `xelatex` 引擎；勾选编译而没有可用驱动或引擎时，「生成」按钮禁用，对话框指明缺少的部分。

## 配置

| 设置 | 含义 |
|---|---|
| `DSH_RECKONER_HOME` | 插件主目录，默认 `~/.dsh-reckoner` |
| `DSH_RECKONER_LOG_LEVEL` | `debug`、`info`、`warn`、`error` 或 `off`；默认 `info` |

主目录存放未封闭的记录（`open-record.jsonl`）、已封闭的记录（`records/<id>.jsonl`）、插件状态（`state.json`，一棵树：每个会记忆设置的模块一个子树，外加扁平的 `restartRequired` 标记）与日志（`logs/<YYYY-MM-DD_HH-mm-ss.SSS>.log`，每次插件挂载一个文件）。

## 文档

| 文档 | 内容 |
|---|---|
| [引擎手册](docs/engine.zh-CN.md)（[English](docs/engine.md)） | 引擎的长篇参考 |
| [reckoner-interface](skills/reckoner-interface.md)、[reckoner-template](skills/reckoner-template.md) | Reckoner 模式下智能体所读的手册：值、回执、记法、量纲、记录协议 |
| [参与贡献](docs/CONTRIBUTING.zh-CN.md)（[English](.github/CONTRIBUTING.md)） | 环境搭建、提交规范、发布流程 |

## 许可

MIT。Copyright (c) 2026 curtainsmall
