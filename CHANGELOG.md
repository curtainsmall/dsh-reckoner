# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking

- **The engine performs no domain computation: the model writes every formula.** `call` and `solver_info` are replaced by `eval`, which takes one expression (`formula`) and the slot it writes (`target`). The engine holds no solver, no registry and no domain knowledge; it parses the expression, checks the dimensions, evaluates and records. There is no comparison, no logic, no conditional and no assignment in a formula, and a bare name is a binding variable introduced by `$sum`, `$prod`, `$seq`, `$diff`, `$integral` or `$limit`.
- **A value is a tagged object carried by an SI vector.** A value is a `number`, a `complex` (stored rectangular), an `array` (one SI vector for the whole array) or an `object` (one vector per field); the vector is 7 integer exponents in ISO 80000-1 order (`m, kg, s, A, K, mol, cd`) and is the value's only identity. The kind name is a label for readers. The value-string grammar, its prefixes, its variants, the pinned-kind identity and the `boolean` type are removed; `set` therefore receives `{"num": 4500, "dim": "ohm"}`, and any unit outside the table is converted by the model before the call.
- **The record protocol is rebuilt around three markers.** `record_question`, `record_analyse` and `record_answer` become `record_start {title}`, `record_message {text, hide?}` and `record_end {text?}`. A record carries a short title, the conditions, the explanations written while working and an optional closing text; failed rows and `get` rows are skipped when the record becomes article material. `record_message` may be called any number of times, and `hide: true` keeps a message out of the record view while still handing it to the article writer. `set`, `get` and `eval` are refused while no record is open, and closing a record clears the slot table — the table is therefore non-empty exactly while a record is open.
- **Records are versioned and stored in two tiers.** The unclosed record lives in `<home>/open-record.jsonl`; closing renames that file into `<home>/records/<id>.jsonl`, so a closed record is always complete. The first line is `{seq: 0, version: 1}`; a record without that line, or with an older version, is counted as unknown and is never listed, served or generated from. `record-index.jsonl` is gone: the list is derived by scanning `records/`, and the unclosed record comes from engine state.
- **Failure codes name the phenomenon, not the inference.** The 19 codes were renamed accordingly: `ENGINE_SLOT_UNDECLARED` becomes `ENGINE_SLOT_NOT_FOUND`, `ENGINE_DIM_MISMATCH` becomes `ENGINE_INCOMPATIBLE_DIMENSION`, `ENGINE_RANGE_INDEX` becomes `ENGINE_INVALID_INDEX`, `ENGINE_RANGE_DOMAIN` becomes `ENGINE_UNDEFINED_RESULT`, `ENGINE_NO_RECORD` becomes `ENGINE_OPEN_RECORD_NOT_FOUND`, `ENGINE_TOOL` becomes `ENGINE_UNKNOWN_ERROR`, and so on. `ENGINE_SLOT_KIND`, `ENGINE_TYPE_MIXED_KIND` and `ENGINE_UNSUPPORTED_VARIANT` no longer exist.
- **The record panel was rebuilt on the new wire shapes.** The index row carries `title`, `version`, `openedAt` and `endedAt`; each trace row keeps the tool's own fields under `content`; a record's explanations and steps are drawn in `seq` order.

### Added

- The `$` notation: 5 constants (`$pi`, `$e`, `$inf`, `$i`, `$j`), 20 unary functions, 4 binary functions and 6 bounded forms. `$sum`, `$prod` and `$seq` evaluate; `$integral`, `$limit` and `$diff` can be written but are refused with `ENGINE_UNSUPPORTED_SYMBOL`. Arrays are element-wise with a scalar broadcast, `@x[k]` takes an element, `@th.field` a field, and `->` appears only in `$limit`'s subscript. A position is the brace written directly after the notation name, so every other `^` is a power.
- Storage of the whole derivation: the trace row `{seq, at, tool, ok, content}` records the formula, the slots it read and its result, and recovery replays the `set` and `eval` rows of an unclosed record so a restart resumes the calculation instead of repeating it.
- `get` parameters: `form` (`rect` or `polar`, a real widening to a complex), `digits` (significant digits for the display) and `dim` (a conversion, or a validation when given 7 integers). A `get` receipt can be fed back into `set`.
- The records panel shows the unclosed record as its own row, collapses unreadable records into a single `X unknown records` line that offers to delete them, and marks a selected record with its border rather than a checkbox.
- Article generation receives the record's facts in `seq` order — title, conditions, explanations interleaved with the evaluation steps, closing text — with the numbers cut to four decimal places, and with hidden messages presented as author's notes that must not be printed.

### Changed

- **The project is renamed to dsh-reckoner.** The package name, plugin id, cordis row, environment variable prefix, plugin home, agent preset, skills, locale namespace, route prefix and client bundle ids all move from electro-lab to reckoner, so this plugin and its predecessor can be installed side by side without sharing a row, a data directory or a skill name.
- **The version line restarts at 0.1.0.** This project derives from `dsh-electro-lab` v0.13.0 (MIT, © curtainsmall) and is not API-continuous with it. The entries below `[Unreleased]` are that project's history, kept under its own name.
- The persona, both skills, the engine manual and the readmes are rewritten for the current surface: the six tools, the `$` notation, the dimension rules, the record markers and the "prefer several `eval` calls over one deep expression" discipline replace the solver catalog, the value-string grammar and the external-solver guide. The persona gained a seventh standing rule: a question with several sub-questions opens one `record_message` per part and keeps that part's `set` and `eval` calls beneath it.
- The article prompt is built from the record's facts rather than from a flattened summary: the writer is told to use the recorded title, to reconstruct the problem statement from the record's own explanations, to copy numbers as they stand and to keep the author's notes out of the article.
- The plugin is no longer an electrical-engineering product: it describes itself as a deterministic calculation engine, its sidebar entry uses a pen-ruler glyph, and `complex.js` — used only by the deleted kernels — is no longer a dependency.

### Fixed

- A generation call that fails on its first attempt reports the provider's own reason. The stream's `finish` chunk carries `{kind, failure}`; the loop compared that object with the string `'aborted'`, so the abort check never fired and an `error` or `max-tokens` finish was discarded, leaving every failure as `the model produced no article text`. The reason is now read and reported, an unknown kind still falls through, and the fallback message names the finish reason it saw.
- Entering selection mode in the records list no longer shifts the list: every toolbar control is boxed to one height and the toolbar never wraps.

### Removed

- The 38-solver catalog and the 12 domain kernels behind it, the solver registry and the external-solver client, the `solver_info`/`call`/`convert` primitives, and the `boolean` value type.
- The value-string grammar with its prefixes and variants, the pinned-kind slot identity, the `record-index.jsonl` file, the `record_question`/`record_analyse`/`record_answer` markers and the three retired failure codes.

## [0.13.0] - 2026-09-17

### Added

- **External solvers**: register your own calculation solvers over http. A declaration (name, description, parameters, an explicit `returns`, endpoint, extra headers, timeout) lives in `~/.dsh-electro-lab/external-solvers.jsonl` and is registered into the solver registry at engine start, so `solver_info` and `call` work on it unchanged; changes apply after a host restart. Manage them with `external_solver_add` / `external_solver_update` / `external_solver_delete`, by editing the archive file, or from the panel's **External solvers** tab. The protocol is a POST-only typed envelope, `{requestId, args}` → `{requestId, result}` or `{requestId, error}`, with the same error codes as local solvers (`EXTERNAL_ERROR` / `EXTERNAL_HTTP` / `EXTERNAL_TIMEOUT` / `EXTERNAL_RESPONSE`).

### Changed

- A quantity leaf — in a declaration and in a built-in solver's signature — is spelled `number` or `complex`; the word `quantity` is gone from signatures, failure receipts and the declaration editor. `complex` takes a real as well (ℝ ⊂ ℂ) and `number` takes reals only, refusing a complex payload instead of narrowing it, so a signature can state which of the two it needs: `solver_info` reads `complex(resistance)` where it used to read `quantity(resistance)`, and a call that would narrow fails at the argument. Values keep their own spelling — `number` for a real, `complex` for a `{re, im}` / `{mag, ang}` payload — so records, the wire format and peers are untouched.

### Fixed

- Quantities nested in an array or object argument are converted like top-level ones. Before, a prefix or a variant word inside such an argument reached the solver untouched: `equivalent_impedance` on `[0.1 kilo-ohm, 50 ohm]` returned 50.1 instead of 150, silently, and the trace's `resolved` field kept the `prefix` it claims to have applied. Every solver taking an array or object of quantities was affected — impedance networks, transfer-function coefficients, DFT sample arrays, transient time points.
- A failed external call now keeps the reason fetch hides in its cause: `fetch failed: connect ECONNREFUSED 127.0.0.1:8787` instead of `fetch failed`. The log line carries it too, where it used to record only the code.

## [0.12.0] - 2026-09-16

### Breaking

- PDF compilation now needs a LaTeX **driver**: latexmk (TeX Live) or MiKTeX's texify. A machine with only `xelatex` installed no longer produces a PDF — the setup dialog says so before the run, and the `.tex` is written either way.

### Changed

- PDF compilation is delegated to a LaTeX driver — **latexmk**, else MiKTeX's **texify** — which decides how often the engine runs; the host never runs an engine itself. The LaTeX setup dialog checks the toolchain once per host start: without a usable driver and `xelatex` the Generate button is disabled with the reason shown, missing macros are only a warning, and such a request is refused before any model call.
- A run compiles with that driver and reports the result: the PDF path, or one failure line with the `.tex` kept. No fallback at run time.
- The failure line quotes the compiler when it says something, and is otherwise a localized note pointing at the log, which holds the driver's full output.

### Fixed

- The pending-restart flag is cleared at every host start, whether or not external solvers are enabled; a state file that cannot be written is logged as `restart flag not cleared` instead of failing the mount.

## [0.11.0] - 2026-09-15

### Added

- **Logging**: one text line per event, on stdout and in one file per host run (`~/.dsh-electro-lab/logs/<YYYY-MM-DD_HH-mm-ss.SSS>.log`). `DSH_ELECTRO_LAB_LOG_LEVEL` (default `info`) is the only setting; the newest 20 files up to 50 MB are kept.

### Changed

- Plugin state is one file, `~/.dsh-electro-lab/state.json` (generation settings + external-declaration restart flag), written through one owner module that replaces the file atomically.

## [0.10.0] - 2026-09-06

### Breaking

- Upgrading from 0.9.0: previously saved records (`records.jsonl` + `open-record.json`) are no longer read and are not migrated — the engine now stores traces as `record-index.jsonl` + `records/<id>.jsonl`, so old records will not appear in the panel.
- Sessions and integrations built for the old tool catalog will break: the previous tool names are gone — drive the engine with `set` / `get` / `call` instead (see Changed below).

### Changed

- The tool catalog is replaced by a deterministic calculation **engine** (`set` / `get` / `call` primitives over typed values — number/complex/string/boolean/array/object with kind, variant and prefix — plus slot references that resolve at call time and are copied on `set`). One engine per process, one variable table per question; failures are receipts with no side effects.
- Engine terminology everywhere: callables are **solvers** (38 kernel solvers: expression algebra, series, transfer functions, DSP/DFT, signal quality, circuits, electronics, RF & Smith chart, transmission lines, noise, filter design), the docs are the ElectroLab engine manual, and the record markers bracket each solve.
- The records UI follows the trace: **Records** list (indexed, 5 s refresh, incomplete badge, select mode with multi-delete) and a per-record **timeline detail** (collapsible writes/reads/failures/call cards, JSON tree values with zebra rows, display-all toggle, fixed toolbar/title with the timeline scrolling beneath, right-hand article rail).
- Record storage moved to append-only traces: `record-index.jsonl` + `records/<id>.jsonl` under `~/.dsh-electro-lab` (or `DSH_ELECTRO_LAB_HOME`), replayed — never recomputed — after a host restart.

### Added

- Self-healing receipts: missing or mistyped arguments are listed together with the expected spec and a ready-to-send typed example; `@name` slot strings are rejected with a migration hint; `solver_info` introspects any solver before its first call.
- Article generation (Markdown and LaTeX) through the host LLM: the detail rail's two buttons open per-format setup dialogs (article language, host-driven directory browser, file name — remembered), and a cancellable background job reports phase progress in a dialog that can minimize to a corner pill surviving navigation. LaTeX output is a sanitized model body inside a XeLaTeX shell (ctexart / fontspec + unicode-math + siunitx, pure Unicode); **PDF compilation is LaTeX-only** (xelatex, two passes). Articles are written as the model's own calculation — never mentioning ElectroLab, solvers or the generation process.

### Removed

- The old tool catalog's declaration machinery, solve-step orchestration and the five-section record UI.

## [0.9.0] - 2026-09-03

### Added

- LaTeX article generation: the record detail action rail now has one Generate button per format (Markdown / LaTeX), each opening its own dedicated setup dialog — the format never switches inside a dialog, so layouts stay stable. LaTeX articles are proper technical documents: XeLaTeX shells (ctexart for zh-CN, article for en; both with unicode-math scalable math fonts — no cmex substitution warnings), the model writes only the body, and the host sanitizes it (forbidden preamble commands, brace/dollar balance, bare-% escaping) before wrapping.
- Compile-to-PDF checkbox (LaTeX dialog): the host finds xelatex (PATH first, then known MiKTeX install locations), runs two passes with `-interaction=nonstopmode -halt-on-error -synctex=1` (plus `--enable-installer` on Windows so MiKTeX never shows an interactive prompt that would hang the job) and reports both the .tex and the PDF paths on completion; Open file opens the PDF. No TeX on the machine degrades gracefully to .tex only.
- Per-project output folders for LaTeX: `<output>/<name>/` holds `<name>.tex`, the PDF and the compiler's `.aux`/`.log` files, keeping the chosen directory clean; Markdown output stays a flat single file.
- Markdown→PDF compilation through pandoc + xelatex when pandoc is installed (the compile checkbox works for both formats); a missing converter reports exactly what to install.
- The `compile` phase in the generation progress dialog ("Compiling PDF…" / 「编译 PDF 中…」), shared `GenerationPhase` wire codes between host and client, and a fixed-width label column + left-aligned labels in the setup dialogs.
- All UI icons now come from Font Awesome free (SVG core, per-icon deep imports so the bundle stays small), including the official Markdown and TeX brand logos; the sidebar entry glyph is the FA wave-square path.

### Changed

- The single Generate action was replaced by two per-format buttons with their own dialogs; the detail action rail matches the global sidebar width (55px) with full-width buttons.

## [0.8.1] - 2026-09-02

### Added

- Cross-platform Open file / Open directory: the launcher follows the host's OS — explorer.exe on Windows, `open` with `-R` reveal on macOS, xdg-open on Linux (reveal opens the containing folder, since xdg-open has no select). Previously non-Windows returned "not supported on this platform".
- Spawn error detection: a missing opener binary (ENOENT, with a `/usr/bin` fallback for xdg-open) or a nonexistent target path is now reported to the client instead of silently succeeding.

## [0.8.0] - 2026-09-02

### Added

- Article generation through the host LLM: the record detail page gains a Generate action; the setup dialog picks the output directory through a host-driven lazy directory browser (pure HTTP — works locally and remotely), the file name (default `electro-lab-<record-id>.md`) and the article language; the host writes a proper technical article (exact H1/author line, H2 section headings, formulas and calculations on their own lines, numbers only from tool outputs) to disk.
- Explicit article language in the generation setup: follow the question (default), Simplified Chinese, or English — a forced language is pinned in both the system and the user prompt; the choice is remembered together with the output directory (state.json, migrated from the legacy plain-text file).
- Progress dialog with stage text and an elapsed timer, cancel while running, and Open file (default application) / Open directory (Explorer reveal) actions on completion.
- Minimizable generation progress: the dialog collapses into a corner status pill (running / done / error) that survives any navigation — the records list, the session chat, even closing the panel. Generation state lives in a module-level client store rendered in a body-level overlay root, so the job keeps polling and stays visible anywhere.
- Fixed-size (380×190) progress dialog with both-axis centered content; generation errors display in the same dialog; the setup dialog shows inline validation for an empty output directory.
- Unified dialog shell and button language across the records page: a right action rail starting at the title row, an inline SVG icon set (no emoji or system glyphs), and reusable ghost/primary button components.
- Cross-panel center-column eviction: opening ElectroLab closes the SSH and task-board views and their controllers (and vice versa).

## [0.7.0] - 2026-08-30

### Added

- Markdown export of a record (save-file picker with a download fallback): a localized H1, the id and timestamps as separate paragraphs, the five steps as unnumbered H2 sections, and each tool call as an H3 block with `Parameters` / `Result` H4 headings — value objects render in compact mathematical notation (`100 Ω`, `100 + 25j Ω`, `1 ∠ 0 rad`) and the outermost JSON braces are dropped.
- Compact mathematical display for value objects in the records page: rect/polar inputs and serialized outputs (`{re, im, kind, …}`) render as one math line with the unit from `kind` and no expansion; numbers use standard notation (6 significant digits, scientific for extreme magnitudes).
- Tool calls and results merged into one collapsible panel per call in the detail page (name → parameters → result); strings that embed JSON unwrap into trees.
- Record cards show the record id beneath the title (11 px monospace).
- Multi-select mode: a select button toggles selection of settled records — selected cards get the accent border plus a tint heavier than hover; a delete button batch-deletes the selection through a confirm dialog.
- Visible scrollbars in both themes (label-colored thumbs with the padding-box rounding trick) now that the page-level blur root cause is gone.
- Persona hard rules: value parameters must be value objects, never stringified JSON or bare numbers; the model must read the electro-lab-template skill before any tool call; `record_analyse` must precede the first calculation tool and hold only the conditions and the approach — every computed value belongs in `record_answer`.

### Changed

- The in-chat five-part template is dropped — records carry the structure, the chat answer stays natural; the template skill is now the record protocol.
- Circuit network leaves are complex value objects (`{form, re, im, kind}` with kind `resistance` | `inductance` | `capacitance`); the bare-number `{kind, value}` leaf DSL is rejected by validation.
- Records page polish: the Config tab and the header hint are gone (a single tab remains, styled like the dsh-ssh panel tabs); record cards are borderless ghosts that highlight only their border on hover; buttons and hover borders use solid label colors visible in both themes.
- Exported blocks switch from `json` to `text` fences, since value objects are rendered as math lines rather than raw JSON.

### Removed

- The single-record delete button on cards — batch delete covers deletion.

## [0.6.0] - 2026-08-29

### Added

- Dual-language UI: every panel and records-page string moves into zh/en dictionaries registered into the DSH locale service; components re-render when the user switches language.
- Collapsible result panels in the detail page, matching the tool-call sections: one panel per result (titled by the matching call), outputs as a recursive collapsible JSON tree when parseable.
- Record error messages translate with the UI; error codes and tool error identifiers stay raw.

### Changed

- The angle key is `ang` everywhere — input and output — since the phase angle is always radians (SI); the old `angRad` name is gone.
- The preset persona and skills no longer force Simplified Chinese — the model follows the user language.

## [0.5.1] - 2026-08-29

### Added

- Record detail as a tab-covering page: a back header with the record title, id and timestamps, a left table of contents that jumps to each section heading, and ONE shared scroll area where the five part headings stick to the top while scrolling (plain text only, no nested scrollbars).
- Collapsible tool-call panels in the detail page: one panel per call (expanded by default), arguments rendered as a recursive collapsible JSON tree.

### Changed

- Detail texts use the session-chat font size; id/timestamps, the table of contents and the record-card title/timestamp use the navbar size. The back-to-record button matches the back-to-session button, with the title on its own line beneath; the panel back button now reads 返回会话.

## [0.5.0] - 2026-08-29

### Added

- Client **Records** panel: a sidebar nav entry toggles a panel listing every settled record across all sessions, read through the same-origin endpoint `/api/dsh-electro-lab/records` (polled every 5 s).
- Records are stored as **one immutable JSONL line per settle** in `~/.dsh-electro-lab/records.jsonl` (outside `$DSH_HOME`; override with `DSH_ELECTRO_LAB_HOME`), surviving session deletion and restarts; an interrupted open record is persisted to `open-record.json` and restored by the constructor on restart. Records are built from sessions but never feed back into them.
- Five-step answer template (question, analysis with formulas, tool calls, results, answer) in the template skill and the packaged preset persona; the record schema mirrors it — `question`/`analyse`/`answer` paragraphs plus structured `calls`/`results` arrays (raw arguments JSON, full outputs, error identity).
- Record deletion: the endpoint serves DELETE ?id= to remove one settled record (the JSONL archive is rewritten without it), confirmed through a themed popup dialog (works in embedded webviews).
- The panel and records page use the dsw theme tokens (same system as the SSH panel), so they follow light/dark themes and skins; record cards highlight on hover, titles stay on one truncated line with an ellipsis, and the expanded card shows the full five steps in a grid.

### Changed

- **Record protocol**: `record_question` opens a record and submits the question, `record_analyse` submits the analysis, `record_answer` submits the answer and settles. Only bracketed content is recorded; the marker calls never appear in `calls`. Disorder semantics keep error records with data preserved (`duplicate-start`, `duplicate-end`, `incomplete`); a merged five-part template in the answer text is split into the fields automatically. Part-title lines are stripped from the record texts (`1. 分析（Analyse）`, `2. 计划（Plan）`, …) both when split out of a merged template and when submitted directly. The RecordManager owns all record state (JSONL archive + open snapshot), reads the real dsh-session event shapes, and the plugin mounts once.

### Removed

- The interactive Smith chart and the session-header button from the client (the impedance/reflection math remains available through the RF tools).

## [0.4.0] - 2026-08-28

### Added

- `series_sum` — arithmetic, geometric (finite or convergent infinite) and power sums (Σk, Σk², Σk³) selected by a `kind` discriminator.
- Signal-quality tools: `thd` (total harmonic distortion from sampled signals, spectral-folding aware), `jitter_snr` (clock-jitter SNR ceiling −20·log₁₀(2π·f·tⱼ)) and the `adc_budget` combo (quantization + jitter + thermal noise → total SNR and ENOB).

### Changed

- Unit conversion is now the `convert` primitive: per-family math functions (temperature affine, real only; pressure/energy/power/length/mass/angle linear, complex-capable; log ratio ↔ dB) dispatched by one tool through an O(1) family lookup. Angle conversion is degree → radian only — angles are always radians.
- Ratio kinds renamed `power`/`voltage` → `linear`/`quadratic` (10·log₁₀ vs 20·log₁₀), keeping the log conversion general outside any electronics context.
- npm publishing uses OIDC trusted publishing exclusively — the `NPM_TOKEN` fallback is removed.

### Removed

- `convert_unit` — superseded by `convert` (same families, plus ratio ↔ dB).
- `db_convert` and `decibel_ratio`, along with the dB level-unit layer (W/dBm/dBW/V/dBu/dBµV references) — level conversion adds no algorithm beyond a series of `convert` calls; `thermal_noise` returns watts only.

## [0.3.0] - 2026-08-26

### Removed

- `series_impedance` and `parallel_impedance` merge into `equivalent_impedance` — combine a set of complex impedances with a `topology` discriminator (`series` | `parallel`).

## [0.2.0] - 2026-08-26

### Added

- Series-RLC transient: `transient_response` now accepts kind `rlc` (resistance + inductance + capacitance) and returns the full second-order charge/discharge curve — closed form by damping regime (underdamped / critical / overdamped, ζ = (R/2)·√(C/L)) with alpha, omega0, dampingRatio and damping metadata, honoring both initial conditions (capacitor voltage, inductor current).

### Removed

- Redundant single-point primitives, superseded by existing tools: `rc_transient` and `rl_transient` (use `transient_response` with `times: [t]`), `element_impedance` (use `circuit_impedance` with a leaf node), `window_function` (the window is applied by `discrete_fourier_transform` / `signal_analysis` directly).

## [0.1.1] - 2026-08-26

### Changed

- GitHub Release bodies now carry the matching `CHANGELOG.md` entry instead of the bare tag name (read with the guard-verified version; validation stays in the guard).

## [0.1.0] - 2026-08-26

### Added

- DSH host plugin mounting ElectroLab: calculation tools, packaged skills, and the `electro-lab` agent preset (synced into the DSH user preset root on apply).
- Expression engine with complex-number arithmetic, inverse trigonometric functions `asin`/`acos`/`atan` (complex domain), two-argument `atan2(y, x) = arg(x + j·y)`, and symbol bindings.
- Transfer-function core: `rational_coefficients` ratio form with symbol bindings, poles/zeros, partial fractions, frequency (Bode) and step responses, z-domain power-series expansion.
- Digital signal processing: DFT/IDFT (radix-2 FFT with direct-sum fallback), Fourier series, window functions, difference equations, signal statistics.
- Circuit tools: driving-point impedance of nested networks, L/π/T matching networks, Butterworth low-pass ladder design, RC/RL transient curves, LC resonance.
- Electronics tools: op-amp configurations, voltage dividers, LED series resistors, time constants, transmission-line primitives (wavelength/frequency, coaxial characterization, quarter-wave transformer, rise time/bandwidth), reflection coefficient/VSWR/return loss.
- Noise and dB tools: thermal noise, Friis cascade noise figure, quantization SNR, dB level conversions (dBm/dBu/dBµV/dBW) and power/voltage ratio conversions.
- Unit conversion: `convert_unit` maps common non-SI units to their SI base quantities — temperature (°C/°F → K), pressure (bar/psi/atm → Pa), energy (cal/kWh → J), power (hp → W), length (inch/mile → m), mass (lb/oz → kg).
- `solve_steps` multi-step solver with `@stepN` result references and nested field paths.
- Client UI: panel and interactive Smith chart.
- Packaged skills and preset: `electro-lab-template` (mandatory five-part answer template) and `electro-lab-interface` (toolset interface); the preset persona gates every request before any tool call — missing conditions stop with no tool call.
- CI: typecheck/test/build on pull requests and `develop` pushes; release workflow guards that a `v*` tag is on `main` and consistent across `package.json`, `dsh.plugin.json` and the latest `CHANGELOG.md` entry, publishes to npm (OIDC trusted publishing with `NPM_TOKEN` fallback; prereleases on the `beta` dist-tag) and creates a GitHub Release.
- Documentation: dual-language README and contributing guide (en-US + zh-CN).

### Changed

- Tool surface normalized to SI quantity naming: arguments and outputs are named by quantity instead of by unit for SI quantities (`phaseAngle`, `phase`, `snr`, `returnLoss`…), while dB quantities keep the `Db` suffix (`noiseFigureDb`, `gainDb`, `magnitudeDb`, `returnLossDb`…) — dB is a log scale that can represent values beyond the linear number range, so it is not implied by the kind. Units stay documented in the descriptions and in the value `kind`.
- Angles are radians everywhere on the tool boundary (SI): the polar value form carries `angRad` only, `ac_power.phaseAngle` and the Bode `phase` output are in radians.

## [0.1.0-beta.1] - 2026-08-26

### Added

- First public beta of ElectroLab: the complete feature set listed under [0.1.0] above, published to npm under the `beta` dist-tag.

[0.13.0]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.13.0
[0.12.0]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.12.0
[0.11.0]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.11.0
[0.9.0]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.9.0
[0.8.1]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.8.1
[0.8.0]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.8.0
[0.7.0]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.7.0
[0.6.0]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.6.0
[0.5.1]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.5.1
[0.5.0]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.5.0
[0.4.0]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.4.0
[0.3.0]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.3.0
[0.2.0]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.2.0
[0.1.1]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.1.1
[0.1.0-beta.1]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.1.0-beta.1
[0.1.0]: https://github.com/curtainsmall/dsh-electro-lab/releases/tag/v0.1.0