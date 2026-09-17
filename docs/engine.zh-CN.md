# ElectroLab 引擎手册

[English](engine.md)

DeepSeek Harness ElectroLab 插件把全部电气电子计算放在一台确定性的**引擎**内完成。语言模型从不亲自计算：它通过三个原语与三个记录标记操作引擎，引擎维护一张类型化值变量表，在计算边界换算数值，记录每一步，并把每次求解封口成一条可浏览的记录。

本手册是引擎使用面的完整参考——类型化值、原语、标记、求解器目录与存储。以 **ElectroLab 模式**启动的会话，会经由 `electro-lab-interface` 技能（引擎手册）与 `electro-lab-template` 技能（记录协议）携带同样的规则。

## 1. 工作原理

- **每个宿主进程一台全局引擎。** 任何会话的标记都作用于同一台引擎；任何时刻至多有一条未封口记录（单一 open 不变量）。
- **LLM 使用面只有七个工具**：`set`、`get`、`call`、`solver_info`、`record_question`、`record_analyse`、`record_answer`。约 40 个领域工具、`solve_steps` 与文本↔值编解码工具已退役；数学内核住在引擎的 solver 注册表中，由 `call` 调用。`solver_info` 直接从注册表暴露某个 solver 的精确签名（参数名、数量 kind、允许的枚举、可选标记、returns）——调用陌生 solver 前先读它。
- **记录是一个过程（时间线）。** 每次引擎操作都会追加一行完全自描述的轨迹行（输入与输出都记录在案）；一条记录可以被重放，从而在不重新计算任何东西的前提下重建任意时刻的状态。
- **输入即值。** 模型给什么，引擎就存什么；字符串永远是字符串。

## 2. 类型化值

类型化值是一个 JSON 对象。`kind` 是 quantity 的一部分：

```json
{ "type": "number",  "value": 100,  "kind": "resistance" }
{ "type": "number",  "value": 25,   "kind": "temperature", "variant": "degC" }
{ "type": "number",  "value": 1500, "kind": "resistance",  "prefix": "kilo" }
{ "type": "complex", "value": { "re": 100, "im": 0 }, "kind": "voltage" }
{ "type": "complex", "value": { "mag": 220, "ang": 0.5236 }, "kind": "voltage" }
{ "type": "string",  "value": "lowpass" }
{ "type": "boolean", "value": true }
```

- `type`——形状判别符：number / complex / string / boolean / array（items 递归）/ object（fields 递归）。`slot` 值（`{ "type": "slot", "value": "…" }`）是引用，在 call/set 边界解析为被引用值的副本——永不存储、永不返回（§3）。
- `kind`——量纲类别（resistance、voltage、time、frequency、temperature、angle、pressure、energy、length、mass、log、none……）。kind 是 quantity 的一部分：值一经存在必带 kind；裸数的 kind 为 `none`；纯 ratio 的 kind 为 `log`。
- `variant`——kind *内部*的一种表示选择。**字段不存在（而非 null）即 SI 基准表示**；存储从不补键。只有下列词是合法的，且每个词只适用于它自己的 kind：

| kind | variant 词 | 基准（无键） |
|---|---|---|
| temperature | degC, degF | K |
| angle | deg | rad |
| pressure | bar, psi, atm | Pa |
| energy | cal, Wh | J |
| power | hp | W |
| length | inch, foot, yard, mile | m |
| mass | lb, oz | kg |

- `prefix`——number/complex 上的量级乘数。**字段不存在即乘数 1。** 词表是完整的小写英文单词，绝不用符号：`pico` `nano` `micro` `milli` `kilo` `mega` `giga` `tera`。prefix 一般只对 SI 基准表示有效（variant 词拒绝前缀）。
- 词表与存储一律是短 ASCII 文本；符号（Ω、°、µ……）从不进入值宇宙。

### 换算边界

变量表按**原样**存储值——`get` 返回的正是 `set` 写入的内容，不做归一化。换算只发生在值被计算*引用*时：在 `call` 边界，引擎把 variant 换算为 SI（degC → K、deg → rad、psi → Pa……），并把复数形状归一化（`{mag, ang}` → `{re, im}`，角度恒为弧度）。变量表不受影响；轨迹同时记录原始 args 与换算后的终点值。

## 3. 原语

```
set  { name, value }      写入一个槽：value 是类型化值；value: null 删除该槽
get  { name }             读取一个槽（返回存储的类型化值，与写入时完全一致）
call { solver, args, target }  调用一个已注册求解器；args 值是类型化值或形如 { "type": "slot", "value": "R" } 的槽引用
solver_info { solver }    调用前检视求解器的签名（参数、枚举、returns）
```

语义：

- `"100 kΩ"` 永远是字符串；表示 100 kΩ 的电阻，必须给 `{ "type": "number", "value": 100, "kind": "resistance", "prefix": "kilo" }`。
- 槽引用是一种独立的类型化值：`{ "type": "slot", "value": "name" }`，其中 `value` 是完整槽路径（`"name"` 或 `"name.field"`）。引擎展开引用后，按 solver 签名对它做 kind/形状校验；引用不存在的槽会以 `ENGINE_SLOT_UNDECLARED` 失败。引用也可以嵌在参数/`set` 值的数组元素与对象字段里，先展开为存储值再做校验——`set` 存入展开后的**副本**，之后改源槽不影响副本。槽引用只存在于 call/set 边界——永不存入变量表、永不作为结果返回；裸字符串永远是字面量字符串，绝不构成引用。
- **每次调用都返回一张收据**——不存在「异常 vs 正常返回」的分野：

```
success: set  → { ok: true, name, rev }   (delete: { ok: true, name, deleted })
         get  → { ok: true, name, value }
         call → { ok: true, target, rev }  (void solver: { ok: true, target: null })
failure:      → { ok: false, code, error }
```

  先看 `ok`。收据不携带业务数据（`get` 除外）；读值只能经由 `get`。
- **target 与 solver 签名匹配**（由引擎按注册表判别，模型无需记忆规则）：void solver（声明为 `returns: null`）接受 `target: null`（具名 target → `ENGINE_VOID_TARGET`）；有返回值的 solver 必须给具名 target（缺失/null → `ENGINE_TARGET_REQUIRED`）。
- **target 恒覆盖**：写入已存在的槽会用新值整体替换（kind 校验通过后）并推进 `rev`；不继承旧表示的任何部分。
- **删除 = 以 `value: null` 执行 `set`**：槽从变量表消失；删除不存在的槽是幂等的 ok；之后重建会从 rev 1 重新开始；轨迹行带 `deleted: true`。
- 槽的 kind 在首次写入时钉死：以不同 kind 覆盖会失败（`ENGINE_KIND_MISMATCH`），且不推进版本号。
- 失败的操作**没有副作用**：不建槽、变量表不变、版本号不动。失败仍会落入轨迹。

## 4. 记录与标记

```
record_question { text }   开启一条记录（清空变量表）；重复开启会把上一条记录封口为 duplicate-start
record_analyse  { text }   分析：已知量与带公式的思路——不含任何计算出的数字
record_answer   { text }   最终答案；封口该记录
```

- 至多一条未封口记录。第二次 `record_question` 会把当前未封口记录封口（duplicate-start）并开启新记录——两条 open 行永不可能并存。
- 没有未封口记录时的 `record_answer` 会保留一条 duplicate-end 错误记录。
- 中断的记录（索引中 `sealedAt: null` 且有本体文件）会在下次引擎启动时续写：轨迹在同一文件中继续，变量表据其重建。未封口（incomplete，即「未完成」）的记录永远不会自行变完整——它要么日后被封口（duplicate-start），要么永远停在未完成状态。

## 5. 求解器目录

所有求解器遵守同一个值契约：quantity 参数是类型化值（见 §2）；传递函数的数组系数是按降幂排列的 kind-`none` 量。目录与数学内核一一对应。

### 表达式与代数

| solver | 用途 |
|---|---|
| `calculate` | 求值字符串数学表达式，返回复数结果 |
| `rational_coefficients` | 把单变量表达式化简为有理函数，返回分子/分母系数 |

### 数列求和

| solver | 用途 |
|---|---|
| `series_sum` | 数列求和：等差、等比（有限项或收敛的无穷级数）或幂和 |

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
| `inverse_discrete_fourier_transform` | 频谱的 IDFT：恢复时域序列（DFT 的往返） |
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
| `circuit_impedance` | 某频率下（可嵌套）串/并联网络的驱动点总阻抗；network 是元件叶子（kind resistance\|inductance\|capacitance）与串/并联组的树的 JSON 文本 |
| `resonance` | 串联/并联 LC 谐振：resonantFrequency、qualityFactor 与 bandwidth |
| `ac_power` | 由 RMS 值求交流功率：视在 = V·I、有功 = 视在·cosφ、无功 = 视在·sinφ、功率因数 = cosφ |
| `transient_response` | 一阶/二阶充放电瞬态在时间点列表上的取值；每个时间点返回电压与电流 |

### 电子学

| solver | 用途 |
|---|---|
| `opamp_configurations` | 各配置的理想运放增益与输出：反相、同相、电压跟随器、差分、积分器、微分器 |
| `time_constant` | 时间常数与截止频率：τ = RC（给电容）或 τ = L/R（给电感） |
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
| `filter_design` | 巴特沃斯低通梯形设计：阶数、截止频率与相等的源/负载电阻给出元件表（串联电感、并联电容），并给出截止频率与查询频率处的衰减 |

### solver 表面说明

solver 表面正是在「每 solver 单一返回形状」纪律下迁移后的内核。值得注意的推论：

- `reflection_to_vswr` / `return_loss`：|Γ| = 1 / |Γ| = 0 两个极端无界——值宇宙中没有无穷，因此这类调用会抛错。
- `circuit_impedance.network` 是 JSON 文本字符串（封闭的 spec 无法表达递归的异构树）。
- `resonance.resistance` 为必填，结果恒携带 qualityFactor 与 bandwidth。
- `filter_design.queryFrequency` 为必填（只想要设计结果时传截止频率即可）；元件幅度是 kind-`none` 值，其单位由元件 kind 字符串携带。
- `opamp_configurations` 覆盖六种单输入配置（求和放大器没有单一增益）。
- `transient_response` 在 rc/rl/rlc 上返回同一种固定点形状（{time, voltage, current}）；不返回 rlc 阻尼特征。
- `voltage_divider` 返回固定四字段对象；不带载时 `unloadedOutputVoltage` 等于 `outputVoltage`，`loadCurrent` 为 0。
- `series_sum` 在所有分支上返回同一种固定形状（kind/power/sum/lastTerm/converges）；发散的无穷级数输入会报错。
- 带单位的回显字段沿用旧声明并使用 kind `none`（开尔文温度、波长、同轴直径、频率回显列表）——这些量的类型化值是 SI 基准数字。

### 外部求解器

注册表里还可以有来自声明的 solver：`external-solvers.jsonl` 每行一条 JSON 声明，引擎启动时每条启用且 `returns` 可映射的声明都会编译进与内置求解器同一个注册表。此后引擎看来没有区别——声明的 `parameters` 与 `returns` 就是签名，`solver_info` 与 `call` 无需特判即可工作；已解析参数以类型化值发出（SI、直角坐标、不含 variant/prefix 词），返回值在进入表之前先按声明的 `returns` 校验。轨迹里的 `call` 行与内核调用完全同形。

传输是只发 POST 的类型化信封：`{requestId, args}` → `{requestId, result}`（void solver 为 `null`）或 `{requestId, error}`；端点 URL、附加头部与超时（默认 30 秒）来自声明的传输选项。失败保留接口本身的含义——`EXTERNAL_ERROR`（端点在信封里自报）、`EXTERNAL_HTTP`（非 2xx 状态）、`EXTERNAL_TIMEOUT`（声明的超时）、`EXTERNAL_RESPONSE`（信封或值违反契约）——与其他失败一样，以一行失败调用落入轨迹。

## 6. 存储

插件主目录是 `~/.dsh-electro-lab`（可用 `DSH_ELECTRO_LAB_HOME` 环境变量覆盖）：

```
~/.dsh-electro-lab/
  record-index.jsonl     ← 索引（在 records/ 之外）
  records/
    <id>.jsonl           ← 轨迹本体（id 为 UUID v4）
  state.json             ← 插件状态：生成设置 + 重启标记
  external-solvers.jsonl ← 外部求解器声明（每行一条 JSON）
  logs/
    <YYYY-MM-DD_HH-mm-ss.SSS>.log   ← 一次宿主运行，纯事件行
```

### record-index.jsonl（仅作索引）

```json
{ "id": "…", "openedAt": 1730000000000, "sealedAt": null, "question": "given R = 100ohm…" }
```

字段：id、openedAt、sealedAt（null = 未封口）、question（不可变的标题）。不存错误、统计或内容；行序即追加序。截断是 UI 的职责。

### 轨迹本体（按步全量）

每次引擎操作或标记一行；每一行都携带恢复该步所需的全部信息——输入与输出都在：

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

- `call` 行存储结果：任何调用的输出都作为事实进入该行——恢复状态时直接用存储的结果，**从不重新计算**。
- `resolved` 是实际进入 run 的参数集：引用已展开，换算全部完成（SI、直角坐标）。`args` 保留原文；两者逐键对照。
- 内核内部的中间步骤与模型的推理文本都不会被记录；粒度就是一次引擎操作。轨迹的读者是人——每一步都就地呈现原始输入、换算值与结果，并可用任意方式独立复核。

### 恢复 = 重放

重建状态按序重放各行：`set` 行把槽置为存储的值，`call` 行把 target 槽置为存储的结果（非 void），set-null 行删除，marker 行跳过。纯引擎——不重算、不发网络、无随机。

### 一致性

- 孤儿索引行（sealedAt 为 null 但没有本体文件）在引擎启动时清除——索引只是投影，可安全重建。
- 打开的记录就是**索引里 `sealedAt: null` 且本体存在的那一行**；重启从这一对恢复，不依赖任何指针文件。
- 旧格式的 `records.jsonl` / `open-record.json` 不被读取；遗留文件会被忽略，可直接删除。

### state.json（插件状态）

插件自身的状态：生成对话框的设置（`generateDir`、`generateLanguage`、`generateFormat`、`generateCompile`）与外部声明重启标记（`restartRequired`，声明在启动时注册完毕后清除）。写入经由唯一持有模块做「读—改—写」，写者只动自己的键；文件以**原子替换**落盘（先写临时文件再改名），写入中途崩溃只会留下上一版完整文件。文件不可读时读成 `{}`。

### external-solvers.jsonl（声明归档）

每行一条 JSON 声明：`name`、`description`、`enabled`、`parameters`、`returns`、`transport` 与 `transportOptions`（端点 URL、附加头部、超时）。`returns` 决定能否注册——一个 spec，或 `null` 表示 void；`returns` 无法映射的声明会被存档、启动时跳过并给出告警，`enabled: false` 则静默跳过。文件只在挂载时读取一次：管理工具与归档端点写它并置 state.json 里的重启标记，从不改动运行中的注册表。

### logs/（每次宿主运行一个文件）

每次插件挂载一个文件：`<logs>/<YYYY-MM-DD_HH-mm-ss.SSS>.log`，独占创建并保持打开。行格式为 `<时间戳> <LEVEL> <message>[ k=v …]`，同时写入文件与 stdout。字段值为 JSON 类型、只展开一层——嵌套对象或数组是一个 token——Error 渲染为消息并追加带 `  | ` 前缀的堆栈续行。唯一的设置是 `DSH_ELECTRO_LAB_LOG_LEVEL`（`debug` | `info` | `warn` | `error` | `off`，默认 `info`）；保留最新 20 个文件、总量不超过 50 MB。

一次 run 的全部信息就在这个文件里：文件名是开始，末行是结束，末行不是 `plugin unmounted` 的 run 是被杀掉的。传输事实（端点、请求 id、耗时）只记入日志，不写入记录。

## 7. 宿主端点

- `GET /api/dsh-electro-lab/records-index`——供记录面板列表使用的索引行（`{ rows: [{ id, openedAt, sealedAt, question }] }`）。列表每 5 秒轮询一次；从不读取轨迹本体。
- `/api/dsh-electro-lab/external-solvers`——声明归档。`GET` 列出声明与重启标记，`PUT` 用 `config` 查询参数里的 base64url JSON 添加或替换一条，`DELETE ?name=` 删除一条。任何写入都置重启标记。

