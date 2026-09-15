# DeepSeek Harness ElectroLab

An electrical & electronics calculation plugin for the DeepSeek Harness.

[简体中文](README.zh-CN.md)

## Install

```sh
dsh plugin --profile web add dsh-electro-lab
```

## ElectroLab Mode

The plugin works as an agent preset: pick **ElectroLab Mode** when starting a session and ask any electrical or electronics calculation question in plain language. The session is isolated to the plugin's tools — no shell, no file system, no network — so every number in the answer comes from the engine, and the agent stops and asks when the conditions are insufficient.

All calculation happens inside a deterministic **engine**. The agent operates it through three primitives — `set` (write a typed value into a slot), `get` (read a slot) and `call` (run one of 38 math solvers and store the result) — bracketed by the record markers `record_question` / `record_analyse` / `record_answer`. Typed values carry their own kind, variant and prefix (e.g. `{type: "number", value: 25, kind: "temperature", variant: "degC"}`); the engine stores them as given and performs SI and unit conversion only at calculation boundaries. Every step lands in a per-record trace file, so each solve is a reproducible process that can be replayed without re-computing.

The solver catalog covers expression algebra, series, transfer functions, DSP/DFT, signal quality (THD, jitter, ADC budget), circuits (impedance, resonance, transients, AC power), electronics (op-amps, dividers, LED), RF & Smith chart (reflection, matching networks), transmission lines, noise, and filter design. See the [engine manual](docs/engine.md).

Settled records are listed in the client panel's **Records** tab (indexed from `record-index.jsonl`, refreshed every 5 s); incomplete records are marked as such. Record bodies are process traces under `~/.dsh-electro-lab/records/`. The list has a select mode (multi-select, select all, delete with confirmation) and each record opens a timeline detail page: collapsible cards for writes/reads/failures and calls, JSON tree values with zebra striping, and a fixed toolbar/title area with the timeline scrolling beneath it.

## Article generation

The record detail page's right rail offers **Markdown** and **LaTeX** generation: the host LLM writes a fluent, self-contained solution article from the record's trace (question, established conditions, analysis notes, solver steps with their resolved arguments and results, and the final answer), presented as the model's own calculation — never mentioning ElectroLab, solvers or the generation process. Each button opens its own setup dialog (article language, output directory with a host-driven directory browser, file name; remembered across runs), then runs a cancellable background job whose progress dialog can be minimized to a corner pill that survives navigation. LaTeX articles are proper XeLaTeX documents (ctexart for zh-CN, fontspec + unicode-math + siunitx for en — pure Unicode throughout); **PDF compilation is LaTeX-only** (xelatex, two passes). Markdown output is written flat as `.md` and never compiled. The generated file is the primary artifact: open it or its folder straight from the progress dialog.

## External solvers

Beyond the built-in catalog you can register your own calculation solvers, reached over an **http** or **file** transport. A declaration (name, description, parameters, an explicit **returns** shape, transport options) lives in `~/.dsh-electro-lab/external-solvers.jsonl`; at engine start every enabled declaration is registered straight into the solver registry — same signature language as the built-ins, so `solver_info` and `call` work on them unchanged. Changes apply after a host restart (the panel shows a pending-restart notice until then).

Register and manage declarations three ways: the manager tools (`external_solver_add` / `external_solver_update` / `external_solver_delete`), or the **External solvers** tab of the panel, which lists, adds, edits, enables/disables and deletes them. `returns` is required for registration (a spec, or `null` for void); a declaration without it is archived but skipped, with a warning at start.

The wire protocol is a typed envelope, POST only: `{requestId, args}` → `{requestId, result}` (typed value, `null` for void) or `{requestId, error}`. Typed values only — no symbols and no variant/prefix words cross the wire. Failures surface as the same error receipts as local solvers (`EXTERNAL_ERROR` / `EXTERNAL_HTTP` / `EXTERNAL_TIMEOUT` / `EXTERNAL_RESPONSE`) and land in the record trace; results are stored as facts and never recomputed on replay.

[`external-solvers-example/`](external-solvers-example/README.md) is an independent npm project with manual test counterparts — `node src/echo.ts http` / `file` echoes the envelope protocol end to end, and the register guide lists every field value to type into the panel form.

## Development

See [Contributing](.github/CONTRIBUTING.md) for the development setup, commit conventions, and release process.

## Docs

- [Engine manual](docs/engine.md) (also in [简体中文](docs/engine.zh-CN.md))
- [external-solvers-example](external-solvers-example/README.md)
- [Contributing](.github/CONTRIBUTING.md)

## License

MIT © 2026 curtainsmall
