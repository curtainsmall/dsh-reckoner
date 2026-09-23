# DeepSeek Harness Reckoner

A deterministic calculation engine for the DeepSeek Harness: the model writes every formula, the engine owns the numerical rules.

Based on [dsh-electro-lab](https://github.com/curtainsmall/dsh-electro-lab) v0.13.0 (MIT, Copyright (c) curtainsmall). This project continues that engine work under a new name: the built-in solver catalog is gone and the mathematics now comes from the model, so the version line restarts at 0.1.0 and the two are not API-continuous.

[Simplified Chinese](README.zh-CN.md)

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
dsh plugin --profile <profile> add dsh-reckoner
```

A local checkout is installed by path instead, with `add link:<path>`. The command appends `dsh-reckoner` to the profile's `dsh.profile.bundles`, and the profile boot merges the package's own `dsh.bundle.patch` (`cordis.patch.yml`), which inserts the plugin row.

## Reckoner Mode

The package ships the `reckoner` agent preset, offered as **Reckoner**; each plugin mount copies it into `$DSH_HOME/.agent-presets/reckoner`. It contributes the persona only, because the plugin itself is mounted globally by the bundle patch.

A session in this preset exposes the six plugin tools and nothing else - no shell, file system, network or subagents - so every number in an answer is a value transcribed by `set` or produced by `eval`, and a missing quantity makes the persona stop and name it.

## The engine

One engine runs per host process, and every session's calls act on it. It is a calculator with no domain knowledge: no solver, no registry, no named formula. It parses the value it is given, checks dimensions while it evaluates the model's formula, and records each call.

| tool | effect |
|---|---|
| `set` | writes one slot; `value: null` deletes it |
| `get` | reads one slot back; the only way to read a value |
| `eval` | writes one formula's result into the `target` slot |
| `record_start` / `record_message` / `record_end` | open, annotate and close a record |

- A value is a number, a complex number (stored rectangular), an array or an object, plus an SI vector of 7 integer exponents in ISO 80000-1 order (m, kg, s, A, K, mol, cd). `set` takes a tagged value: `{"num": 4500, "dim": "ohm"}`, `{re, im}`, `{mag, ang}`, `{array: [...]}`, `{object: {...}}`, where `dim` is a table name or the 7 integers themselves. The table holds SI names only, so any other unit is converted by the model before the call; `degC` is the one affine name, stored as kelvin.
- A formula is one expression: `@name` reads a slot, `@name[i]` an element, `@name.field` a field. The `$` notation supplies 5 constants, 20 unary functions, 4 binary functions and 6 bounded forms; `$sum`, `$prod` and `$seq` evaluate, while `$integral`, `$limit` and `$diff` can be written but not evaluated. Operators are `+ - * / ^`, multiplication needs `*`, and there is no comparison, logic, conditional or assignment.
- Dimensions are derived during evaluation: an exponent must be dimensionless, a real exponent scales the base's vector, a complex exponent needs a dimensionless base; `+`/`-` need one vector on both sides, `*`/`/` add and subtract vectors. A fractional vector is refused at the slot.
- A call answers `{ok: true, ...}` or `{ok: false, code, error}`; a refusal changes nothing and names one of the 19 stable codes.

## Records

A record is the process of one calculation: its title, conditions, explanations, evaluation steps and optional closing text. `record_start {title}` is refused while a record is open and `record_end {text?}` is refused when none is; `hide: true` on a `record_message` keeps it out of the record view while the article writer still receives it.

`set`, `get` and `eval` are refused while no record is open, and closing a record clears the slot table, so the table is non-empty exactly while a record is open. The rows live in `<home>/open-record.jsonl`; closing renames that file into `<home>/records/<id>.jsonl`, which makes closing atomic and a closed record always complete. The first line is `{seq: 0, version: 1}`; a file without it, or with an older version, is counted as unknown and is never listed, served or used for generation. There is no index file.

The **Reckoner** panel is the sidebar entry of the same name (a pen-ruler glyph); it reads eleven HTTP paths under `/api/dsh-reckoner/` - two for records, nine for generation - refreshed every 5 s. Its list holds the closed records, the unclosed record pinned above them and a red `X unknown records` line that offers to delete those files; selection is marked by the row's border, since there are no checkboxes. A record opens as its timeline: the markers, one card per `eval` step with its formula and the slots it substituted; hidden messages appear only under **Display all**.

## Article generation

Every closed record can be written up as a standalone article. A host-side LLM call receives the record's facts as plain text - the title, the conditions still standing, the explanations and evaluation steps interleaved in `seq` order, and the closing text - with numbers cut to at most four decimal places and `hide: true` messages presented as author's notes the writer must not print; the product name appears only in the fixed title `DeepSeek Harness Reckoner Solution` and the fixed author line.

| format | output |
|---|---|
| Markdown | a flat `.md` file, never compiled |
| LaTeX | a `.tex` source in a folder named after the file, compiled to PDF when requested |

The setup dialog remembers the article language, the output directory and, for LaTeX, whether to compile; the file name is prefilled from the record id. PDF compilation is delegated to latexmk or MiKTeX's texify and needs the `xelatex` engine; with compilation requested and no usable driver or engine, Generate is disabled and the dialog names what is missing.

## Configuration

| setting | meaning |
|---|---|
| `DSH_RECKONER_HOME` | the plugin home, `~/.dsh-reckoner` by default |
| `DSH_RECKONER_LOG_LEVEL` | `debug`, `info`, `warn`, `error` or `off`; the default is `info` |

The home holds the unclosed record (`open-record.jsonl`), the closed records (`records/<id>.jsonl`), the plugin state (`state.json`, which keeps the remembered generation settings) and the logs (`logs/<YYYY-MM-DD_HH-mm-ss.SSS>.log`, one per plugin mount).

## Documentation

| document | content |
|---|---|
| [Engine manual](docs/engine.md) ([Chinese](docs/engine.zh-CN.md)) | the long-form engine reference |
| [reckoner-interface](skills/reckoner-interface.md), [reckoner-template](skills/reckoner-template.md) | the manual the agent reads in Reckoner Mode: values, receipts, notation, dimensions, record protocol |
| [Contributing](.github/CONTRIBUTING.md) ([Chinese](docs/CONTRIBUTING.zh-CN.md)) | setup, commit conventions, release process |

## License

MIT. Copyright (c) 2026 curtainsmall
