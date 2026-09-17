# ElectroLab Engine Manual

[简体中文](engine.zh-CN.md)

Every electrical and electronics calculation in the ElectroLab plugin happens inside one deterministic **engine**. A language model never computes: it operates the engine through four primitives and three record markers, and the engine keeps a table of typed values, converts units at calculation boundaries, and records every step into a record that can be read back.

Sessions started in **ElectroLab Mode** carry the same rules in the `electro-lab-interface` and `electro-lab-template` skills.

## Contents

- [1. Overview](#1-overview)
- [2. Typed values](#2-typed-values)
- [3. Primitives](#3-primitives)
- [4. Records & markers](#4-records--markers)
- [5. Solver catalog](#5-solver-catalog)
- [6. External solvers](#6-external-solvers)
- [7. Storage](#7-storage)
- [8. Logs](#8-logs)
- [9. Host endpoints](#9-host-endpoints)

## 1. Overview

One engine runs per host process. Any session's markers act on it, and at most one record is open at a time.

A solve is a loop of engine operations bracketed by markers:

| step | tool | effect |
|---|---|---|
| 1 | `record_question` | opens a record and clears the table |
| 2 | `set` | stores each given condition as a typed value |
| 3 | `record_analyse` | states the knowns and the approach, before any calculation |
| 4 | `solver_info` | reads the signature of a solver about to be called |
| 5 | `call` | runs the solver and stores its result in a target slot |
| 6 | `get` | reads a value back |
| 7 | `record_answer` | submits the answer and seals the record |

Every step appends one self-describing line to the record, inputs and outputs both. A host restart rebuilds the table of the record that is still open from those lines, using the stored results rather than recomputing them.

The engine stores what it is given. A string stays a string, and no arithmetic happens outside a solver.

## 2. Typed values

A typed value is one JSON object. `kind` is part of a quantity, and so is the way it is written:

```json
{ "type": "number",  "value": 100,  "kind": "resistance" }
{ "type": "number",  "value": 25,   "kind": "temperature", "variant": "degC" }
{ "type": "number",  "value": 1500, "kind": "resistance",  "prefix": "kilo" }
{ "type": "complex", "value": { "re": 100, "im": 0 }, "kind": "voltage" }
{ "type": "complex", "value": { "mag": 220, "ang": 0.5236 }, "kind": "voltage" }
{ "type": "string",  "value": "lowpass" }
{ "type": "boolean", "value": true }
```

### 2.1 Fields

| field | meaning |
|---|---|
| `type` | the shape: `number`, `complex`, `string`, `boolean`, `array`, `object` |
| `value` | the payload; array items and object fields are typed values again |
| `kind` | the quantity class: resistance, voltage, time, frequency, temperature, angle, pressure, energy, length, mass, log, none, … |
| `variant` | how a quantity of that kind is written, when it is not the SI base unit |
| `prefix` | a magnitude multiplier on `number` and `complex` |

`{ "type": "slot", "value": "name" }` is not a value but a reference, resolved at the call boundary — see §3.3.

### 2.2 Kinds, variants and prefixes

| kind | variant words | base unit |
|---|---|---|
| temperature | degC, degF | K |
| angle | deg | rad |
| pressure | bar, psi, atm | Pa |
| energy | cal, Wh | J |
| power | hp | W |
| length | inch, foot, yard, mile | m |
| mass | lb, oz | kg |

Prefix words are `pico` `nano` `micro` `milli` `kilo` `mega` `giga` `tera`. A prefix is valid on an SI base representation only, never together with a variant word.

A missing `variant` or `prefix` field means the SI base unit and multiplier 1; the engine never writes those keys itself. Every word is short ASCII text — symbols such as `Ω`, `°` or `µ` never enter the value universe.

### 2.3 Conversion boundary

The table stores values exactly as given, so `get` returns what `set` wrote. Conversion happens when a value enters a computation: at the call boundary the engine converts variants to SI, normalizes complex payloads to `{ "re": …, "im": … }` with angles in radians, and applies prefixes. The boundary reaches inside arguments, so a quantity nested in an array or an object is converted like a top-level one.

The table itself is untouched, and the trace records both what was passed and what the solver received.

## 3. Primitives

| primitive | arguments | effect |
|---|---|---|
| `set` | `name`, `value` | writes one slot; `value: null` deletes the slot |
| `get` | `name` | reads one slot back, exactly as it was written |
| `call` | `solver`, `args`, `target` | runs one registered solver and stores its result |
| `solver_info` | `solver` | returns a solver's signature before it is called |

Arguments are typed values. `"100 kΩ"` is a string and nothing else; a resistance of 100 kΩ is `{ "type": "number", "value": 100, "kind": "resistance", "prefix": "kilo" }`.

### 3.1 Receipts

Every call returns one receipt, and there is no second failure channel:

```
success: set  → { ok: true, name, rev }        delete: { ok: true, name, deleted }
         get  → { ok: true, name, value }
         call → { ok: true, target, rev }        void solver: { ok: true, target: null }
failure:      → { ok: false, code, error }
```

Check `ok` first. Only `get` carries a value; every other number in a solve comes from a slot written by `set` or `call` and read back with `get`.

### 3.2 Slot rules

| rule | behaviour |
|---|---|
| target | a value solver needs a named target; a void solver, declared `returns: null`, takes `target: null` |
| overwrite | writing an existing slot replaces the whole value and bumps `rev`; nothing is inherited |
| delete | `set` with `value: null` removes the slot; deleting a missing slot is an idempotent ok, and re-creating it starts at rev 1 |
| pinned kind | a slot keeps the kind of its first write; a different kind fails and does not advance the revision |
| failure | a failed operation has no side effects: no slot is created, the table is unchanged, revisions stay put |

A failure still lands in the trace.

### 3.3 Slot references

A slot reference is `{ "type": "slot", "value": "name" }`, where `value` is the full path: `"name"` or `"name.field"`. The engine expands it, checks it against the solver signature, and fails with `ENGINE_SLOT_UNDECLARED` when the slot does not exist. References may sit inside array items and object fields as well as at the top level of an argument.

`set` stores a copy of the referenced value, so a later change to the source slot leaves the copy alone. A reference never enters the table and is never returned. A bare string is always a literal string.

### 3.4 Failure codes

| code | raised when |
|---|---|
| `ENGINE_ARGS` | the arguments do not match the solver signature, or a required one is missing |
| `ENGINE_SLOT_UNDECLARED` | a referenced slot does not exist |
| `ENGINE_KIND_MISMATCH` | the kind of an argument conflicts with the parameter, or with the pinned kind of a slot |
| `ENGINE_UNKNOWN_SOLVER` | the solver id is not registered |
| `ENGINE_VOID_TARGET` | a void solver was given a named target |
| `ENGINE_TARGET_REQUIRED` | a value solver was called without a named target |
| `ENGINE_UNSUPPORTED_VARIANT` | the variant word does not apply to that kind |
| `ENGINE_UNSUPPORTED_PREFIX` | the prefix word is unknown, or combined with a variant |
| `ENGINE_SOLVER_FAILED` | the solver itself failed while running |
| `EXTERNAL_ERROR` | an external endpoint reported a failure in its envelope |
| `EXTERNAL_HTTP` | an external endpoint answered with a non-2xx status |
| `EXTERNAL_TIMEOUT` | an external call exceeded the timeout of its declaration |
| `EXTERNAL_RESPONSE` | an external response broke the envelope contract |
| `TOOL_ERROR` | any other tool failure |

Registration-time codes — `REGISTER_MISSING_RETURNS`, `REGISTER_DUPLICATE` — belong to the host plugin rather than to a solve.

## 4. Records & markers

| marker | effect |
|---|---|
| `record_question` | opens a record and clears the table |
| `record_analyse` | submits the analysis: the knowns and the approach with formulas, before any calculation |
| `record_answer` | submits the final answer and seals the record |

At most one record is open. A second `record_question` seals the open one as an incomplete record and starts a new one, and `record_answer` without an open record keeps a short error record. An interrupted record is resumed at the next engine start: the trace continues in the same file and the table is rebuilt from it. A record that was never sealed stays marked as incomplete in the panel.

Sealing closes a record for good: its trace is finished and never recomputed. §7 covers what a record holds on disk.

## 5. Solver catalog

Every solver takes typed values and returns one typed value, as described in §2. Transfer-function coefficients are arrays of kind-`none` quantities in descending power order. The catalog mirrors the math kernels one-to-one, and `solver_info` gives the exact signature of any entry.

### Expression & algebra

| solver | purpose |
|---|---|
| `calculate` | Evaluate a string math expression and return the complex result |
| `rational_coefficients` | Reduce an expression in one variable to a rational function and return numerator/denominator coefficients |

### Series sums

| solver | purpose |
|---|---|
| `series_sum` | Sum of a number sequence: arithmetic, geometric or power |

### Transfer functions & frequency domain

| solver | purpose |
|---|---|
| `partial_fraction` | Partial-fraction expansion of a ratio-form transfer function |
| `poles_zeros` | Poles and zeros of a ratio-form transfer function |
| `transfer_function_response` | Evaluate a transfer function at frequency points (H(jω) or H(e^(jωT))) |
| `step_response` | Step response of a continuous transfer function at time points |
| `difference_equation_response` | Difference-equation recursion output y[n] (Laurent a/b convention) |
| `bode_response` | Bode plot of a ratio-form transfer function on a logarithmic frequency grid |
| `power_series_expansion` | Power-series expansion of a z-domain transfer function about z⁻¹ (impulse response) |

### Digital signal processing

| solver | purpose |
|---|---|
| `discrete_fourier_transform` | DFT of a complex sample sequence (optionally windowed) |
| `inverse_discrete_fourier_transform` | IDFT of a spectrum: recovers the time-domain sequence |
| `fourier_series_coefficients` | Fourier series coefficients (a₀, aₙ, bₙ) of a standard odd-symmetric waveform |
| `signal_analysis` | Signal statistics plus the windowed spectrum in one call (RMS, peak, peak-to-peak, DC) |

### Signal quality

| solver | purpose |
|---|---|
| `thd` | Total harmonic distortion of a sampled signal (fraction plus dB) |
| `jitter_snr` | SNR ceiling set by sampling-clock jitter |
| `adc_budget` | ADC noise budget: quantization, jitter and optional thermal SNR into a total SNR and ENOB |

### Circuits

| solver | purpose |
|---|---|
| `equivalent_impedance` | Total impedance of a set of impedances combined in series (Z = Σ Zi) or in parallel (1/Z = Σ 1/Zi) |
| `circuit_impedance` | Total driving-point impedance of a series/parallel network at a frequency; the network is JSON text, see the notes below |
| `resonance` | Series/parallel LC resonance: resonantFrequency, qualityFactor and bandwidth |
| `ac_power` | AC power from RMS values: apparent = V·I, real = apparent·cosφ, reactive = apparent·sinφ, powerFactor = cosφ |
| `transient_response` | First- or second-order charge/discharge transient at a list of time points; returns one point per time with voltage and current |

### Electronics

| solver | purpose |
|---|---|
| `opamp_configurations` | Ideal op-amp gain and output for a configuration: inverting, non-inverting, voltage-follower, difference, integrator, differentiator |
| `time_constant` | Time constant and cutoff frequency from R and C, or from L and R |
| `voltage_divider` | Resistive divider, loaded or unloaded, plus the Thévenin output resistance |
| `led_resistor` | LED series resistor: R = (Vs − Vf)/I and its dissipated power P = I²·R |

### RF & Smith chart

| solver | purpose |
|---|---|
| `impedance_to_reflection` | Reflection coefficient Γ = (Z − Z0)/(Z + Z0) |
| `reflection_to_vswr` | VSWR from a reflection coefficient: vswr = (1+|Γ|)/(1−|Γ|) |
| `return_loss` | Return loss in dB: −20·log10(|Γ|) |
| `quarter_wave_transformer` | Quarter-wave transformer characteristic impedance: Z1 = √(Z0·ZL) |
| `matched_network` | Matching network between two real resistances (topology l/pi/t); returns low-pass/high-pass conjugate solutions as ordered elements |

### Transmission lines

| solver | purpose |
|---|---|
| `wavelength_frequency` | Wavelength from frequency (velocity factor aware) |
| `coaxial_parameters` | Coaxial-line characterization from geometry (impedance, velocity factor, per-meter C and L) |
| `rise_time_bandwidth` | Convert between rise time and bandwidth (tr ≈ 0.35/BW) |

### Noise

| solver | purpose |
|---|---|
| `thermal_noise` | Thermal (Johnson) noise power in a bandwidth: P = k·T·B (temperature in kelvin) |
| `cascade_noise_figure` | Total noise figure of cascaded stages (Friis) from per-stage noise figures and gains in dB |
| `quantization_noise` | Ideal SNR of a uniform quantizer in dB: SNR = 6.02·N + 1.76 |

### Filters

| solver | purpose |
|---|---|
| `filter_design` | Butterworth low-pass ladder design: order, cutoff frequency and equal source/load resistance give the element list of series inductors and shunt capacitors, with attenuation at the cutoff and query frequencies |

### Reading a signature

`solver_info` returns the parameters, their kinds and enums, the optional flags and the `returns` shape. A quantity leaf names the set of values the position accepts:

| leaf | accepts |
|---|---|
| `complex(kind)` | a real or a complex of that kind |
| `number(kind)` | a real only; a complex is refused at the argument |

Widening is implicit and narrowing never is: a real stays a real until a solver that needs a complex converts it. `returns: null` marks a void solver, which takes `target: null` — see §3.2.

### Solver notes

| solver | note |
|---|---|
| `reflection_to_vswr`, `return_loss` | the unbounded extremes are errors: the value universe holds no infinity |
| `circuit_impedance.network` | JSON text: a leaf is `{ "kind": "resistance" \| "inductance" \| "capacitance", "value": <number> }`, a group is `{ "topology": "series" \| "parallel", "elements": [ … ] }`, and groups nest |
| `resonance` | `resistance` is required; the result always carries qualityFactor and bandwidth |
| `filter_design` | `queryFrequency` is required — pass the cutoff frequency when only the design is wanted; element magnitudes are kind-`none` values whose unit is in the element kind |
| `opamp_configurations` | covers the six single-input configurations, so a summing amplifier has no gain to return |
| `transient_response` | returns one point shape across rc, rl and rlc; the rlc damping characterization is not part of it |
| `voltage_divider` | returns a fixed four-field object; unloaded, `unloadedOutputVoltage` equals `outputVoltage` and `loadCurrent` is 0 |
| `series_sum` | returns one shape across all branches; a diverging infinite input is an error |
| `time_constant` | give `capacitance` for τ = RC or `inductance` for τ = L/R |
| unit-carrying fields | kelvin temperatures, wavelengths, coaxial diameters and frequency lists are kind-`none` values holding SI base numbers |

## 6. External solvers

Beyond the catalog you can register solvers of your own, reached over http. A declaration lives in `~/.dsh-electro-lab/external-solvers.jsonl`, one JSON object per line, and at engine start every enabled declaration with a mappable `returns` is compiled into the same registry as the built-ins. From then on there is no difference: `solver_info` and `call` treat it like any other solver, its arguments are resolved the same way, and its result is validated against the declared `returns` before it enters the table.

| field | meaning |
|---|---|
| `name` | the solver id: lowercase start, `a-z0-9_` |
| `description` | what the solver computes; this is what `solver_info` reports |
| `enabled` | whether it registers at start; a missing flag counts as enabled |
| `parameters` | parameter specs in the same leaf vocabulary as §5 |
| `returns` | the result shape, or `null` for a void solver |
| `transport` | `http` |
| `transportOptions` | `url`, and optional `headers` |
| `timeoutMs` | the call timeout, 30 s by default |

### Declaring a solver

A declaration is written through the panel's **External solvers** tab, by the agent through `external_solver_add`, `external_solver_update` and `external_solver_delete`, or by editing the archive file. The solver exists only after a host restart, and the panel shows a pending-restart notice until then. A declaration without a mappable `returns` is archived but skipped at start, with a warning in the log.

### The envelope

One POST per call, one JSON body back:

| direction | body |
|---|---|
| request | `{ "requestId": "…", "args": { "…": … } }` |
| result | `{ "requestId": "…", "result": … }`, `null` for a void solver |
| failure | `{ "requestId": "…", "error": "…" }` |

Arguments and results are typed values, so no symbols, variant or prefix words cross the wire; what arrives is SI and rect. A response whose `requestId` does not match, or that carries neither field, is refused. The failure codes are those of §3.4, and a call that fails before an envelope exists — an endpoint that is down, a host that does not resolve — fails as `ENGINE_SOLVER_FAILED` with the reason attached, for example `fetch failed: connect ECONNREFUSED 127.0.0.1:8787`. A peer must listen on a port the runtime is willing to dial: a well-known port is refused outright and reads as `bad port`.

[`external-solvers-example/`](../external-solvers-example/README.md) is a runnable peer and a field-by-field register guide.

## 7. Storage

The plugin home is `~/.dsh-electro-lab`, and `DSH_ELECTRO_LAB_HOME` moves it.

```
~/.dsh-electro-lab/
  record-index.jsonl      index rows, one per record
  records/<id>.jsonl      trace bodies, one file per record
  external-solvers.jsonl  declarations, one per line
  state.json              plugin state
  logs/                   one file per host run
```

| file | holds |
|---|---|
| `record-index.jsonl` | `{ id, openedAt, sealedAt, question }` per record; `sealedAt: null` marks the record that is still open |
| `records/<id>.jsonl` | one trace line per engine operation |
| `external-solvers.jsonl` | the declarations of §6 |
| `state.json` | the generation settings and the pending-restart flag |
| `logs/` | the run logs of §8 |

### Trace body

Every line carries everything needed to restore that step, input and output both:

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

| field | meaning |
|---|---|
| `args` | the arguments as they were passed, references included |
| `resolved` | the arguments the solver actually received: references expanded, conversions done |
| `result` | the value the solver returned, stored as fact |
| `code`, `error` | present on a failed line |

A trace holds engine operations only: no kernel internals and no model reasoning. Its reader is a human, and every step shows the original input, the converted values and the result in place.

### Recovery

A host that starts with a record still open rebuilds the table by replaying that record's lines in order: a `set` line writes its value, a `call` line writes the stored result into its target slot, a deleted slot is removed, and markers are skipped. The stored results are taken as facts, so nothing is recomputed, nothing is fetched and nothing is random. A sealed record is history rather than state, and every one of its lines stays readable on its own.

### Consistency

| situation | behaviour |
|---|---|
| an index row whose body file is missing | cleared at engine start |
| an open record | the index row with `sealedAt: null` whose body exists; a restart recovers it from that pair |
| `state.json` | written by one owner as read-modify-write and replaced atomically, so a crash mid-write leaves the previous file; an unreadable file reads as `{}` |
| a declaration change | written to the archive and marked in `state.json`, applied at the next start |

## 8. Logs

One file per host run, `<logs>/<YYYY-MM-DD_HH-mm-ss.SSS>.log`, created exclusively and held open. Every line is `<timestamp> <LEVEL> <message>[ k=v …]` and goes to the file and to stdout. A field value is a JSON scalar; a nested object or array is one token, and an Error becomes its message plus `  | ` continuation lines carrying the stack.

| setting | values |
|---|---|
| `DSH_ELECTRO_LAB_LOG_LEVEL` | `debug`, `info`, `warn`, `error`, `off`; default `info` |
| retention | the newest 20 files, up to 50 MB |

The file describes its own run: the name is the start, the last line is the end, and a log whose last line is not `plugin unmounted` belongs to a run that was killed. Transport facts such as endpoint, request id and elapsed time are logged, never written into a record.

## 9. Host endpoints

| endpoint | purpose |
|---|---|
| `GET /api/dsh-electro-lab/records-index` | index rows for the panel list, polled every 5 s; never reads a trace body |
| `GET /api/dsh-electro-lab/records/<id>` | one record's trace rows |
| `/api/dsh-electro-lab/external-solvers` | the declaration archive: `GET` lists declarations and the restart flag, `PUT` adds or replaces one, `DELETE ?name=` removes one |
| `GET /api/dsh-electro-lab/generate-capability` | the LaTeX toolchain check behind the generation dialog |
| `/api/dsh-electro-lab/generate`, `-progress`, `-cancel` | the article-generation job: start, poll, cancel |
| `/api/dsh-electro-lab/list-roots`, `list-dirs`, `generate-dir` | the directory browser of the generation dialog, and the remembered directory |
| `/api/dsh-electro-lab/reveal` | opens a generated file or its folder in the host's file manager |


