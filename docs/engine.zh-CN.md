# Reckoner 引擎手册

[English](engine.md)

Reckoner 插件的全部计算都在一台确定性的**引擎**内完成。
## 目录

- [1. 引擎是什么](#1-引擎是什么)
- [2. 插件工具面](#2-插件工具面)
- [3. 值](#3-值)
- [4. 公式](#4-公式)
- [5. 记法](#5-记法)
- [6. 量纲](#6-量纲)
- [7. 记录与轨迹](#7-记录与轨迹)
- [8. 错误](#8-错误)
- [9. 存储与日志](#9-存储与日志)
- [10. 文章生成](#10-文章生成)
- [11. 宿主端点](#11-宿主端点)
- [12. 外部检索](#12-外部检索)

## 1. 引擎是什么

**引擎**是一台执行求值计算的状态机：

- **没有领域知识。** 引擎对 LLM 将要处理的任何具体领域一无所知，它只按给定的公式做数学求值。
- **没有内置求解器。** 引擎没有任何内置算法，也没有内置的解法。要算什么，由调用方自己决定。

- **数字来自槽，或来自公式自身的字面量。** 除槽表之外，引擎在两次调用之间不留任何记忆，因此推导中的每一个量，要么是存下的值，要么是写进公式的常量。
- **确定性。** 同一张槽表与同一条公式得到同一个值：算术中没有随机、不读时钟、不联网。

## 2. 插件工具面

### 2.1 六个操作

| 操作 | 参数 | 成功收据 |
|---|---|---|
| `set` | `name`（槽位名）；`value`（一个标签值，或用 `null` 删除该槽位） | `{ ok:true, name, rev, value }`；删除时为 `{ ok:true, name, rev:null, value:null }` |
| `get` | `name`；可选的 `form`、`digits` 与 `dim` | `{ ok:true, name, value }` |
| `eval` | `formula`（一条表达式）；`target`（槽位名） | `{ ok:true, target, rev }` |
| `record_start` | `title`，非空字符串 | `{ ok:true }` |
| `record_message` | `text`，非空字符串；可选的 `hide`，布尔值 | `{ ok:true }` |
| `record_end` | 可选的 `text`，字符串 | `{ ok:true }` |

- 没有记录未封闭时，`set`、`get` 与 `eval` 都会被拒（§7.1）。
- `name` 与 `target` 都是裸槽位名，绝不带 `@`：`@` 形式只存在于公式内（§4.3）。
- `set` 存下一个值并回显实际存下的内容；`get` 是唯一返回值的操作。
- `eval` 不返回它的值。收据只给出写入的槽位及其新版本号；值要用 `get` 读回，或在后续公式里以 `@name` 引用。

### 2.2 收据

每次调用都返回一份 JSON 收据，不存在第二条失败通道：

```
success: set  -> { ok:true, name, rev, value }    delete: { ok:true, name, rev:null, value:null }
         get  -> { ok:true, name, value }
         eval -> { ok:true, target, rev }
         markers -> { ok:true }
failure:      -> { ok:false, code, error }
```

`error` 是写给读者的一句话：失败的具体取值、边界或期望，以及修正方式。`code` 是同一个失败中稳定的机器可读部分（§8）。失败调用不改动任何槽位、也不动版本号；但有记录未封闭时，该次失败仍会以 `ok: false` 的一行追加进该记录（§7.2）。

### 2.3 槽位表及其规则

- **名字**是标识符：以字母或下划线开头，其后为字母、数字或下划线。同一条规则覆盖槽位名、`eval` 的 target、对象的字段名与绑定变量名。
- 向不存在的名字**写入**即创建该槽位，版本号为 1。
- **覆盖**整体替换其值并把版本号加一。
- **删除**是以 `value: null` 执行 `set`，且是幂等的：删除不存在的槽位同样是 `ok`，之后重新创建时版本号从 1 开始。
- **失败**的操作什么都不写。
- **生命周期**属于记录：`record_end` 会清空槽表，因此表非空就意味着有记录未封闭。

## 3. 值

### 3.1 四种值类型

| 类型 | 数值 | 量纲 |
|---|---|---|
| `number` | 一个 JSON 数字（`num`） | SI 量纲 |
| `complex` | `re` 与 `im`，两个 JSON 数字，按直角坐标存下 | SI 量纲 |
| `array` | 每个元素是数字、复数或嵌套数组 | SI 量纲；所有元素共用 |
| `object` | 每个字段是一个完整的值 | 每个字段各有一个 SI 量纲；对象自身没有 |

- SI 量纲向量：SI 量纲以 7 个整数指数表示，按 ISO 80000-1 顺序（m, kg, s, A, K, mol, cd）。SI 量纲向量相同的两个值就是同一个量，无论写法如何；§6.1 的 kind 标签只是给人看的名字：它从不被存储，也从不决定任何事。
- 数值位置只接受 JSON 数字，即有限 double。数值位置出现字符串、布尔值或 `null` 都是 `ENGINE_INVALID_ARGS`。
- 只有整向量才能进入槽位：指数为分数的向量在写入任何东西之前就被拒（§6.4）。

### 3.2 `set` 的标签结构

`set` 的 `value` 是一个只携带一个标签的 JSON 对象，外加可选的 `dim`：

```
{"num": 4.7e3}                               a real
{"re": 3, "im": 4}                           a complex, rectangular
{"mag": 5, "ang": 0.927295218}               a complex, polar (radians)
{"array": [1, 2, 3]}                         an array
{"object": {"v": {"num": 12}}}               an object
```

- **恰好一个标签。** 标签为 `num`、`re` 配 `im`、`mag` 配 `ang`、`array` 与 `object`；一个都没有或不止一个都是 `ENGINE_INVALID_ARGS`。不认识的键会被拒，并回显整份标签词表；`dim` 与 `object` 并列也会被拒，因为对象按字段各自带量纲。
- **成对标签不能拆开。** 有 `re` 无 `im`、有 `mag` 无 `ang` 都被拒，并各自指出缺少的那一半。
- **极坐标在入口换算。** `mag` 与 `ang` 变为 `re = mag*cos(ang)` 与 `im = mag*sin(ang)`；存下的值永远是直角坐标。
- **数组元素是裸的。** 元素是数字、`{re,im}`、`{mag,ang}` 或嵌套数组，它自身不带标签、也不带 `dim`，因为整个数组共用同一个量纲。对象永远不能作为数组的元素。
- **对象每个字段各带一个 `dim`。** `object` 把字段名映射到按同一规则解析的完整值，因此字段本身也可以是对象；字段名必须满足 §2.3 的名字规则。

### 3.3 `dim`

`dim` 是值的 SI 量纲的书写形式：

- 一个量纲**名称**，此时数值可能会被换算，以确保该量纲能用 SI 量纲表示（§6.1）。
- **7 个整数**，顺序为 m,kg,s,A,K,mol,cd。
- 省略或为 `null`：零向量。

- 其他任何取值都是 `ENGINE_INVALID_DIMENSION`

### 3.4 `get`

`get {name, form?, digits?, dim?}` 读取一个槽位。读取从不改变已存下的内容。

| 选项 | 含义 |
|---|---|
| `form: "rect"` | 每个标量叶子渲染为 `{re, im}` |
| `form: "polar"` | 每个标量叶子渲染为 `{mag, ang}`，弧度 |
| 省略 `form` | 按存下的形式：实数保持 `{num}` |
| `digits` | 把每个数字四舍五入到该有效位数，绝不补零 |
| `dim`，一个量纲名 | 把值换算到该量纲 |
| `dim`，7 个整数 | 校验存下的 SI 量纲向量，不做换算，并回显这 7 个整数 |
| 省略 `dim` | SI 量纲向量的首个量纲名，或那 7 个整数 |

- `form`、`digits` 与 `dim` 同样作用于每个标量叶子：对象的字段与数组的元素都在内。
- 量纲名对应的向量不对，或 7 个整数与存下的向量不同，都是 `ENGINE_INCOMPATIBLE_DIMENSION`。
- 与存下的向量不匹配的 `dim` 会被拒，错误为 `ENGINE_INCOMPATIBLE_DIMENSION`，并点出两个 SI 量纲向量；对象按字段逐个校验，且不换算任何东西。
- 负实数在 `polar` 下是 `{mag: -x, ang: pi}`；实数在 `rect` 下是 `{re: x, im: 0}`。
- `form` 必须是 `"rect"` 或 `"polar"`，`digits` 必须是正整数；其他任何取值都是 `ENGINE_INVALID_ARGS`。
- 收据：实数是 `{num, dim}`，复数是 `{re, im, dim}` 或 `{mag, ang, dim}`，数组是 `{array: [裸元素], dim}`（元素为裸数字、`{re,im}`/`{mag,ang}` 标量或嵌套数组），对象是 `{object: {字段: <收据>}}` 且自身层级不带 `dim`。

## 4. 公式

### 4.1 字符集与字面量

公式是 ASCII。扫描器接受数字；名字（以字母或下划线开头，其后为字母、数字或下划线）；`$name`；`@name`；空白字符空格、制表符与换行；以及标点 `+ - * / ^ ( ) [ ] { } , . _ =` 与两字符记号 `->`。其他任何字符都以 `ENGINE_INVALID_FORMULA` 被拒，其信息会指出该字符、它的码点以及整个字符集。

| 字面量 | 读作 |
|---|---|
| `12`、`4.7` | 实数；小数点后必须有数字 |
| `1e5`、`2.5e-3` | 科学计数法实数：小写 `e`、可选符号、至少一位指数数字 |
| `2j`、`4i` | 虚标量（`{re: 0, im: 2}`）；`i` 与 `j` 是虚数后缀 |
| `2.5j`、`1e3i` | 同一后缀作用于小数或指数 |

- 标量字面量永远无量纲。
- `e` 后没有指数数字是 `ENGINE_INVALID_NUMBER`。
- 数字紧跟字母是 `ENGINE_INVALID_IDENTIFIER`：字母只允许作为虚数后缀 `i` 或 `j` 跟在数字之后。`1E5` 与 `2x` 都被拒；后者会给出改写 `2*x`。
- 没有布尔字面量、没有字符串字面量、没有量纲字面量，也没有数组或对象字面量：公式里只有数字、槽位与记法。

### 4.2 文法

```
formula        := additive EOF
additive       := multiplicative (('+' | '-') multiplicative)*
multiplicative := unary (('*' | '/') unary)*
unary          := ('-' | '+') unary | power
power          := postfix ('^' unary)?
postfix        := primary ('[' additive ']' | '.' NAME)*
primary        := NUMBER | NAME | SLOT | SYMBOL | '(' additive ')'
SLOT           := '@' NAME
SYMBOL         := '$' NAME
                | '$' NAME '(' args ')'
                | '$' NAME '_' '{' subscript '}' '^' '{' additive '}' '(' args ')'
                | '$' NAME '_' '{' subscript '}' '(' args ')'
subscript      := NAME '=' additive | NAME '->' additive | additive
args           := [ additive (',' additive)* ]
```

- `SYMBOL` 的四种形状是常量、函数、带两个位置的有界形式，以及只带下标的形式（`$diff` 与不带界线的 `$integral` 写成第二种形状）。一个符号接受哪些形状、接受几个参数，是记法表的职责（§5）。
- 一条公式恰好是**一个**表达式：完整表达式之后还有记号是 `ENGINE_INVALID_FORMULA`，而不是第二条语句。
- 优先级依次为 additive、multiplicative、unary、power、postfix、primary：`*` 与 `/` 比 `+` 与 `-` 结合得更紧，一元符号在左侧比 `^` 松，`^` 右结合。`-2^2` 是 `-4`，`2^3^2` 是 `2^(3^2)`。
- 前导 `+` 被丢弃；前导 `-` 取负。
- 乘法必须写出 `*`。`2@R`、`2$pi` 与 `2(3)` 都被拒。
- 位置是紧跟在记法名之后的那个花括号，因此其他每一处 `^` 都是幂运算符：`$e^(2)` 与 `$pi^2` 是幂，而 `^` 后跟 `{` 会被拒。
- 括号用于分组；一个从未闭合的 `(` 或 `[` 会被拒，并指出是哪个字符打开的它。

### 4.3 数据访问

- `@name` 读取一个槽位的值。
- `@name[index]` 读取数组的一个元素；下标是一条 additive 表达式。
- `@name.field` 读取对象的一个字段；字段名是字面名，不是表达式。
- 链式：`@net.ports[0].z` 在同一条路径上读取下标与字段。
- `@name` 只读取；一次调用所写入的槽位是 `eval` 的 `target` 参数（§2.1）。任何地方都不存储引用，引用也永不进入值或收据。
- 不存在的槽位是 `ENGINE_SLOT_NOT_FOUND`。
- 下标必须求值为整数：一个数字，或 `im` 为 0 的复数。其他任何取值，以及落在 `0..len-1` 之外的下标，都是 `ENGINE_INVALID_INDEX`；后者会给出数组长度。
- 对不是数组的值使用 `[ ]`、对不是对象的值使用 `.`，都是 `ENGINE_UNSUPPORTED_INDEX`。对象没有该字段是 `ENGINE_FIELD_NOT_FOUND`，信息会列出它实际拥有的字段。
- 裸名是绑定变量（§5.4）；其他任何裸名都是 `ENGINE_NAME_NOT_BOUND`，其信息给出改写 `@name`。

### 4.4 数组

- 数组的元素共用一个量纲，嵌套数组也共用它，因此整个结构恰好携带一个向量。
- 运算符逐元素作用。两个数组必须长度相同，否则 `ENGINE_INVALID_ARGS` 会同时给出两个长度；一侧是标量时，会对另一侧的每个元素广播。
- 一元函数逐个作用于元素再收拢，量纲不变。`$len` 则改为统计元素个数，`$transpose` 重排一个矩形二维数组（§5.3）。
- 对象上没有定义任何运算符与函数：先读取字段（§4.3）。拒绝码是 `ENGINE_UNSUPPORTED_OPERATION`，同一个码也拒绝把对象作为数组元素。
- 没有矩阵代数：`$seq` 构造数组，`[i]` 取元素，`$transpose` 转置一个数组的数组。

### 4.5 幂

- 指数必须无量纲，否则 `ENGINE_INCOMPATIBLE_DIMENSION`。
- 实数指数按该指数缩放底数的向量，因此 `(4volt)^2` 的量纲是 `volt^2`（§6.2）。
- 复数指数要求底数无量纲，因为 `a^z` 即 `exp(z*Log a)`：结果无量纲，底数为零是 `ENGINE_UNDEFINED_RESULT`。
- `0^0` 是 1，零的负数次幂是 `ENGINE_UNDEFINED_RESULT`，负实数底数在分数指数下是 `ENGINE_UNDEFINED_RESULT`，因为它没有实数值。
- 任一操作数是复数，或其虚部不为零时，结果是复数；否则是实数。

### 4.6 `eval` 的 target

- `target` 必填，且是裸槽位名。
- 结果的量纲必须是各分量为整数的 SI 量纲向量：分数向量在写入任何东西之前就被拒（§6.4）。
- target 无条件写入：该次写入替换槽位原有的内容并把版本号加一（§2.3）。
- 一次调用产生一行轨迹，因此每个求值步骤都在记录里留下自己的公式与结果（§7.2）。

### 4.7 这门语言没有的东西

没有赋值、没有比较、没有逻辑、没有条件、没有语句序列：没有 `if`、没有 `==`、没有 `&&`、没有 `x = ...`，也无法在一次调用里写两条表达式。`=` 只存在于下标内（`_{k=a}`），在那里它做绑定。没有用户定义函数、没有注释语法，也没有量纲或量纲的字面量。

## 5. 记法

### 5.1 命名空间与位置

- 每个记法名都以 `$` 开头。这个命名空间属于引擎自身：槽位名（`sum`、`abs`、`ohm`）永远不会与记法冲突，也没有任何名字被保留。
- 表外的 `$name` 是 `ENGINE_INVALID_NOTATION`。
- 一个记法可以带下标 `_{...}` 和/或上标 `^{...}`，各自写成紧跟在记法名之后的那个花括号：`$sum_{k=a}^{b}(body)`。下标里放的是该记法的绑定形式 `name = expression` 或 `name -> expression`，或一条普通表达式；位置里的裸名仍是绑定变量。
- 常量不带括号、也不带位置；函数只在括号里接受参数；有界形式把边界放在位置里、把主体放在括号里。
- 参数个数按表校验（§5.2、§5.3、§5.4），个数不对是 `ENGINE_INVALID_ARITY`。

### 5.2 常量（5）

| 记法 | 书写形式 | 含义 |
|---|---|---|
| `$pi` | 裸写 | 圆周与其直径之比 |
| `$e` | 裸写 | 自然对数的底 |
| `$inf` | 裸写 | 正无穷 |
| `$i` | 裸写 | 虚数量纲 |
| `$j` | 裸写 | 虚数量纲，工程写法 |

常量不接受参数、也不接受位置：`$pi()` 与 `$pi_` 都被拒，幂要用 `^` 写（`$e^(2)`、`$pi^2`）。

### 5.3 函数（20 个一元，4 个二元）

| 记法 | 书写形式 | 含义 |
|---|---|---|
| `$abs` | `$abs(x)` | 绝对值（复数的模） |
| `$sqrt` | `$sqrt(x)` | 平方根；复数参数取主复根 |
| `$exp` | `$exp(x)` | `e` 的参数次幂 |
| `$ln` | `$ln(x)` | 自然对数（复数参数取主值） |
| `$log` | `$log(x)` | 以 10 为底的对数 |
| `$sin` | `$sin(x)` | 正弦 |
| `$cos` | `$cos(x)` | 余弦 |
| `$tan` | `$tan(x)` | 正切 |
| `$asin` | `$asin(x)` | 反正弦，弧度 |
| `$acos` | `$acos(x)` | 反余弦，弧度 |
| `$atan` | `$atan(x)` | 反正切，弧度 |
| `$floor` | `$floor(x)` | 不大于参数的最大整数 |
| `$ceil` | `$ceil(x)` | 不小于参数的最小整数 |
| `$sign` | `$sign(x)` | 参数的符号：-1、0 或 1 |
| `$re` | `$re(x)` | 实部 |
| `$im` | `$im(x)` | 虚部 |
| `$arg` | `$arg(x)` | 辐角（相位），弧度 |
| `$conj` | `$conj(x)` | 复共轭 |
| `$len` | `$len(a)` | 数组的元素个数 |
| `$transpose` | `$transpose(M)` | 矩形二维数组的转置 |
| `$atan2` | `$atan2(x, y)` | 点 `(x, y)` 的角，弧度 |
| `$min` | `$min(a, b)` | 两个参数中较小者 |
| `$max` | `$max(a, b)` | 两个参数中较大者 |
| `$mod` | `$mod(a, b)` | `a` 除以 `b` 的余数 |

函数永远用括号书写；给它加下标会被拒，两种误用都会重复本表中的书写形式。

### 5.4 有界形式（6）

| 记法 | 书写形式 | 参数个数 | 可求值 | 含义 |
|---|---|---|---|---|
| `$sum` | `$sum_{k=a}^{b}(body)` | 1 | 是 | 变量从下界走到上界，把主体用 `+` 累加 |
| `$prod` | `$prod_{k=a}^{b}(body)` | 1 | 是 | 在同一区间上把主体用 `*` 累乘 |
| `$seq` | `$seq_{k=a}^{b}(body)` | 1 | 是 | 在同一区间上把主体收集成数组 |
| `$integral` | `$integral_{a}^{b}(body, x)` 或 `$integral(body, x)` | 2 | 否 | 定积分；第二个参数给出变量名 |
| `$limit` | `$limit_{x->a}(body)` | 1 | 否 | 极限，变量由 `->` 绑定 |
| `$diff` | `$diff(body, x)` 或 `$diff(body, x, n)` | 2 或 3 | 否 | 导数，给出 `n` 时为该阶 |

- `$sum`、`$prod`、`$seq` 与带界线的 `$integral` 都要求两个边界；`$limit` 只带下标，`$diff` 两者都不带，`$integral` 两个都带或都不带。
- 边界在主体之前求值一次，且必须是带零向量的整数，否则 `ENGINE_INVALID_INDEX`。区间是闭区间，下界高于上界是 `ENGINE_INVALID_INDEX`。
- 每一步中变量被绑定为一个无量纲实数。绑定是裸名获得取值的唯一途径，且该绑定只在该记法自身的主体里可见。
- `$seq` 产出数组；`$sum` 与 `$prod` 把收集到的值用 `+` 与 `*` 折叠，因此它们的结果遵循这两个运算符的向量算术。
- `$integral`、`$limit` 与 `$diff` 可以写，但不能求值。对其中一个求值是 `ENGINE_UNSUPPORTED_SYMBOL`，其信息会重复它的书写形式。它们存在的意义是让公式仍能陈述自己的意图；实际计算必须改用闭式。

## 6. 量纲

### 6.1 名称表

引擎唯一的量纲词汇表就是这张表。名称映射到 SI 量纲向量，SI 量纲向量反查回它所在的行，引擎里再没有别处可以拼写量纲。

| 向量 | kind | 名称 |
|---|---|---|
| `[0,0,0,0,0,0,0]` | `dim-less` | `dim-less`、`radian`、`steradian` |
| `[0,0,1,0,0,0,0]` | `time` | `second` |
| `[1,0,0,0,0,0,0]` | `length` | `metre` |
| `[0,1,0,0,0,0,0]` | `mass` | `kilogram` |
| `[0,0,0,1,0,0,0]` | `current` | `ampere` |
| `[0,0,0,0,1,0,0]` | `temperature` | `kelvin`、`degC` |
| `[0,0,0,0,0,1,0]` | `amount-of-substance` | `mole` |
| `[0,0,0,0,0,0,1]` | `luminous-intensity` | `candela`、`lumen` |
| `[0,0,-1,0,0,0,0]` | `frequency` | `hertz`、`becquerel` |
| `[1,1,-2,0,0,0,0]` | `force` | `newton` |
| `[-1,1,-2,0,0,0,0]` | `pressure` | `pascal` |
| `[2,1,-2,0,0,0,0]` | `energy` | `joule` |
| `[2,1,-3,0,0,0,0]` | `power` | `watt` |
| `[0,0,1,1,0,0,0]` | `charge` | `coulomb` |
| `[2,1,-3,-1,0,0,0]` | `voltage` | `volt` |
| `[-2,-1,4,2,0,0,0]` | `capacitance` | `farad` |
| `[2,1,-3,-2,0,0,0]` | `resistance` | `ohm` |
| `[-2,-1,3,2,0,0,0]` | `conductance` | `siemens` |
| `[2,1,-2,-2,0,0,0]` | `inductance` | `henry` |
| `[2,1,-2,-1,0,0,0]` | `magnetic-flux` | `weber` |
| `[0,1,-2,-1,0,0,0]` | `flux-density` | `tesla` |
| `[-2,0,0,0,0,0,1]` | `illuminance` | `lux` |
| `[2,0,-2,0,0,0,0]` | `absorbed-dose` | `gray`、`sievert` |
| `[0,0,-1,0,0,1,0]` | `catalytic-activity` | `katal` |

- 各分量的读取顺序是 m, kg, s, A, K, mol, cd。
- 没有对应行的 SI 量纲向量没有 kind：引擎称之为 `unnamed`，并以它的 7 个整数来称呼它。
- 一行的首个名称是引擎在信息里、以及在不带 `dim` 的 `get` 收据里所提到的那个；其余名称是同一向量的可接受拼写。
- 每个名称都带一个仿射映射 `SI = x*factor + offset`。`degC` 是唯一映射不是恒等的名称：它的 factor 为 1、offset 为 273.15。其他每个名称的 factor 为 1、offset 为 0。
- 表中只有 SI 名称。其他任何量纲都由调用方在 `set` 之前换算（§1）。

### 6.2 向量算术

| 运算 | 结果的向量 |
|---|---|
| `a + b`、`a - b` | 两者共有的向量；不同的向量会被拒 |
| `a * b` | 逐分量相加 |
| `a / b` | 逐分量相减 |
| `a ^ p`，实数 `p` | `a` 的每个分量乘以 `p` |

- 标量字面量与每个零 SI 量纲向量的值都是无量纲的。无量纲因子相乘不改变另一侧的向量（`2*@R` 仍是电阻），而把无量纲值加到一个有量纲的值上会被拒，因为裸计数不说明它数的是什么。
- `$min`、`$max`、`$mod` 与 `$atan2` 要求两个参数携带同一个量纲（§6.3）。

### 6.3 各记法类的量纲规则

| 记法 | 参数的量纲 | 结果的量纲 |
|---|---|---|
| `$pi`、`$e`、`$inf`、`$i`、`$j` | 无 | 无量纲 |
| `$abs`、`$re`、`$im`、`$conj` | 任意 | 参数的量纲 |
| `$arg` | 任意 | 无量纲（弧度） |
| `$sqrt` | 任意 | 参数量纲的一半 |
| `$exp`、`$ln`、`$log`、`$sin`、`$cos`、`$tan`、`$asin`、`$acos`、`$atan`、`$floor`、`$ceil`、`$sign` | 无量纲；其他任何取值都是 `ENGINE_INCOMPATIBLE_DIMENSION` | 无量纲 |
| `$len` | 任意量纲，作用于数组 | 无量纲 |
| `$transpose` | 任意量纲，作用于矩形二维数组 | 同一个量纲 |
| `$atan2` | 两者同一个量纲 | 无量纲（弧度） |
| `$min`、`$max`、`$mod` | 两者同一个量纲；不同则是 `ENGINE_INCOMPATIBLE_DIMENSION` | 同一个量纲 |
| `$sum`、`$prod` | 绑定变量是无量纲实数 | 主体的折叠所产出的一切 |
| `$seq` | 绑定变量是无量纲实数 | 主体的量纲，由数组各元素共用 |

除量纲规则之外，某些参数在取值上还有限制：

- `$ln`、`$log`：实数参数必须大于 0；`$ln(0)` 与 `$ln(-1)` 是 `ENGINE_UNDEFINED_RESULT`。
- 负实数的 `$sqrt` 是 `ENGINE_UNDEFINED_RESULT`；复数参数给出主根。
- 实数参数落在 -1 到 1 之外时，`$asin` 与 `$acos` 是 `ENGINE_UNDEFINED_RESULT`。
- `$floor`、`$ceil`、`$sign` 与四个二元函数要求实数参数：复数参数是 `ENGINE_UNDEFINED_RESULT`。
- 除以零与 `$mod` 取零都是 `ENGINE_UNDEFINED_RESULT`。

### 6.4 只接受整数量纲

- 中间结果可以携带分数量的量纲：`$sqrt` 把量纲减半，幂按倍数缩放它。
- 只有写进槽位的值必须具有整向量。分数向量在写入任何东西之前就以 `ENGINE_INCOMPATIBLE_DIMENSION` 被拒，因此产出"电阻的平方根"的公式会被拒，而不是被存下。
- 中间量纲对应不上任何一行完全合法：`(@V)^2/@R` 在通往功率的路上把电压平方，而 `volt^2` 不必是表中存在的某一行。

### 6.5 把 `dim` 读作断言

给 `get` 的 `dim` 是对该槽位内容的断言：7 个整数必须与存下的向量完全相等，量纲名必须是同向量的某一行，之后叶子才被换算成那种书写形式。不匹配会被拒，且不换算任何东西（§3.4）。

## 7. 记录与轨迹

### 7.1 三个标记

| 标记 | 参数 | 作用 |
|---|---|---|
| `record_start` | `title`，非空字符串 | 开启一条记录；已有记录未封闭时以 `ENGINE_OPEN_RECORD_FOUND` 失败，因此一条记录只携带一个标题 |
| `record_message` | `text`，非空字符串；可选的 `hide`，布尔值 | 向未封闭记录追加一段说明 |
| `record_end` | 可选的 `text` | 追加封闭行，把未封闭文件改名进已封闭层（§7.3），并清空槽位表；没有记录未封闭时以 `ENGINE_OPEN_RECORD_NOT_FOUND` 失败 |

- `set`、`get` 与 `eval` 需要记录未封闭，`record_message` 也是；没有未封闭记录时调用以 `ENGINE_OPEN_RECORD_NOT_FOUND` 失败，且任何地方都不写入。
- 记录标识符是毫秒时钟读数的字符串形式。
- 带 `hide: true` 的说明被标记为给文章写作者的注记，而不是给记录视图的（§10）。
- 空白或只有空格的封闭文本视同未给出。
- 每个标记都只回答 `{ ok: true }`，别无其他。

### 7.2 轨迹行

每次调用至多向未封闭记录追加一行，输入与输出都在其中。没有记录未封闭时进行的调用不追加任何东西。

```
{ "seq": 4, "at": 1700000000004, "tool": "eval", "ok": true, "content": { ... } }
```

| 字段 | 含义 |
|---|---|
| `seq` | 该行在记录中的位置，从 1 起 |
| `at` | 该次调用的时钟读数，毫秒 |
| `tool` | `set`、`get`、`eval`、`record_start`、`record_message`、`record_end` 或 `search` |
| `ok` | `true`；被拒的调用为 `false` |
| `content` | 该工具所存的内容 |

`content` 按工具：

- `set`：`{ name, value }`，存下的值，其 `dim` 为 7 个整数；删除是 `{ name, value: null }`。
- `get`：`{ name, value }`，按收据渲染出的值。请求的 `form`、`digits` 与 `dim` 不存。
- `eval`：`{ formula, target, rev, vars, result }`，写下的原文、写入的槽位、它的新版本号、公式读到的每个槽位，以及结果。
- `record_start`：`{ title, record }`。
- `record_message`：`{ text }`，或 `{ text, hide: true }`。
- `record_end`：`{ record }`；给出封闭文本时为 `{ text, record }`。
- `search`：`{ question, tier, outcome, candidates, used, policy, synthesis?, error?, durationMs }`（§12.5）。

- `vars` 恰好保存公式读到的那些槽位，按首次使用的顺序，各带该时刻槽位所持有的值。绑定变量永不进入轨迹。
- 记录保存的是事实，不是格式化后的字符串：`get` 行存的是值，而不是产出那次渲染的选项。
- `search` 行由执行检索的工具写入，模型从不写它：该行是记录对这次取数的交代，而模型只收到答案（§12）。它与 `get` 行一样是事实，因此恢复过程不会把它重算一遍。
- 写不进去的轨迹不会把成功的调用变成失败：追加失败被丢弃。

### 7.3 记录文件

- 每个记录文件的第一行是它的头部，`{"seq": 0, "version": 1}`。`seq: 0` 是把它与轨迹行区分开的唯一标记，`version` 是本构建写入并接受的设计版本。
- **两层。** 唯一未封闭的记录在 `<home>/open-record.jsonl`。封闭时该文件以一步原子操作改名进 `<home>/records/<id>.jsonl`，因此 `records/` 下的文件总是完整的记录。
- **版本闸门。** 首行不是头部、或版本低于当前版本的文件会被所有读者拒绝：启动时未封闭文件被丢弃；已封闭记录不会被列为一行，但它的标识符会被报告在"无法读取的标识符"中。
- 解析不了的行被丢弃，因此追加中途崩溃留下的半行只损失那一行：记录保留所有解析成功的行。

### 7.4 通过重放恢复

启动时引擎先清空槽位表，然后读取未封闭文件。未通过版本闸门、或起始行既无标题也无标识符的文件会被丢弃。否则该记录从它的起始行恢复，序号取最后一行的 `seq`，并按顺序重放它的各行：

- 成功的 `set` 行：写入存下的值；其值为 `null` 时删除该槽位。
- 成功的 `eval` 行：把存下的结果写入它的 target，不重新求值。
- `search` 行、`get` 行与其他任何行：跳过。

- 存下的结果被当作事实使用：不重算、不取数、不重新检索、不含随机。
- 不再能解析的行被跳过，因此恢复过程永远不会妨碍插件挂载。
- 随后轨迹在同一文件中继续，下一行的序号接在最后一行之后。

### 7.5 记录列表

- 列表报告已封闭记录（标识符、版本、标题、开启时间、结束时间）、唯一未封闭记录（标识符、标题、开启时间），以及无法读取的标识符。
- 记录的标题与时间跨度来自它的各行：首个被接受的 `record_start` 行的标题、最后一个被接受的 `record_end` 行的时间作为结束时间，没有结束行时取最后一行的时间。
- 已封闭列表带缓存，在 `records/` 目录的修改时间变化时重建，因此并非每次读取都做一次扫描。

## 8. 错误

### 8.1 失败的形状

每个失败都是一份收据 `{ ok: false, code, error }`，且什么都不写：

- **`error` 是写给读者的一句话。** 当失败与文本有关时，它会带上文本中的位置；它总是带上失败的具体取值、边界或期望，以及修正方式。
- **`code` 是给机器看的。** 轨迹、测试与面板都以它匹配。（§8.2）
- **失败的调用没有副作用。** 不创建槽位、不改值、不动版本号。（§7.2）
- 意外的内部故障以 `ENGINE_UNKNOWN_ERROR` 报告，消息为 `internal error: ...`，因此没有任何失败会逃出收据。

### 8.2 错误码

| 错误码 | 触发条件 |
|---|---|
| `ENGINE_INVALID_FORMULA` | 文本不是文法接受的一条表达式 |
| `ENGINE_INVALID_NUMBER` | 数字的科学计数形式没有指数数字，如 `2e` |
| `ENGINE_INVALID_IDENTIFIER` | 字母直接跟在数字之后，如 `1E5`；或需要标识符的位置给的名称不是字符串、或违反名字规则 |
| `ENGINE_INVALID_DIMENSION` | `dim` 不是表名、不是恰好 7 个整数，或不是由整数构成 |
| `ENGINE_INVALID_NOTATION` | `$name` 不在记法表内，或记法写成它不接受的形式 |
| `ENGINE_INVALID_ARITY` | 参数个数不在表中列出，或缺少、错放了边界或下标 |
| `ENGINE_SLOT_NOT_FOUND` | `@name` 读取不存在的槽位，或 `get` 指定了不存在的槽位 |
| `ENGINE_NAME_NOT_BOUND` | 裸名没有被任何外层记法绑定 |
| `ENGINE_INCOMPATIBLE_DIMENSION` | 两个向量必须相同，或某参数必须无量纲，而它们不满足 |
| `ENGINE_UNSUPPORTED_OPERATION` | 运算符或函数作用于对象，或把对象放进数组 |
| `ENGINE_INVALID_INDEX` | 下标或边界不是带零向量的整数、下标超出数组范围，或下界高于上界 |
| `ENGINE_UNDEFINED_RESULT` | 引擎没有为其定义取值的运算 |
| `ENGINE_UNSUPPORTED_INDEX` | 对不是对象的值使用 `.`，或对不是数组的值使用 `[ ]` |
| `ENGINE_FIELD_NOT_FOUND` | 对象没有该名称的字段；信息会列出它实际拥有的字段 |
| `ENGINE_UNSUPPORTED_SYMBOL` | 对 `$integral`、`$limit` 或 `$diff` 求值 |
| `ENGINE_INVALID_ARGS` | 工具参数形状不对 |
| `ENGINE_OPEN_RECORD_NOT_FOUND` | 没有记录未封闭时调用 `set`、`get`、`eval`、`record_message` 或 `record_end` |
| `ENGINE_OPEN_RECORD_FOUND` | 已有记录未封闭时调用 `record_start` |
| `ENGINE_UNKNOWN_ERROR` | 意外的内部故障，报告为 `internal error: ...` |
## 9. 存储与日志

### 9.1 主目录

插件主目录是 `~/.dsh-reckoner`，`DSH_RECKONER_HOME` 可将其改到别处。

```
~/.dsh-reckoner/
  open-record.jsonl       唯一未封闭的记录：它的头部行与轨迹行
  records/<id>.jsonl      已封闭记录，一条一个文件，以记录标识符命名
  state.json              插件记忆的设置
  logs/                   每次宿主运行一个文件
```

| 文件 | 存放 |
|---|---|
| `open-record.jsonl` | 未封闭的记录，在 `record_start` 时从它的头部重写，在 `record_end` 时被改名 |
| `records/<id>.jsonl` | 一条已封闭记录：头部行与每次调用一行轨迹 |
| `state.json` | 记忆的设置，即下面这棵树：每个会记忆设置的模块一个子树，外加扁平的 `restartRequired` 标记。它以原子方式整体替换；缺失、损坏或不是对象的文件读作 `{}` |
| `logs/` | 下面说的运行日志 |
### 9.2 日志

- 每次插件挂载一个文件，即每次宿主运行一个：`<home>/logs/<YYYY-MM-DD_HH-mm-ss.SSS>.log`，以独占方式创建并保持打开。写入是在该描述符上的同步写。
- 一行是 `<时间戳> <LEVEL> <消息>[ k=v ...]`，同时写入文件与 stdout。字段值是 JSON 标量；嵌套的对象或数组是单个 token；Error 渲染为它的消息，并把栈作为 `  | ` 续行。
- 级别来自 `DSH_RECKONER_LOG_LEVEL`：`debug`、`info`、`warn`、`error` 或 `off`；其他任何取值都保持默认的 `info`。
- 保留策略保留最新 20 个运行文件，总计最多 50 MB。
- 日志承载插件自身的诊断（挂载与卸载、端点失败、生成任务），而记录只承载引擎调用。

## 10. 文章生成

已封闭的记录可以写成一篇独立的解题文章。宿主把记录的各行归约为纯事实，交给一个模型在独立的上下文里，并把文章写到磁盘。仍未封闭的记录不能被生成。

| 事实 | 记录中的来源 |
|---|---|
| 标题 | 首个被接受的 `record_start` 行的 `title` |
| 条件 | 被接受的 `set` 行，按槽位名累加；删除会移除该名字 |
| 说明 | 被接受的 `record_message` 行，各带它的 `seq` 与 `hide` 标记 |
| 步骤 | 带公式的被接受 `eval` 行：`seq`、`formula`、它读到的槽位与它的结果 |
| 检索 | 答出了答案的 `search` 行：`seq`、问题、答案与它所依据的出处 |
| 结束语 | 最后一个被接受的 `record_end` 行的 `text` |

- 被拒的行与 `get` 行没有可写的内容，因此被跳过。

- 带 `hide: true` 的说明成为作者注：不得照抄、不得引用、也不得让它改变任何已记录数字的指引。不带 `hide` 的说明成为记录自身的说明文字。
- 每个数字在到达模型之前都被截断：最多四位小数，低于 `1e-3` 或至少 `1e6` 时用指数形式。名为 `dim` 的字段保留它的 7 个整数。记录保留存下的数字。
- 一次检索作为它自己的条目交出：问题、按记录原样的答案，以及每个出处一行。答案保持原样，因此截断不作用于它（§12.7）。
- 开放层级的答案被标记为在开放网络上查到、未经核实；写作者必须按引用原样保留它的数字与量纲，并注明出处。
- **格式。** Markdown（`.md`）与 LaTeX（`.tex`）。模型只写 LaTeX 正文；宿主拒绝重构文档的命令、不配对的括号或奇数个 `$`，并把其余部分包进 XeLaTeX 外壳：zh-CN 用 `ctexart`，en 用 `article` 加 `fontspec`。
- **语言。** `auto`、`zh-CN` 或 `en`，在生成之前解析：auto 任务会探测记录自身的散文是否含 CJK 表意文字。
- **任务阶段。** prepare、generate、write、compile。LaTeX 文章写进以文件名命名的目录；Markdown 文章平铺写出。
- PDF 编译仅限 LaTeX 且可选：由驱动完成，优先 `latexmk`，回退 `texify`，由它调用 `xelatex`。编译失败会被报告，但不会丢弃文章。
- 文件名被强制为对应格式的扩展名，默认是 `reckoner-<记录标识符的前 8 个字符>`。
- prompt 禁止提及 Reckoner、harness、公式、推导步骤、记录或生成过程，也禁止臆造或重算任何数字。
- **记忆的设置。** 每种格式各自记住自己的输出 `directory`、`language`，以及——仅 LaTeX——是否 `compile`（§9.1）。
- 设置端点提供该视图：`GET /api/dsh-reckoner/settings`，`PUT` 接受 `{generation: {format, directory?, language?, compile?}}`（§11.3）。




## 11. 宿主端点

| 端点 | 用途 |
|---|---|
| `GET /api/dsh-reckoner/records-index` | 已封闭记录、未封闭记录，以及无法读取的标识符 |
| `GET /api/dsh-reckoner/records/<id>` | 一条记录的身份与轨迹行；未封闭记录也在内，其 `endedAt: null` |
| `DELETE /api/dsh-reckoner/records/<id>` | 删除一条已封闭记录的文件；它是未封闭记录时以 409 拒绝，不存在时 404 |
| `POST /api/dsh-reckoner/generate` | 启动一次文章任务（`recordId`、`format`、`directory`、`fileName`、`language`、`compile`） |
| `GET /api/dsh-reckoner/generate-progress` | 轮询某个任务的状态、百分比、阶段、路径与错误 |
| `POST /api/dsh-reckoner/generate-cancel` | 取消正在运行的任务 |
| `GET /api/dsh-reckoner/generate-capability` | 设置对话框背后的 LaTeX 工具链与文档外壳探测 |
| `GET /api/dsh-reckoner/list-roots`、`GET /api/dsh-reckoner/list-dirs` | 输出目录浏览器 |
| `GET /api/dsh-reckoner/directory-tree.css` | 面板注入的内置样式表 |
| `GET` / `PUT /api/dsh-reckoner/settings` | 整个设置视图；`PUT` 只写它正文中列出的段落并回答 `{saved, settings}`，正文不可用时 `400 {error}`，其他方法 `405` |
| `POST /api/dsh-reckoner/reveal` | 在宿主文件管理器中打开生成的文件或其目录 |

## 12. 外部检索

### 12.1 基础

纯粹的 `reckoner` 预设什么也够不到：它只有六个工具，没有 shell、没有文件系统、没有网络。外部事实一次一个，经 `reckoner-with-search` 预设进来，该预设只多带一行，别无其他。那一行 `dsh-reckoner/search` 为会话注册 `search` 工具，并把每次调用经 `reckonerSearch` 服务转交给插件的宿主半边；这一行自身不注册别的，因此没有它的会话根本没有 `search` 工具。通用的 `web_search` 与 `web_fetch` 两个预设都不挂载，模型永远无法自行检索或抓取。引擎在取数中不扮演任何角色：它校验事实并追加该行，与对 `set` 所做的一模一样。

### 12.2 配置

| 键 | 代码默认值 | 含义 |
|---|---|---|
| `tier` | `strict` | `strict` 只保留允许列表上的主机；`open` 保留每一个出处 |
| `allowedHosts` | 12 个参考资料主机 | 严格检索接受的主机后缀，按模式本身或子域匹配，仅字母后缀相同不算 |
| `maxResults` | `12` | 一次提供方调用返回的出处数量上限 |
| `maxSearchesPerRecord` | `4` | 一条记录最多可以带几次检索 |
| `answerMaxChars` | `1200` | 交给模型的答案长度上限 |
| `enrich.pages` | `0` | 抓取多少个被允许页面以取正文；`0` 只用引用摘要片段 |
| `enrich.charsPerPage` | `4000` | 每个被抓取页面的多少正文进入抽取步骤 |
| `synthesis.provider`、`synthesis.model` | 未设置 | 抽取步骤所跑的路由；未设置表示部署默认模型 |
| `synthesis.maxTokens` | `800` | 抽取调用的 token 上限 |

显式给空 `allowedHosts` 是一个决定：此时严格检索什么也答不出。被截断的只有模型收到的答案与合成中留存的那一份。

默认允许列表是计算可以引用的参考资料：`wikipedia.org`、`github.com`、`githubusercontent.com`、`stackoverflow.com`、`stackexchange.com`、`developer.mozilla.org`、`docs.python.org`、`nist.gov`、`iso.org`、`ietf.org`、`rfc-editor.org` 与 `arxiv.org`。

### 12.3 失败码
| 错误码 | 触发条件 |
|---|---|
| `SEARCH_INSUFFICIENT` | 策略允许的出处都没有该事实，或抽取步骤回答 `insufficient` |
| `SEARCH_BUDGET_EXCEEDED` | 该记录已用完它的 `maxSearchesPerRecord` 次检索。该调用不会到达提供方 |
| `SEARCH_UNAVAILABLE` | 提供方、网络、抽取模型或所需服务失败，或没有配置默认模型 |
| `ENGINE_OPEN_RECORD_NOT_FOUND` | 没有记录未封闭。检索要被记录下来，因此它需要一条未封闭记录 |
