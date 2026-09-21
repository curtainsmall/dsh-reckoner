# Reckoner 引擎手册

[English](engine.md)

Reckoner 插件的全部计算都在一台确定性的**引擎**内完成。它是一台没有任何领域知识的计算器：没有内置求解器，没有注册表，没有求解器签名，不懂物理，也不认识任何具名公式。数学由模型以公式提供，而全部数值规则由引擎执行——它解析值、还原词头与单位变体、做复数运算、在求值过程中推导量纲，并把每一步记录进一条可回读的记录。

每个宿主进程运行一台引擎。任何会话的标记都作用于它，且任何时刻至多有一条记录未封口。

以 **Reckoner 模式**启动的会话，会通过 `reckoner-interface` 与 `reckoner-template` 两个技能携带同样的规则。

## 目录

- [1. 引擎是什么](#1-引擎是什么)
- [2. 插件工具面](#2-插件工具面)
- [3. 值](#3-值)
- [4. 公式](#4-公式)
- [5. 记号](#5-记号)
- [6. 量纲](#6-量纲)
- [7. 记录与轨迹](#7-记录与轨迹)
- [8. 错误](#8-错误)
- [9. 存储与日志](#9-存储与日志)
- [10. 文章生成](#10-文章生成)
- [11. 面板](#11-面板)

## 1. 引擎是什么

引擎是确定性的，分工也是精确的：

| 引擎负责 | 模型负责 |
|---|---|
| 把一个值字符串解析成 SI 并保留其 kind | 按值本来的说法写出它：`4.7kohm`、`25degC` |
| 还原词头、单位变体与复数写法 | 选定关系并写出公式 |
| 对一条表达式求值 | 用 `@name` 引用用户给出的量 |
| 推导每个中间量与结果的量纲 | —— |
| 拒绝与目标槽所钉 kind 不符的结果 | 改公式，再调一次 `eval` |
| 每步追加一行轨迹，输入与输出都在其中 | 用 `get` 读回数字 |

- **没有注册表，也没有求解器签名。** 引擎完全不持有领域知识：它不懂物理、不懂电子学，也不认识具名公式。数学由模型以公式提供，数值规则由引擎执行。
- **算术只在 `eval` 内发生。** `set` 只是转录它收到的内容，在这个边界上不做任何计算。
- **数字来自槽位，绝不来自记忆。** 答案里的每个数字要么是 `set` 存下的条件，要么是此前某次 `eval` 写入其 target 的值，并且都用 `get` 读回。
- **公式必须用上这些条件。** 一条忽略用户给出的量、把数字硬写进去的公式，即使能算出结果也是错的。

## 2. 插件工具面

| 工具 | 参数 | 收据 |
|---|---|---|
| `set` | `name`、`value`（一个值字符串，或 `null` 删除该槽位） | `{ ok:true, name, rev, value }`；删除：`{ ok:true, name, deleted }` |
| `get` | `name`、`format`（可选） | `{ ok:true, name, format, value }`——`value` 是打印出的文本 |
| `eval` | `formula`（一条表达式）、`target`（槽位名，或 `null`） | `{ ok:true, target, rev }` |
| `record_question` | `text` | `{ ok:true, record }`——开启记录并清空变量表 |
| `record_analyse` | `text` | `{ ok:true }` |
| `record_answer` | `text` | `{ ok:true, record }`——封口该记录 |

每次调用都返回一张收据，不存在第二条失败通道：

```
success: set  → { ok:true, name, rev, value }    delete: { ok:true, name, deleted }
         get  → { ok:true, name, format, value }
         eval → { ok:true, target, rev }         target null: { ok:true, target:null, rev:null }
failure:      → { ok:false, code, error }
```

- `set` 写入的是**用户给出的条件**（转录）。它的收据回显存下的值，并按 SI 形式打印：`value: "4.7kohm"` 回显为 `value: "4700ohm"`。
- `eval` 写入的是**计算得出的量**。`target` 是结果存入的槽位；`target: null` 只求值，不存任何东西。
- **`eval` 不返回它的值。** 要看数字，就对写入的那个槽位调用 `get`。
- `get` 的 `format` 决定存下的值如何打印（§3.4）；省略它即 SI 形式。
- **失败的调用没有副作用**：不写槽位，不改任何值。读收据，按 `error` 指出的问题改，再调一次（§8）。

### 2.1 槽位规则

| 规则 | 行为 |
|---|---|
| 名字 | 字母、数字与下划线，且以字母或下划线开头；`name` 与 `target` 都是裸槽位名，绝不带 `@` |
| 钉死 | 首次写入钉死该槽位的 kind；之后写入别的 kind 或类型会以 `ENGINE_SLOT_KIND` 失败，且不推进版本号 |
| 覆盖 | 同 kind 的覆盖会整体替换其值并推进 `rev`；不继承旧值的任何部分 |
| 删除 | 以 `value: null` 执行 `set` 即删除该槽位；删除不存在的槽位是幂等的 ok，`deleted: false`，之后重建从 rev 1 开始 |
| 失败 | 失败的操作什么都不写 |

## 3. 值

一个值是**一个普通字符串**，按它本来的说法写出：

```
4.7kohm        4700ohm       100uohm       12volt        1.5second     50hertz
25degC         14.7psi       2hp           5             (a bare count)
2j             3+4i          1e5                          (complex, scientific notation)
[100ohm, 220ohm]             {v: 12volt, r: 100ohm}       (array, object)
"a string"
```

不存在类型化值信封，也不存在槽位引用值：值就是字符串，`@name` 只是公式内的语法（§4），也没有 `boolean` 类型——指示函数就是 `0`/`1`，kind 为 `none`。

### 3.1 词头、单位与变体

**词头是单字母，单位是全词。** 词头为 `p n u m k M G T`（10^-12 至 10^12），且词头后必须跟单位：`5k` 被拒，`5kohm` 可以。词头也可以加在变体词前：`10kdegC` 就是 `k` + `degC`。

单位词为 `second metre gram amp kelvin radian decibel hertz ohm farad henry volt watt pascal joule`，再加上变体词——每个变体都以非 SI 的方式表达某个 kind：

| 变体 | kind | 换算到的 SI 基准 |
|---|---|---|
| `degC`、`degF` | temperature | K |
| `deg` | angle | rad |
| `bar`、`psi`、`atm` | pressure | Pa |
| `cal`、`Wh` | energy | J |
| `hp` | power | W |
| `inch`、`foot`、`yard`、`mile` | length | m |
| `lb`、`oz` | mass | kg |

- **只接受全词**：`ohm` 不写 `Ω`，`second` 不写 `s`，`degC` 不写 `°C`。符号在字符层面就被拒绝；一切都是 ASCII。
- **裸数字是纯计数**（kind 为 `none`）。它绝不继承相邻量的单位，这正是 `5 + @V_in` 被拒的原因——写 `5volt`。
- **存下来的就是 SI**：`4.7kohm` 与 `4700ohm` 是同一个存下的值（`4700` + `resistance`）；`25degC` 变成 `298.15` + `temperature`。词头与变体词只在解析与打印时存在。

### 3.2 复数与科学计数法

`2j`、`3+4i`、`3-4j`：`i` 与 `j` 是虚数后缀，带后缀的项就是虚部，而单独的 `i` 或 `j` 本身就是虚数单位。复数以直角形式（`re`、`im`）存储。科学计数法只接受小写 `e`：`1e5`；`1E5` 与 `2e` 都会被拒，`error` 中给出改写方式。

### 3.3 结构

`[100ohm, 220ohm]` 是数组，`{v: 12volt, r: 100ohm}` 是字段名为字面名的对象，`"a string"` 是字符串（转义 `\"`、`\\`、`\n`、`\t`）。一个值就是一个值，绝不是算术表达式：`2*3` 被拒，信息会说明一个值只能是一个量、复数、数组、对象或字符串。

### 3.4 打印：`get` 的 `format`

`get` 打印存下的值；打印从不改变存下的内容。格式词表就是 §3.1 的词表，因此 `get` 打印出的字符串通常可以原样喂回 `set` 或公式。

| format | 打印为 |
|---|---|
| 省略 | SI 形式：`4700ohm` |
| 一个单位（`ohm`） | 同一个词：`4700ohm` |
| 词头 + 单位（`kohm`） | `4.7kohm` |
| 一个变体（`degC`） | `25degC`——仿射换算在这里发生 |
| `deg` / `rad` | 一个角度 |
| `polar` | 极坐标形式的复数：`111.80339887498948∠0.4636476090008061`（默认是直角形式：`100+50j`） |
| `json` | 存下的信封：`{"type":"number","value":4700,"kind":"resistance"}` |

- 既不指名单位、也不指名「词头+单位」或变体，又不是三个专用词（`rad`、`polar`、`json`）之一的格式会被拒，信息会列出合法取值。
- 没有单位词的 kind（`none`）打印为裸数字。
- 数组逐元素、对象逐字段应用同一格式。
- 往返闭合有一个例外：复数一律以无单位形式打印，因此解析器读回的是 `3+4j`。

### 3.5 槽位引用

槽位引用是 `@name`，它**只存在于公式内**（§4）。它是只读的；接收结果的槽位由 `eval` 的 `target` 参数给出。任何地方都不存储引用，引用也永不进入值或打印结果。

## 4. 公式

`eval` 接收**一条表达式**和一个 `target`：

```
formula        := expression
expression     := additive
additive       := multiplicative (('+' | '-') multiplicative)*
multiplicative := unary (('*' | '/') unary)*
unary          := ('-' | '+')* power
power          := postfix ('^' unary)?              # right-associative
postfix        := primary ('[' expression ']' | '.' IDENT)*
primary        := NUMBER | IDENT | '$' symbol | '@' IDENT
                | '(' expression ')' | arrayLiteral | objectLiteral | STRING
symbol         := '$' IDENT
                | '$' IDENT '(' args ')'
                | '$' IDENT '_{' subexpr '}' ['^{' subexpr '}'] '(' args ')'
```

### 4.1 读与写

- `@name` **读**一个槽位。它只读，永不出现在任何东西的左侧。
- `target` 是本次调用**写入**的槽位，它是一个参数，不是语法。
- **公式内没有赋值**：既没有 `@x = …`（槽位只读），也没有 `x = …`（没有局部量），更没有语句序列。`=` 只出现在下标位里（`_{k=a}`），在那里表示绑定。
- 裸名字是**绑定变量**，只由绑定记号引入（`$sum_{k=a}^{b}(…)`、`$prod_{k=a}^{b}(…)`、`$seq_{k=a}^{b}(…)`、`$diff(body, x)`、`$integral_{a}^{b}(body, x)`、`$limit_{x->a}(…)`）。其他任何裸名字都会以 `ENGINE_IDENT_UNBOUND` 被拒，其信息会告诉你改写 `@name`。
- 字符串字面量（`"…"`）是值；这门语言对它们除了携带之外没有任何运算。

### 4.2 运算符与优先级

- 运算符为 `+ - * / ^`；`->` 只出现在 `$limit` 的下标位里（`x->a`）。
- 优先级依次为 additive → multiplicative → unary → power → postfix → primary。`^` 右结合，且比一元负号结合得更紧，因此 `-2^2` 是 `-4`。
- **乘法必须写 `*`**：`2@R`、`2$pi` 与 `2(3)` 全部被拒。
- 写在数字之后、中间隔一个空格的单位属于该数字：`100 ohm` 就是 `100ohm`。

### 4.3 数据访问

| 形式 | 含义 |
|---|---|
| `@x[k]` | 数组的元素 `k`；下标是表达式，且必须是无单位的整数 |
| `@th.field` | 对象的字段 `field`；是字面名，不是表达式 |
| 链式 | `@net.ports[0].z`——下标与字段在同一条路径上链式书写 |

下标越界会被拒，信息给出下标与长度；对非数组取下标会被拒，说明它不可取下标；访问不存在的字段会被拒，并列出该对象实际拥有的字段。

### 4.4 数组按元素运算

- 运算符两侧长度必须相同（`ENGINE_ARGS_INVALID` 会给出两个长度），元素逐个合并，标量则广播到另一侧。
- 公式里的数组字面量必须同 kind；混 kind 会以 `ENGINE_TYPE_MIXED_KIND` 失败，信息指出破坏它的那个元素与第一个元素。
- 没有矩阵代数：`$seq` 负责构造数组，`[...]` 负责遍历，`$transpose` 负责转置写成「数组的数组」的矩阵（§5）。

### 4.5 `target` 与一步的粒度

- `target` 是裸槽位名。已存在的槽位必须与它钉死的 kind 一致；新槽位则按公式推导出的 kind 钉死。与槽位 kind 相矛盾的结果会在任何写入之前被拒（§6）。
- `target: null` 只求值，不存任何东西；结果仍然落入记录。
- **宁可多调几次 `eval`，也不要硬写成一条深嵌套表达式。** 当同一个子表达式出现两次、括号嵌套超过约三层、或这一行开始难以阅读时，就把工作拆开：先用它自己的 `target` 求出中间量，再在下一次调用里用 `@` 读回它。每次调用都在记录里留下自己的公式与结果，文章因此可以把 `Vth`、`Rth`、`Pmax` 写成有名字的步骤，而不是一堵符号墙。

### 4.6 这门语言没有的东西

**无比较、无逻辑、无条件、无赋值**：没有 `if`，没有 `==`，没有 `&&`，没有 `x = …`，也没有语句序列。`boolean` 同样不存在——指示函数就是 `0`/`1`，kind 为 `none`。

## 5. 记号

每个记号都以 `$` 开头，`$` 是引擎的命名空间：用户名字（`sum`、`abs`、`ohm`）永不与记号冲突，也没有任何保留字。不在下表内的 `$` 名字是解析错误，而不是运行期才发现的「未知函数」，其信息会列出全部词表。

记号可以带**下标位** `_{...}` 与**上标位** `^{...}`，以花括号界定。每个记号各自定义它的位置里放什么，因此可以不同：对绑定记号，下标位给出绑定变量及其下界（`_{k=0}`），上标位给出上界（`^{@N-1}`——位置里是表达式，所以槽位要写 `@N`）。常量不带任何位置；由于"位置"就是紧跟在标记后的花括号，其他 `^` 都是幂运算符：`$e^(2)`、`$pi^2` 都合法。位置里要么是该记号自己的绑定形态（`k=a`、`x->a`），要么是一个表达式；位置里的裸名仍是绑定变量，因此 `^{N-1}` 会被拒绝并提示改写成 `@N`。

### 5.1 常量（5 个）

| 记号 | 含义 |
|---|---|
| `$pi` | 圆周长与直径之比 |
| `$e` | 自然对数的底 |
| `$inf` | 无穷大 |
| `$i` | 虚数单位 |
| `$j` | 虚数单位（工程写法） |

### 5.2 函数（19 个一元）

| 记号 | 含义 |
|---|---|
| `$abs` | 绝对值 |
| `$sqrt` | 平方根 |
| `$exp` | e 的参数次幂 |
| `$ln` | 自然对数 |
| `$log` | 以 10 为底的对数 |
| `$sin` | 无量纲值或角度的正弦 |
| `$cos` | 无量纲值或角度的余弦 |
| `$tan` | 无量纲值或角度的正切 |
| `$asin` | 反正弦，结果为弧度 |
| `$acos` | 反余弦，结果为弧度 |
| `$atan` | 反正切，结果为弧度 |
| `$floor` | 不大于该参数的最大整数 |
| `$ceil` | 不小于该参数的最小整数 |
| `$sign` | 参数的符号：-1、0 或 1 |
| `$re` | 实部 |
| `$im` | 虚部 |
| `$arg` | 辐角（相位），以弧度计 |
| `$conj` | 共轭复数 |
| `$transpose` | 以「数组的数组」给出的矩阵的转置 |

### 5.3 函数（4 个二元）

| 记号 | 含义 |
|---|---|
| `$atan2(x, y)` | 点 (x, y) 的辐角，以弧度计 |
| `$min(a, b)` | 两个同 kind 值中较小者 |
| `$max(a, b)` | 两个同 kind 值中较大者 |
| `$mod(a, b)` | a 除以 b 的余数 |

### 5.4 绑定记号（6 个）

| 记号 | 含义 | 可求值 |
|---|---|---|
| `$sum_{k=a}^{b}(body)` | Σ：把 body 按下标变量从下界到上界累加 | 是 |
| `$prod_{k=a}^{b}(body)` | Π：在同一区间上把 body 累乘 | 是 |
| `$seq_{k=a}^{b}(body)` | 在同一区间上把 body 收成一个数组 | 是 |
| `$integral_{a}^{b}(body, x)` | ∫：本引擎只解析，不求值 | 否 |
| `$diff(body, x)` | d/dx：本引擎只解析，不求值 | 否 |
| `$limit_{x->a}(body)` | lim：本引擎只解析，不求值 | 否 |

- 下标位必须给出绑定变量及其下界，上标位给出上界；两个界都必须是无单位的整数。上界低于下界会被拒：`the upper bound 1 is below the lower bound 5 — nothing to sum`。
- `$seq` 是唯一构造数组的记号，随后用 `[i]` 遍历它；嵌套的 `$seq` 生成二维数组的各行。`$sum` 与 `$prod` 只是把同一个 body 累加、累乘，而不是收集。
- **`$integral`、`$diff` 与 `$limit` 能被解析，但不能被求值。** 对它们求值会以 `ENGINE_SYMBOL_NOT_EVALUABLE` 失败，信息给出书写形式，并要求你给出闭式解、或说明该值无法计算。它们存在，是为了让公式仍然能**说出**它的意思。
- 参数个数会被检查：`ENGINE_PARSE_ARITY` 给出记号、它接受的个数与实际收到的个数。
- 各函数对参数的要求既是类型规则，也是量纲规则——`$sin` 接收纯计数或角度，`$ln` 接收正的纯计数，`$sqrt` 把量纲减半，`$min`/`$max`/`$mod` 要求两侧度量同一种东西（§6）。

## 6. 量纲

每个 kind 映射到 7 维 SI 基准 `(kg, m, s, A, K, mol, cd)` 的一个向量。引擎把该向量带过整条表达式，因此它在计算的同时检查数学——你完全不必在任何地方写出 kind。

| kind | 向量 | kind | 向量 |
|---|---|---|---|
| `time` | (0, 0, 1, 0, 0, 0, 0) | `voltage` | (1, 2, -3, -1, 0, 0, 0) |
| `length` | (0, 1, 0, 0, 0, 0, 0) | `resistance` | (1, 2, -3, -2, 0, 0, 0) |
| `mass` | (1, 0, 0, 0, 0, 0, 0) | `capacitance` | (-1, -2, 4, 2, 0, 0, 0) |
| `current` | (0, 0, 0, 1, 0, 0, 0) | `inductance` | (1, 2, -2, -2, 0, 0, 0) |
| `temperature` | (0, 0, 0, 0, 1, 0, 0) | `power` | (1, 2, -3, 0, 0, 0, 0) |
| `amount-of-substance` | (0, 0, 0, 0, 0, 1, 0) | `frequency` | (0, 0, -1, 0, 0, 0, 0) |
| `luminous-intensity` | (0, 0, 0, 0, 0, 0, 1) | `pressure` | (1, -1, -2, 0, 0, 0, 0) |
| `angle` | 无量纲 | `energy` | (1, 2, -2, 0, 0, 0, 0) |
| `log` | 无量纲 | `none` | 无量纲 |

### 6.1 规则

- 加法、减法以及 `$min`/`$max`/`$mod` 要求同量纲；被拒时信息会把两个量纲都写出来。`none + voltage` 被拒，因为裸计数并没有说清那个 5 是不是伏特：写 `5volt`，或者如果本意是相乘就写成乘法。
- 乘法把向量相加，除法把向量相减，`^` 按指数缩放向量。指数必须无量纲。实指数按指数缩放底的向量（`(4volt)^2` 量纲为 `volt^2`）；复指数只允许用在无量纲的底上，因为它的相位是 `Im(指数)×ln|底|`，而 `ln|底|` 会随"底用哪个单位书写"整体平移。于是 `$e^(-$j*$pi/6)` 是一个旋转，`2^(2j)` 也是，而 `(4ohm)^(1+1j)` 被拒。`0` 的负数次幂与复数次幂没有值。
- `none` 是纯计数：乘上它保留另一侧的 kind（`2*@R` 是电阻），且 `none × voltage = voltage`。
- `angle` 与 `log` 都是无量纲的，但各自是独立的 kind：角度只能与角度相加，别的都不行；对数是纯比值。
- `$sin`/`$cos`/`$tan` 接收纯计数或角度，返回纯计数；`$asin`/`$acos`/`$atan` 接收 -1 到 1 之间的纯计数，返回以弧度计的角度；`$ln`/`$log`/`$exp`/`$floor`/`$ceil`/`$sign` 接收纯计数。
- `$abs`、`$re`、`$im` 与 `$conj` 保留参数的量纲，`$arg` 返回以弧度计的角度，`$sqrt` 把向量减半（因此 `$sqrt((4ohm)^2)` 是电阻）。

### 6.2 无名中间量与结果

`volt^2` 是一个没有名字的真实量纲，它在公式**内部**完全合法：`(@V)^2/@R` 就在通往功率的路上先把电压平方。

**只有结果必须落在有名字的 kind 上**，因为目标槽位要钉一个 kind。像 `(4ohm)^2` 这样的结果会以 `ENGINE_DIM_MISMATCH` 被拒；信息说明该结果度量的是一个无名量纲，并要求你把公式拆开，让每一步都落在有名字的量上。

### 6.3 拒绝

与将要写入的槽位 kind 相矛盾的结果会在**任何写入之前**被拒：收据为 `{ ok:false, code:"ENGINE_DIM_MISMATCH", error:"…" }`，信息给出期望的 kind 与推导出的 kind 以及两者的向量，槽位分毫未动。

槽位的 kind 从何而来：

| 写入 | 钉死的 kind |
|---|---|
| 带单位的 `set` | 该单位所表达的 kind（`4.7kohm` → `resistance`，`25degC` → `temperature`） |
| 裸数字的 `set` | `none` |
| `eval` 写入新 target | 公式推导出的 kind |
| `eval` 写入已存在的 target | 必须与已钉死的 kind 一致，否则该次调用被拒 |

## 7. 记录与轨迹

一次求解被标记括起来：

| 标记 | 作用 |
|---|---|
| `record_question` | 开启一条记录并清空变量表 |
| `record_analyse` | 提交思路：已知量、将使用的关系与计划，不含任何算出的数字 |
| `record_answer` | 提交最终答案并封口该记录 |

- `record_question` 追加它的问题行并清空变量表；第二次 `record_question` 会先用一行 `seal`（`kind: "duplicate-start"`）把当前未封口的记录封掉，再开启新的。
- `record_answer` 追加答案行并封口记录。没有未封口记录时，它保留一条只有 `{ tool:"seal", kind:"duplicate-end" }` 一行的简短记录，其收据带 `error: "duplicate-end"`。
- 封口使记录永久定型：轨迹到此结束，之后绝不重算。从未被封口的记录在面板中始终标记为未完成。
- 条件要在其他一切之前用 `set` 存好，`record_analyse` 要在第一次 `eval` 之前。算出的数字只存在于产生它的那次 `eval` 之后；答案引用槽位值或 `get` 的结果，绝不引用记忆中的数字。

### 7.1 轨迹行

每次引擎操作都会向未封口记录的本体追加恰好一行自描述的 JSON——输入与输出都在其中：

```json
{ "seq": 1, "tool": "marker", "kind": "question", "ok": true, "text": "…", "at": … }
{ "seq": 2, "tool": "set", "ok": true, "name": "R1", "value": { "type": "number", "value": 4700, "kind": "resistance" }, "rev": 1, "at": … }
{ "seq": 3, "tool": "get", "ok": true, "name": "R1", "format": null, "value": { …the stored value… }, "at": … }
{ "seq": 4, "tool": "eval", "ok": true, "formula": "@V_in*@R2/(@R1+@R2)", "target": "V_out", "rev": 1,
  "vars": { "V_in": { … }, "R1": { … }, "R2": { … } }, "result": { …the typed result… }, "at": … }
{ "seq": 5, "tool": "eval", "ok": true, "formula": "@R/@R", "target": null, "rev": null,
  "vars": { "R": { … } }, "result": { "type": "number", "value": 1, "kind": "none" }, "at": … }
{ "seq": 6, "tool": "set", "ok": true, "name": "tmp", "value": null, "deleted": false, "at": … }
{ "seq": 7, "tool": "eval", "ok": false, "code": "ENGINE_SLOT_UNDECLARED", "error": "…", "at": … }
{ "seq": 8, "tool": "marker", "kind": "analyse", "ok": true, "text": "…", "at": … }
{ "seq": 9, "tool": "marker", "kind": "answer", "ok": true, "text": "…", "at": … }
```

| 字段 | 含义 |
|---|---|
| `seq` | 该行在记录中的位置，从 1 起 |
| `tool` | `set`、`get`、`eval`、`marker` 或 `seal` |
| `ok` | `true`，或 `false` 并同时带 `code` 与 `error` |
| `at` | 该步发生的时间 |
| `value` | `set` 行存下的值，或 `get` 行读到的值；`null` 表示删除 |
| `rev` | 写入之后该槽位的版本号 |
| `formula`、`target`、`vars`、`result` | `eval` 行：写下的表达式、写入的槽位（纯求值时为 `null`）、公式读到的槽位及其存下的值、以及结果 |
| `code`、`error` | 仅失败行携带 |

- `vars` 恰好是公式读到的那些槽位，按首次使用顺序排列；无论是否给了 target，成功的 `eval` 行都会写下，而绑定变量永不进入轨迹。
- `get` 的收据携带打印出的文本，而它的轨迹行携带存下的值与请求的格式（未指定时为 `null`）：记录保存的是事实，不是排版好的字符串。
- 轨迹只记录引擎操作：没有内核内部步骤，也没有模型的推理文本。它的读者是人，每一步都就地呈现输入与输出。
- **每个原语都会向未封口记录追加一行**，因此 `set`、`get` 与 `eval` 都需要一条已开启的记录：没有记录时该次调用失败，其 `error` 会指明 `record_question`。

### 7.2 按重放恢复

宿主启动时若仍有未封口的记录——即 `sealedAt: null` 且本体存在的索引行——会按序重放该记录的各行来重建变量表：

| 行 | 重放时的动作 |
|---|---|
| `set` | 写入其值；若该行是删除，则移除该槽位 |
| 带 target 的 `eval` | 把**存下的**结果写入目标槽位，不重新求值 |
| `target: null` 的 `eval` | 什么都不做 |
| `marker`、`seal`、失败行 | 跳过 |

随后轨迹在同一文件中继续，序号从最后一行的下一个继续。存下的结果被当作事实使用，因此不重算、不发网络、无随机。已封口的记录是历史而非状态，它的每一行都仍可独立阅读。

### 7.3 一致性

| 情形 | 行为 |
|---|---|
| 本体文件缺失、且仍未封口的索引行 | 引擎启动时清除 |
| 未封口的记录 | 就是 `sealedAt: null` 且本体存在的那条索引行；重启从这一对恢复 |
| `state.json` | 由唯一持有者做读—改—写并原子替换，写入中途崩溃只会留下上一版；不可读时读成 `{}` |

## 8. 错误

每次失败都是一张收据——`{ ok: false, code, error }`——并且什么都不写：

- **`error` 是为你写的那一句话。** 它指出文本中的位置、失败的具体取值以及修正方式。读它，改掉那一处具体问题；不要原样重试同一次调用。
- **`code` 是给机器看的**：轨迹、测试与面板用它匹配。它从不取代那句话。
- **失败的调用没有副作用**：不建槽位、不改值、不动版本号。

命名规则是 `ENGINE_<位置>_<原因>`，位置段说明要改什么：

| 位置段 | 含义 | 该做什么 |
|---|---|---|
| `PARSE` | 源文本不合法 | 照信息提示改写文本 |
| `SLOT` | 名字或槽位规则失败 | 检查名字，或先声明该槽位 |
| `IDENT` | 裸标识符没有绑定 | 改写 `@name`，或改用绑定记号 |
| `DIM`、`TYPE` | 数学上对不上 | 改公式里的量或运算 |
| `RANGE` | 下标或定义域越界 | 改下标或检查输入 |
| `SYMBOL`、`TOOL` | 记号无法求值，或其他工具失败 | 换一条路（给出闭式解），或修正参数 |

代表性错误码，以及它们的 `error` 携带什么：

| 错误码 | 触发条件 | `error` 携带 |
|---|---|---|
| `ENGINE_PARSE_SYNTAX` | 文本结构不合法，或公式为空 | 位置，以及 `expected the closing parenthesis (')')`、`the formula is empty — write one expression, referencing slots with @name` 等 |
| `ENGINE_PARSE_NUMBER` | 数字字面量不合法（`1E5`、`2e`） | 位置、`scientific notation takes a lowercase 'e'`、`'e' must be followed by digits (as in 1e5)`，以及可直接照抄的改写：`write "1e5"` |
| `ENGINE_PARSE_IDENT` | 数字后紧跟单个字母（`1R`、`2x`） | 位置，以及 `an identifier cannot follow a number directly; to multiply, write "*" (as in "1*R")` |
| `ENGINE_PARSE_UNIT` | 单位、词头或变体词不被接受（`5k`、`4.7kΩ`、裸词） | 位置与该词的实情：`'k' is a prefix and must be followed by a unit (p n u m k M G T); to write 5 metres use "5metre"`，或整张单位词表 |
| `ENGINE_PARSE_SYMBOL` | `$` 后接的名字不在记号表内，或函数没写括号 | 位置与完整词表 |
| `ENGINE_PARSE_ARITY` | 记号收到的参数个数不对 | 记号、它接受的个数与实际收到的个数 |
| `ENGINE_SLOT_UNDECLARED` | `@name` 或 `get` 的 `name` 未声明 | 名字，以及「只可用用户给出的条件或前序 `eval` 的 target」 |
| `ENGINE_SLOT_KIND` | 写入会改变槽位已钉死的 kind 或类型 | 已钉死的标识与传入的标识，以及先删除的修正方式 |
| `ENGINE_IDENT_UNBOUND` | 裸标识符没有任何记号绑定 | 名字、会引入绑定的记号，以及 `to read a slot write "@name"` |
| `ENGINE_DIM_MISMATCH` | 推导出的量纲不符、运算混合了量纲、指数带单位、对带量纲的量取复指数次幂，或结果没有具名 kind | 两个量纲（或那个无名量纲）以及修正方式，例如 `write the count with its unit (for example 5volt), or multiply if that is what you mean`、`only a dimensionless base has a complex power`、`split the formula so each step lands on a named quantity` |
| `ENGINE_TYPE_MIXED_KIND` | 数组字面量混了 kind | 破坏它的那个元素、它的度量，以及第一个元素的度量 |
| `ENGINE_TYPE_NOT_ARITHMETIC` | 非算术值（对象、字符串）参与了算术 | 什么与什么做了运算 |
| `ENGINE_RANGE_INDEX` | 下标或界越界 | 下标与长度，或两个界 |
| `ENGINE_RANGE_DOMAIN` | 函数被用在定义域之外：`$ln(-1)`、除零、`$mod` 取零余 | 函数及其定义域 |
| `ENGINE_NOT_INDEXABLE` | 对不是数组的东西取下标 | 被取下标的东西 |
| `ENGINE_NO_FIELD` | 对象没有该字段 | 该字段，以及对象实际拥有的字段 |
| `ENGINE_SYMBOL_NOT_EVALUABLE` | 对 `$integral`、`$diff` 或 `$limit` 求值 | 书写形式，以及「给出闭式解或说明该值无法计算」 |
| `ENGINE_ARGS_INVALID` | 参数形状不符：槽位名不合法、`format` 未知、数组长度不同 | 期望的形状与收到的形状 |
| `ENGINE_UNSUPPORTED_VARIANT` | `get` 的 `format` 指定的单位不表达该值的 kind（对 resistance 用 `format: "degC"`） | 该 format 词、该 kind，以及该 kind 的规范单位 |
| `ENGINE_TOOL` | 兜底，没有更具体的码可用时 | 原样带出内部错误 |

## 9. 存储与日志

插件主目录是 `~/.dsh-reckoner`，`DSH_RECKONER_HOME` 可将其改到别处。

```
~/.dsh-reckoner/
  record-index.jsonl      index rows, one per record
  records/<id>.jsonl      trace bodies, one file per record
  state.json              plugin state
  logs/                   one file per host run
```

| 文件 | 存放 |
|---|---|
| `record-index.jsonl` | 每条记录的 `{ id, openedAt, sealedAt, question }`；`sealedAt: null` 标记仍未封口的那条 |
| `records/<id>.jsonl` | 每次引擎操作一行轨迹 |
| `state.json` | 记忆的生成设置（`generateDir`、`generateLanguage`、`generateFormat`、`generateCompile`） |
| `logs/` | 下文的运行日志 |

### 9.1 日志

每次宿主运行一个文件：`<logs>/<YYYY-MM-DD_HH-mm-ss.SSS>.log`，独占创建并保持打开。每行形如 `<timestamp> <LEVEL> <message>[ k=v …]`，同时写入文件与 stdout。字段值是 JSON 标量；嵌套对象或数组算一个 token，Error 渲染为消息并追加带 `  | ` 前缀的堆栈续行。

| 设置 | 取值 |
|---|---|
| `DSH_RECKONER_LOG_LEVEL` | `debug`、`info`、`warn`、`error`、`off`；默认 `info` |
| 保留 | 最新 20 个文件、总量不超过 50 MB |

这个文件描述自己所属的那次 run：文件名是开始，末行是结束，末行不是 `plugin unmounted` 的日志属于被杀掉的 run。日志承载插件自身的诊断——挂载、端点失败、生成任务——而记录只承载引擎操作。

## 10. 文章生成

每条记录都可以写成一篇独立的解题文章。宿主把记录摊平成朴素的事实，交给一个拥有独立上下文的模型，再把文章写入磁盘。文章以作者自己的解题口吻写成：绝不提及 Reckoner、宿主、公式、推导步骤、记录或生成过程，唯一允许出现名字的地方是固定标题 `DeepSeek Harness Reckoner Solution` 与作者行 `DeepSeek Harness Reckoner`。

记录贡献的内容：

| 事实 | 记录中的来源 |
|---|---|
| 问题 | 索引行的 `question` |
| 条件 | `set` 行，每条写作 `name: <存下的值>`，删除则写作 `name: removed` |
| 分析 | `analyse` 标记的文本，置于既有条件列表之下 |
| 每次成功的 `eval` 对应一个推导步骤 | 它的 `formula`、它代入的槽位（`vars`）与其 `result` |
| 答案 | `answer` 标记的文本 |

- 失败行与 `get` 行被跳过：文章建立在成功的那条推导链及其产出的数字之上。
- `formula` 是推导可被还原的原因——记录是公式唯一留存的地方，因此没有走过的步骤会留下文章无法填补的空缺。
- 文章中的每个数字都必须来自这些步骤与答案；生成提示禁止臆造或重算数字，也禁止把记录内部的步骤标签当作标题照搬。
- **格式**：Markdown（`.md`）与 LaTeX（`.tex`）。LaTeX 的文档外壳由宿主拥有——XeLaTeX，zh-CN 用 `ctexart`、en 用 `article` 加 `fontspec`，再加 amsmath、siunitx 与 unicode-math，固定标题与作者也由宿主给出——模型只写正文。PDF 编译只对 LaTeX 且可选，由 `latexmk`（或 `texify`）驱动 `xelatex`。
- **语言**：`auto`（跟随问题）、`zh-CN` 或 `en`。外壳语言在生成之前就已确定，因此 auto 任务会探测问题文本。
- **任务阶段**：prepare → generate → write → compile。LaTeX 任务把源文件、PDF 与编译产物写进一个以文件名为名的文件夹；Markdown 任务平铺写入，且从不编译。
- 文件名会被强制为对应格式的扩展名；未给出时默认为 `reckoner-<记录 id 的前 8 个字符>`。输出目录、语言、格式与编译开关记忆在 `state.json` 中（§9）。

## 11. 面板

记录面板是侧栏中的 **Reckoner** 入口，覆盖在会话列之上打开。它有两个视图：记录列表与单条记录详情。

### 11.1 记录列表

- 读取 `GET /api/dsh-reckoner/records-index`，每 5 秒轮询一次；从不读取轨迹本体。
- 最新在前。每行显示问题——问题为空时显示记录 id——以及该记录开启的时间。
- 仍未封口的记录带 **未完成** 标记。
- **选择** 模式把各行变成复选框，提供 **全选** 与 **删除所选**，并由确认对话框把关。删除会移除该记录的本体与索引行；当前未封口的记录不能被删除。

### 11.2 记录详情

- 从 `GET /api/dsh-reckoner/records/<id>` 取得——索引元信息加轨迹行——并在记录未封口期间每 5 秒轮询，因此正在进行的求解会实时显现。
- 一张标题卡，含记录 id、可见行数、失败行数，以及封口时间或「未完成」标记。
- 关掉 **显示全部** 会把失败行挡在时间线之外：它们是引擎对尝试过程的交代，不属于解答。
- 各行被归类成叙事：连续的 `set` 行折叠为一张 **写入（n）** 卡（每个槽位一行，并带其版本号），连续的 `get` 行折叠为 **读取（n）** 卡，连续失败折叠为一张红色 **失败尝试（n）** 卡，显示序号、工具、公式（若有）、`code` 与 `error` 文本。
- 每次成功的 `eval` 都有自己的 **计算** 卡：**公式**、**写入槽** 及其版本号（`target: null` 时为 *（只求值，不写入）*）、公式读到的每个槽位一行——`@name` 与其存下的值——可跳到创建该槽位那行 `set` 的标签，以及以树形展示的 **结果**。
- 标记行渲染为带强调色边的卡片：**问题**、**分析**、**答案**、**重复开启（已按错误记录结算）** 与 **无记录时结算（错误记录）**。
- 右列是两颗文章按钮——**生成 Markdown** 与 **生成 LaTeX**——它们打开生成设置对话框；进度、写入路径以及任何编译错误显示在一层浮层上，面板与会话中都始终可见。

### 11.3 宿主端点

| 端点 | 用途 |
|---|---|
| `GET /api/dsh-reckoner/records-index` | 列表所用的索引行 |
| `GET /api/dsh-reckoner/records/<id>` | 一条记录的索引元信息与轨迹行 |
| `DELETE /api/dsh-reckoner/records/<id>` | 移除一条记录的本体与索引行；未封口时被拒 |
| `POST /api/dsh-reckoner/generate` | 启动文章任务（`recordId`、`format`、`directory`、`fileName`、`language`、`compile`） |
| `GET /api/dsh-reckoner/generate-progress` | 轮询该任务 |
| `POST /api/dsh-reckoner/generate-cancel` | 取消该任务 |
| `GET /api/dsh-reckoner/generate-capability` | 生成设置对话框背后的 LaTeX 工具链检查 |
| `GET /api/dsh-reckoner/list-roots`、`GET /api/dsh-reckoner/list-dirs` | 目录浏览器 |
| `GET` / `PUT /api/dsh-reckoner/generate-dir` | 记忆的生成目录与设置 |
| `POST /api/dsh-reckoner/reveal` | 在宿主的文件管理器中打开生成的文件或其目录 |
