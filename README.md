# DeepSeek Harness Reckoner

A deterministic calculation engine for the DeepSeek Harness: the model writes the formulas, the engine owns the numerical rules.

Based on [dsh-electro-lab](https://github.com/curtainsmall/dsh-electro-lab) v0.13.0 (MIT, © curtainsmall). This project continues that engine work under a new name: the built-in solver catalog is gone and the mathematics now comes from the model, so the version line restarts at 0.1.0 and the two are not API-continuous.

[简体中文](README.zh-CN.md)

## Contents

- [Install](#install)
- [Reckoner Mode](#reckoner-mode)
- [The engine](#the-engine)
- [Records](#records)
- [Article generation](#article-generation)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [License](#license)

## Install

```sh
dsh plugin --profile web add dsh-reckoner
```

The package ships its own bundle patch, so the command inserts the plugin row into the profile roster.

## Reckoner Mode

The plugin works as an agent preset: pick **Reckoner Mode** when starting a session and ask any calculation question in plain language. The session is isolated to the plugin's tools — no shell, file system or network — so every number in the answer comes from the engine, and when the conditions are insufficient the agent says which quantity is missing and stops.

## The engine

All calculation happens inside a deterministic **engine**: it parses values, evaluates the formulas the agent writes, derives dimensions while it evaluates, and records every step. It ships no solvers and holds no domain knowledge — the mathematics comes from the model, the numerical rules (units, prefixes, complex arithmetic, dimensions) come from the engine.

| tool | effect |
|---|---|
| `set` | writes one value the user gave into a slot |
| `get` | reads one slot back as printed text |
| `eval` | evaluates ONE formula and stores the result in the slot named by `target` |
| `record_question` / `record_analyse` / `record_answer` | bracket a calculation into a record |

- A value is ONE plain string, written the way it is said: `4.7kohm`, `12volt`, `25degC`, `2j`, `1e5`, `[100ohm, 220ohm]`, `{v: 12volt, r: 100ohm}` — never a JSON envelope. A prefix is one letter (`p n u m k M G T`), units and variants are whole words (`ohm`, never `Ω`; `second`, never `s`; `degC`, never `°C`), so values and formulas are ASCII.
- What is stored is SI: `4.7kohm` and `4700ohm` are the same value, and `25degC` becomes 298.15 kelvin. `get`'s `format` prints a slot back with the unit, prefix or variant you ask for, and that string can be fed straight back in.
- A formula is ONE expression. `@name` reads a slot, and the slot that receives the result is `eval`'s `target`; `eval` does not return its value, so the model reads it back with `get`.
- The `$` notation supplies 5 constants, 23 functions and 6 bounded forms: `$sum`, `$prod` and `$seq` evaluate, while `$integral`, `$diff` and `$limit` can be written but not evaluated. Operators are `+ - * / ^`, and multiplication always needs `*`.
- The engine carries the seven SI base dimensions through the whole expression: `@V/@R` is a current, and a result whose kind contradicts the slot it would be written into is refused before anything is written.
- There is no comparison, no logic, no conditional and no assignment, and no `boolean`: an indicator is a `0`/`1`.

## Records

Records are listed in the **Reckoner** panel (the sidebar entry of the same name), refreshed every 5 s, and a record that was never sealed is marked incomplete. Opening one shows its timeline: question, analysis and answer each as a marker card, one card per `eval` step with the formula and the slot values it substituted, writes and reads grouped into collapsible sections, and `@name` chips that jump to the `set` row defining the slot. Failed attempts stay out of the timeline until **Display all** is on. The panel text follows the DSH locale (English and Simplified Chinese dictionaries), and the list supports multi-select and delete.

A record is the process of one calculation: every step reads on its own, and a calculation interrupted by a host restart continues from its record.

## Article generation

Each record can be written up as a standalone solution article. The host LLM writes it from the trace — question, conditions, analysis, the `eval` steps with their formulas and results, and the final answer — in the model's own voice, with the product name appearing only in the document's fixed title and author line.

| format | output |
|---|---|
| Markdown | a flat `.md` file, never compiled |
| LaTeX | an XeLaTeX document written into a folder named after the file, compiled to PDF by a LaTeX driver when requested |

The setup dialog remembers the article language and the output directory, and for LaTeX whether to compile a PDF; the file name is per run and pre-filled from the record id. Compilation needs latexmk or MiKTeX's texify together with the `xelatex` engine, and the dialog checks the toolchain once per plugin mount: with PDF compilation requested and no usable driver, Generate is disabled with the reason shown. A run is cancellable, and its progress dialog minimizes to a corner pill that survives navigation. The article or its folder can be opened from that dialog.

## Configuration

| setting | meaning |
|---|---|
| `DSH_RECKONER_HOME` | the plugin home, `~/.dsh-reckoner` by default |
| `DSH_RECKONER_LOG_LEVEL` | `debug`, `info`, `warn`, `error` or `off`; default `info` |

The home holds the records (`record-index.jsonl` and one `records/<id>.jsonl` trace per record), the plugin state (`state.json`) and the logs (`logs/<YYYY-MM-DD_HH-mm-ss.SSS>.log`, one file per host run). The engine manual describes the storage layout and the log lines.

## Documentation

| document | content |
|---|---|
| [Engine manual](docs/engine.md) · [简体中文](docs/engine.zh-CN.md) | values, the `set`/`get`/`eval` tools, the `$` notation, dimensions, records, storage, logs |
| [reckoner-interface](skills/reckoner-interface.md) | the manual the agent reads in Reckoner Mode: value grammar, notation, dimension rules |
| [Contributing](.github/CONTRIBUTING.md) · [简体中文](docs/CONTRIBUTING.zh-CN.md) | setup, commit conventions, release process |

## License

MIT © 2026 curtainsmall
