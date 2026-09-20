# Reckoner 引擎手册

[English](engine.md)

Reckoner 插件的全部电气电子计算都在一台确定性的**引擎**内完成。语言模型从不亲自计算：它通过四个原语与三个记录标记操作引擎，引擎维护一张类型化值变量表，在计算边界换算单位，并把每一步记录进一条可回读的记录。

以 **Reckoner 模式**启动的会话，会通过 `reckoner-interface` 与 `reckoner-template` 两个技能携带同样的规则。

## 目录

- [1. 概览](#1-概览)
- [2. 类型化值](#2-类型化值)
- [3. 原语](#3-原语)
- [4. 记录与标记](#4-记录与标记)
- [5. 求解器目录](#5-求解器目录)
- [6. 外部求解器](#6-外部求解器)
- [7. 存储](#7-存储)
- [8. 日志](#8-日志)
- [9. 宿主端点](#9-宿主端点)

## 1. 概览

每个宿主进程运行一台引擎。任何会话的标记都作用于它，且任何时刻至多有一条记录未封口。

一次求解是若干引擎操作组成、被标记括起来的循环：

| 步骤 | 工具 | 作用 |
|---|---|---|
| 1 | `record_question` | 开启记录并清空变量表 |
| 2 | `set` | 把每个给定条件存为类型化值 |
| 3 | `record_analyse` | 在计算之前陈述已知量与思路 |
| 4 | `solver_info` | 读取即将调用的求解器的签名 |
| 5 | `call` | 运行求解器并把结果存入目标槽 |
| 6 | `get` | 读回一个值 |
| 7 | `record_answer` | 提交答案并封口该记录 |

每一步都会向记录追加一行自描述的行，输入与输出都在其中。宿主重启时，会按这些行重建仍未封口那条记录的变量表，直接使用存储的结果，而不重新计算。

引擎存的就是它收到的内容。字符串永远是字符串，任何算术都不在求解器之外发生。

## 2. 类型化值

类型化值是一个 JSON 对象。`kind` 属于量，量的写法也一样：

```json
{ "type": "number",  "value": 100,  "kind": "resistance" }
{ "type": "number",  "value": 25,   "kind": "temperature", "variant": "degC" }
{ "type": "number",  "value": 1500, "kind": "resistance",  "prefix": "kilo" }
{ "type": "complex", "value": { "re": 100, "im": 0 }, "kind": "voltage" }
{ "type": "complex", "value": { "mag": 220, "ang": 0.5236 }, "kind": "voltage" }
{ "type": "string",  "value": "lowpass" }
{ "type": "boolean", "value": true }
```

### 2.1 字段

| 字段 | 含义 |
|---|---|
| `type` | 形状：`number`、`complex`、`string`、`boolean`、`array`、`object` |
| `value` | 载荷；数组元素与对象字段又是类型化值 |
| `kind` | 量纲类别：resistance、voltage、time、frequency、temperature、angle、pressure、energy、length、mass、log、none…… |
| `variant` | 该 kind 的量在非 SI 基准单位下的写法 |
| `prefix` | `number` 与 `complex` 上的量级乘数 |

`{ "type": "slot", "value": "name" }` 不是值而是引用，在调用边界解析，见 §3.3。

### 2.2 kind、variant 与 prefix

| kind | variant 词 | 基准单位 |
|---|---|---|
| temperature | degC, degF | K |
| angle | deg | rad |
| pressure | bar, psi, atm | Pa |
| energy | cal, Wh | J |
| power | hp | W |
| length | inch, foot, yard, mile | m |
| mass | lb, oz | kg |

prefix 词为 `pico` `nano` `micro` `milli` `kilo` `mega` `giga` `tera`。prefix 只对 SI 基准表示有效，绝不与 variant 词同时出现。

`variant` 或 `prefix` 字段缺失，即表示 SI 基准单位与乘数 1；引擎自己从不补写这些键。所有词都是短 ASCII 文本——`Ω`、`°`、`µ` 这类符号从不进入值宇宙。

### 2.3 换算边界

变量表按原样存储值，因此 `get` 返回的正是 `set` 写入的内容。换算发生在值进入计算时：在调用边界，引擎把 variant 换算为 SI、把复数载荷归一化为 `{ "re": …, "im": … }` 且角度恒为弧度，并应用 prefix。这个边界深入参数内部，因此嵌在数组或对象里的量与顶层的量一样被换算。

变量表本身不受影响，轨迹同时记录传入的内容与求解器实际收到的内容。

## 3. 原语

| 原语 | 参数 | 作用 |
|---|---|---|
| `set` | `name`、`value` | 写入一个槽；`value: null` 删除该槽 |
| `get` | `name` | 读回一个槽，与写入时完全一致 |
| `call` | `solver`、`args`、`target` | 运行一个已注册求解器并存下结果 |
| `solver_info` | `solver` | 在调用前返回求解器的签名 |

参数是类型化值。`"100 kΩ"` 只能是字符串；100 kΩ 的电阻写作 `{ "type": "number", "value": 100, "kind": "resistance", "prefix": "kilo" }`。

### 3.1 收据

每次调用都返回一张收据，不存在第二条失败通道：

```
success: set  → { ok: true, name, rev }        delete: { ok: true, name, deleted }
         get  → { ok: true, name, value }
         call → { ok: true, target, rev }        void solver: { ok: true, target: null }
failure:      → { ok: false, code, error }
```

先看 `ok`。只有 `get` 携带取值；一次求解中的其他数字都来自 `set` 或 `call` 写入、再用 `get` 读回的槽。

### 3.2 槽的规则

| 规则 | 行为 |
|---|---|
| target | 有返回值的求解器必须有具名 target；声明为 `returns: null` 的 void 求解器接受 `target: null` |
| 覆盖 | 写入已存在的槽会整体替换其值并推进 `rev`；不继承旧值的任何部分 |
| 删除 | 以 `value: null` 执行 `set` 即删除该槽；删除不存在的槽是幂等的 ok，之后重建从 rev 1 开始 |
| kind 钉死 | 槽保留首次写入的 kind；换成别的 kind 会失败，且不推进版本号 |
| 失败 | 失败的操作没有副作用：不建槽、变量表不变、版本号不动 |

失败仍会落入轨迹。

### 3.3 槽引用

槽引用形如 `{ "type": "slot", "value": "name" }`，其中 `value` 是完整路径：`"name"` 或 `"name.field"`。引擎会展开引用、按求解器签名校验，槽不存在时以 `ENGINE_SLOT_UNDECLARED` 失败。引用可以出现在参数的顶层，也可以嵌在数组元素与对象字段里。

`set` 存入的是被引用值的副本，因此之后改动源槽不会影响副本。引用永不进入变量表，也永不作为结果返回。裸字符串永远是字面量字符串。

### 3.4 失败码

| 码 | 触发条件 |
|---|---|
| `ENGINE_ARGS` | 参数不符合求解器签名，或缺少必填参数 |
| `ENGINE_SLOT_UNDECLARED` | 引用的槽不存在 |
| `ENGINE_KIND_MISMATCH` | 参数 kind 与形参冲突，或与槽已钉死的 kind 冲突 |
| `ENGINE_UNKNOWN_SOLVER` | 该求解器 id 未注册 |
| `ENGINE_VOID_TARGET` | 给 void 求解器传了具名 target |
| `ENGINE_TARGET_REQUIRED` | 调用有返回值的求解器时未给具名 target |
| `ENGINE_UNSUPPORTED_VARIANT` | variant 词不适用于该 kind |
| `ENGINE_UNSUPPORTED_PREFIX` | prefix 词未知，或与 variant 同时出现 |
| `ENGINE_SOLVER_FAILED` | 求解器自身在运行中失败 |
| `EXTERNAL_ERROR` | 外部端点在信封里自报失败 |
| `EXTERNAL_HTTP` | 外部端点返回非 2xx 状态 |
| `EXTERNAL_TIMEOUT` | 外部调用超过其声明的超时 |
| `EXTERNAL_RESPONSE` | 外部响应违反信封契约 |
| `TOOL_ERROR` | 其他工具失败 |

注册期的 `REGISTER_MISSING_RETURNS` 与 `REGISTER_DUPLICATE` 属于宿主插件，而不属于一次求解。

## 4. 记录与标记

| 标记 | 作用 |
|---|---|
| `record_question` | 开启一条记录并清空变量表 |
| `record_analyse` | 在计算之前提交分析：已知量与带公式的思路 |
| `record_answer` | 提交最终答案并封口该记录 |

至多一条记录未封口。第二次 `record_question` 会把当前未封口的记录封为一条未完成记录并开启新记录；没有未封口记录时的 `record_answer` 会保留一条简短错误记录。中断的记录会在下次引擎启动时续写：轨迹在同一文件中继续，变量表据其重建。从未被封口的记录在面板中始终标记为未完成。

封口使记录永久定型：轨迹到此结束，之后绝不重算。§7 说明一条记录在磁盘上存了什么。

## 5. 求解器目录

每个求解器都接收类型化值并返回一个类型化值，见 §2。传递函数的系数是按降幂排列的 kind-`none` 量数组。目录与数学内核一一对应，`solver_info` 给出任意条目的精确签名。

### 表达式与代数

| solver | 用途 |
|---|---|
| `calculate` | 求值字符串数学表达式，返回复数结果 |
| `rational_coefficients` | 把单变量表达式化简为有理函数，返回分子/分母系数 |

### 数列求和

| solver | 用途 |
|---|---|
| `series_sum` | 数列求和：等差、等比或幂和 |

### 传递函数与频域

| solver | 用途 |
|---|---|
| `partial_fraction` | 比值形式传递函数的部分分式展开 |
| `poles_zeros` | 比值形式传递函数的零极点 |
| `transfer_function_response` | 在频率点上求值传递函数（H(jω) 或 H(e^(jωT))） |
| `step_response` | 连续传递函数在时间点上的阶跃响应 |
| `difference_equation_response` | 差分方程递推输出 y[n]（Laurent a/b 约定） |
| `bode_response` | 在对数频率网格上绘制比值形式传递函数的 Bode 图 |
| `power_series_expansion` | z 域传递函数关于 z⁻¹ 的幂级数展开（冲激响应） |

### 数字信号处理

| solver | 用途 |
|---|---|
| `discrete_fourier_transform` | 复采样序列的 DFT（可选加窗） |
| `inverse_discrete_fourier_transform` | 频谱的 IDFT：恢复时域序列 |
| `fourier_series_coefficients` | 标准奇对称波形的傅里叶级数系数（a₀、aₙ、bₙ） |
| `signal_analysis` | 一次调用给出信号统计与加窗频谱（RMS、峰值、峰峰值、DC） |

### 信号质量

| solver | 用途 |
|---|---|
| `thd` | 采样信号的总谐波失真（分数与 dB） |
| `jitter_snr` | 采样时钟抖动设定的 SNR 上限 |
| `adc_budget` | ADC 噪声预算：量化、抖动与可选的热噪声 SNR 汇总为总 SNR 与 ENOB |

### 电路

| solver | 用途 |
|---|---|
| `equivalent_impedance` | 一组阻抗串联（Z = Σ Zi）或并联（1/Z = Σ 1/Zi）后的总阻抗 |
| `circuit_impedance` | 某频率下串/并联网络的驱动点总阻抗；network 是 JSON 文本，见下文说明 |
| `resonance` | 串联/并联 LC 谐振：resonantFrequency、qualityFactor 与 bandwidth |
| `ac_power` | 由 RMS 值求交流功率：视在 = V·I、有功 = 视在·cosφ、无功 = 视在·sinφ、功率因数 = cosφ |
| `transient_response` | 一阶/二阶充放电瞬态在时间点列表上的取值；每个时间点返回电压与电流 |

### 电子学

| solver | 用途 |
|---|---|
| `opamp_configurations` | 各配置的理想运放增益与输出：反相、同相、电压跟随器、差分、积分器、微分器 |
| `time_constant` | 由 R 与 C，或由 L 与 R 得到时间常数与截止频率 |
| `voltage_divider` | 电阻分压器，带载或不带载，外加戴维南输出电阻 |
| `led_resistor` | LED 串联电阻：R = (Vs − Vf)/I 及其耗散功率 P = I²·R |

### 射频与史密斯圆图

| solver | 用途 |
|---|---|
| `impedance_to_reflection` | 反射系数 Γ = (Z − Z0)/(Z + Z0) |
| `reflection_to_vswr` | 由反射系数求 VSWR：vswr = (1+|Γ|)/(1−|Γ|) |
| `return_loss` | 以 dB 计的回波损耗：−20·log10(|Γ|) |
| `quarter_wave_transformer` | 四分之一波长变换器的特性阻抗：Z1 = √(Z0·ZL) |
| `matched_network` | 两个实数电阻之间的匹配网络（拓扑 l/pi/t）；以有序元件返回低通/高通共轭解 |

### 传输线

| solver | 用途 |
|---|---|
| `wavelength_frequency` | 由频率求波长（感知速度因子） |
| `coaxial_parameters` | 由几何尺寸求同轴线特性（阻抗、速度因子、每米 C 与 L） |
| `rise_time_bandwidth` | 上升时间与带宽互转（tr ≈ 0.35/BW） |

### 噪声

| solver | 用途 |
|---|---|
| `thermal_noise` | 带宽内的热（约翰逊）噪声功率：P = k·T·B（温度以开尔文计） |
| `cascade_noise_figure` | 由每级噪声系数与增益（dB）求级联总噪声系数（Friis） |
| `quantization_noise` | 均匀量化器的理想 SNR（dB）：SNR = 6.02·N + 1.76 |

### 滤波器

| solver | 用途 |
|---|---|
| `filter_design` | 巴特沃斯低通梯形设计：阶数、截止频率与相等的源/负载电阻给出串联电感与并联电容的元件表，并给出截止频率与查询频率处的衰减 |

### 读签名

`solver_info` 返回形参、它们的 kind 与枚举、可选标记以及 `returns` 形状。量叶子声明该位置允许的值集：

| 叶子 | 接受 |
|---|---|
| `complex(kind)` | 该 kind 的实数或复数 |
| `number(kind)` | 仅实数；复数在参数处被拒绝 |

加宽是隐式的，收窄从不隐式：实数一路以实数传递，直到某个需要复数的求解器把它转过去。`returns: null` 表示 void 求解器，它接受 `target: null`，见 §3.2。

### 求解器说明

| 求解器 | 说明 |
|---|---|
| `reflection_to_vswr`、`return_loss` | 无界的两个极端是错误：值宇宙中没有无穷 |
| `circuit_impedance.network` | JSON 文本：叶子为 `{ "kind": "resistance" \| "inductance" \| "capacitance", "value": <number> }`，组为 `{ "topology": "series" \| "parallel", "elements": [ … ] }`，组可嵌套 |
| `resonance` | `resistance` 为必填；结果恒携带 qualityFactor 与 bandwidth |
| `filter_design` | `queryFrequency` 为必填——只想要设计结果时传截止频率；元件幅度是 kind-`none` 值，其单位写在元件 kind 里 |
| `opamp_configurations` | 覆盖六种单输入配置，因此求和放大器没有单一增益可返回 |
| `transient_response` | 在 rc、rl、rlc 上返回同一种点形状；rlc 阻尼特征不在其中 |
| `voltage_divider` | 返回固定四字段对象；不带载时 `unloadedOutputVoltage` 等于 `outputVoltage`，`loadCurrent` 为 0 |
| `series_sum` | 在所有分支上返回同一种形状；发散的无穷级数输入是错误 |
| `time_constant` | 给 `capacitance` 得 τ = RC，给 `inductance` 得 τ = L/R |
| 带单位字段 | 开尔文温度、波长、同轴直径与频率列表是 kind-`none` 值，其数字为 SI 基准 |

## 6. 外部求解器

除内置目录外，你还可以注册自己的求解器，经 http 访问。声明存放在 `~/.dsh-reckoner/external-solvers.jsonl`，每行一个 JSON 对象；引擎启动时，每条启用且 `returns` 可映射的声明都会编译进与内置求解器同一个注册表。此后二者没有区别：`solver_info` 与 `call` 一视同仁，参数按同样方式解析，返回值在进入变量表之前先按声明的 `returns` 校验。

| 字段 | 含义 |
|---|---|
| `name` | 求解器 id：小写开头，仅 `a-z0-9_` |
| `description` | 该求解器算什么；`solver_info` 报告的就是它 |
| `enabled` | 是否在启动时注册；缺省视为启用 |
| `parameters` | 形参规格，使用与 §5 相同的叶子词表 |
| `returns` | 结果形状，或 `null` 表示 void 求解器 |
| `transport` | `http` |
| `transportOptions` | `url`，以及可选的 `headers` |
| `timeoutMs` | 调用超时，默认 30 秒 |

### 声明求解器

声明通过面板的 **「外部求解器」页**、智能体的 `external_solver_add`、`external_solver_update` 与 `external_solver_delete`，或直接编辑归档文件来写入。求解器要等宿主重启后才存在，在此之前面板会显示待重启提示。`returns` 无法映射的声明会被存档，但在启动时跳过，并在日志中给出告警。

### 信封

每次调用发送一次 POST，读回一个 JSON 体：

| 方向 | 内容 |
|---|---|
| 请求 | `{ "requestId": "…", "args": { "…": … } }` |
| 结果 | `{ "requestId": "…", "result": … }`，void 求解器为 `null` |
| 失败 | `{ "requestId": "…", "error": "…" }` |

参数与结果都是类型化值，因此线上不出现符号、variant 或 prefix 词；到达对端的是 SI 与直角形式。`requestId` 不匹配、或两个字段都没有的响应会被拒绝。失败码见 §3.4；信封尚未产生就失败的调用——对端没跑、主机名解析不了——以 `ENGINE_SOLVER_FAILED` 收场并带上原因，例如 `fetch failed: connect ECONNREFUSED 127.0.0.1:8787`。对端必须监听运行时可拨的端口：知名端口会被直接拒拨并读作 `bad port`。

[`external-solvers-example/`](../external-solvers-example/README.zh-CN.md) 是一个可直接运行的对端与逐字段注册指南。

## 7. 存储

插件主目录是 `~/.dsh-reckoner`，`DSH_RECKONER_HOME` 可将其改到别处。

```
~/.dsh-reckoner/
  record-index.jsonl      索引行，每条记录一行
  records/<id>.jsonl      轨迹本体，每条记录一个文件
  external-solvers.jsonl  声明，每行一条
  state.json              插件状态
  logs/                   每次宿主运行一个文件
```

| 文件 | 存放 |
|---|---|
| `record-index.jsonl` | 每条记录的 `{ id, openedAt, sealedAt, question }`；`sealedAt: null` 标记仍未封口的那条 |
| `records/<id>.jsonl` | 每次引擎操作一行轨迹 |
| `external-solvers.jsonl` | §6 的声明 |
| `state.json` | 生成设置与待重启标记 |
| `logs/` | §8 的运行日志 |

### 轨迹本体

每一行都携带恢复该步所需的全部信息，输入与输出都在：

```json
{ "seq": 1, "tool": "marker", "kind": "question", "ok": true, "text": "…", "at": … }
{ "seq": 2, "tool": "set", "ok": true, "name": "R", "value": { …typed value as given… }, "rev": 1, "at": … }
{ "seq": 3, "tool": "call", "ok": true, "solver": "resonance",
  "args": { …original… }, "resolved": { …expanded + SI/rect end values… },
  "result": { …typed output… }, "target": "res", "rev": 1, "at": … }
{ "seq": 4, "tool": "call", "ok": false, "code": "ENGINE_SLOT_UNDECLARED", "error": "…", "at": … }
{ "seq": 5, "tool": "set", "ok": true, "name": "tmp", "value": null, "deleted": true, "at": … }
{ "seq": 6, "tool": "marker", "kind": "answer", "ok": true, "text": "…", "at": … }
```

| 字段 | 含义 |
|---|---|
| `args` | 传入时的参数，含引用 |
| `resolved` | 求解器实际收到的参数：引用已展开、换算已完成 |
| `result` | 求解器返回的值，作为事实存储 |
| `code`、`error` | 仅失败行携带 |

轨迹只记录引擎操作：没有内核内部步骤，也没有模型的推理文本。它的读者是人，每一步都就地呈现原始输入、换算后的值与结果。

### 恢复

宿主启动时若仍有未封口的记录，会按序重放该记录的各行来重建变量表：`set` 行写入其值，`call` 行把存储的结果写入目标槽，被删除的槽移除，标记行跳过。存储的结果被当作事实使用，因此不重算、不发网络、无随机。已封口的记录是历史而非状态，它的每一行都仍可独立阅读。

### 一致性

| 情形 | 行为 |
|---|---|
| 索引行存在但本体文件缺失 | 引擎启动时清除 |
| 未封口的记录 | 就是 `sealedAt: null` 且本体存在的那条索引行；重启从这一对恢复 |
| `state.json` | 由唯一持有者做读—改—写并原子替换，写入中途崩溃只会留下上一版；不可读时读成 `{}` |
| 声明变更 | 写入归档并在 `state.json` 打标记，下次启动生效 |

## 8. 日志

每次宿主运行一个文件：`<logs>/<YYYY-MM-DD_HH-mm-ss.SSS>.log`，独占创建并保持打开。每行形如 `<timestamp> <LEVEL> <message>[ k=v …]`，同时写入文件与 stdout。字段值是 JSON 标量；嵌套对象或数组算一个 token，Error 渲染为消息并追加带 `  | ` 前缀的堆栈续行。

| 设置 | 取值 |
|---|---|
| `DSH_RECKONER_LOG_LEVEL` | `debug`、`info`、`warn`、`error`、`off`；默认 `info` |
| 保留 | 最新 20 个文件、总量不超过 50 MB |

这个文件描述自己所属的那次 run：文件名是开始，末行是结束，末行不是 `plugin unmounted` 的日志属于被杀掉的 run。端点、请求 id、耗时这类传输事实只记入日志，不写入记录。

## 9. 宿主端点

| 端点 | 用途 |
|---|---|
| `GET /api/dsh-reckoner/records-index` | 面板列表的索引行，每 5 秒轮询一次；从不读取轨迹本体 |
| `GET /api/dsh-reckoner/records/<id>` | 一条记录的轨迹行 |
| `/api/dsh-reckoner/external-solvers` | 声明归档：`GET` 列出声明与重启标记，`PUT` 添加或替换一条，`DELETE ?name=` 删除一条 |
| `GET /api/dsh-reckoner/generate-capability` | 生成对话框背后的 LaTeX 工具链检查 |
| `/api/dsh-reckoner/generate`、`-progress`、`-cancel` | 文章生成任务：启动、轮询、取消 |
| `/api/dsh-reckoner/list-roots`、`list-dirs`、`generate-dir` | 生成对话框的目录浏览与记忆目录 |
| `/api/dsh-reckoner/reveal` | 在宿主的文件管理器中打开生成的文件或其目录 |

