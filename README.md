# DeepSeek Harness ElectroLab

An electrical & electronics calculation plugin for the DeepSeek Harness.

[简体中文](README.zh-CN.md)

## Contents

- [Install](#install)
- [ElectroLab Mode](#electrolab-mode)
- [Records](#records)
- [Article generation](#article-generation)
- [External solvers](#external-solvers)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [License](#license)

## Install

```sh
dsh plugin --profile web add dsh-electro-lab
```

## ElectroLab Mode

The plugin works as an agent preset: pick **ElectroLab Mode** when starting a session and ask any electrical or electronics question in plain language. The session is isolated to the plugin's tools, with no shell, file system or network, so every number in the answer comes from the engine, and the agent stops and asks when the conditions are insufficient.

All calculation happens inside a deterministic **engine**. The agent writes typed values into slots, calls one of 38 built-in solvers, and reads the result back; the engine converts units at the calculation boundary and records every step into a readable record.

| primitive | effect |
|---|---|
| `set` | writes one typed value into a slot |
| `get` | reads one slot back |
| `call` | runs a registered solver and stores its result |
| `solver_info` | returns a solver's signature before it is called |
| `record_question` / `record_analyse` / `record_answer` | bracket a solve into a record |

The catalog covers expression algebra, series, transfer functions, DSP and DFT, signal quality, circuits, electronics, RF and Smith chart, transmission lines, noise and filter design.

## Records

Settled records are listed in the client panel's **Records** tab, refreshed every 5 s, and a record that was never sealed is marked incomplete. Opening one shows its timeline: a collapsible card per write, read, call and failure, values as JSON trees, the toolbar and title fixed while the timeline scrolls. The list supports multi-select and delete.

A record is the process of one solve: every step reads on its own, and a solve that was interrupted continues from its record after a host restart.

## Article generation

Each record can be written up as a standalone solution article. The host LLM writes it from the trace — question, conditions, analysis, solver steps with their arguments and results, and the final answer — in the model's own voice, never mentioning the plugin.

| format | output |
|---|---|
| Markdown | a flat `.md` file, never compiled |
| LaTeX | a XeLaTeX document, compiled to PDF by a LaTeX driver |

The setup dialog remembers the article language, the output directory and the file name. Compilation needs latexmk or MiKTeX's texify together with the `xelatex` engine, and the dialog checks the toolchain once per host start: without a usable driver Generate is disabled with the reason shown. A run is cancellable, and its progress dialog minimizes to a corner pill that survives navigation. The article or its folder can be opened from that dialog.

## External solvers

Beyond the built-in catalog you can register solvers of your own, reached over http. A declaration lives in `~/.dsh-electro-lab/external-solvers.jsonl` and is compiled into the solver registry at engine start, so `solver_info` and `call` treat it like a built-in.

| way to declare | how |
|---|---|
| the panel | **External solvers** tab: list, add, edit, enable, disable, delete |
| the agent | `external_solver_add`, `external_solver_update`, `external_solver_delete` |
| the file | edit the archive directly |

A declaration carries a name, a description, the parameters, an explicit `returns` shape and the endpoint, and it may be written in the panel's guided form. Changes apply after a host restart, and the panel shows a pending-restart notice until then.

The peer answers a POST of `{ "requestId": …, "args": … }` with `{ "requestId": …, "result": … }`, or with `{ "requestId": …, "error": "…" }` to report a failure. Arguments and results are typed values, so units travel as SI numbers rather than as symbols or unit words.

[Engine manual §6](docs/engine.md#6-external-solvers) holds the full contract, and [`external-solvers-example/`](external-solvers-example/README.md) is a runnable peer with a field-by-field register guide.

## Configuration

| setting | meaning |
|---|---|
| `DSH_ELECTRO_LAB_HOME` | the plugin home, `~/.dsh-electro-lab` by default |
| `DSH_ELECTRO_LAB_LOG_LEVEL` | `debug`, `info`, `warn`, `error` or `off`; default `info` |

The home holds the records, the declaration archive, the plugin state and one log file per host run. Both are described in the engine manual: [storage](docs/engine.md#7-storage) and [logs](docs/engine.md#8-logs).

## Documentation

| document | content |
|---|---|
| [Engine manual](docs/engine.md) · [简体中文](docs/engine.zh-CN.md) | typed values, primitives, the solver catalog, external solvers, storage, logs |
| [external-solvers-example](external-solvers-example/README.md) · [简体中文](external-solvers-example/README.zh-CN.md) | a runnable echo peer and the field-by-field register guide |
| [Contributing](.github/CONTRIBUTING.md) · [简体中文](docs/CONTRIBUTING.zh-CN.md) | setup, commit conventions, release process |

## License

MIT © 2026 curtainsmall
