# DeepSeek Harness Reckoner

A deterministic calculation engine for the DeepSeek Harness: the model writes every formula, the engine owns the numerical rules.

[简体中文](README.zh-CN.md)

- **Origin**: [dsh-electro-lab](https://github.com/curtainsmall/dsh-electro-lab) v0.13.0, MIT, Copyright (c) curtainsmall
- **Relation**: this project continues that engine work under a new name
- **Inherited**: the engine, the value model, the record, the panel, article generation, logging
- **Abandoned**: the built-in solver catalog; the mathematics now comes from the model
- **Version line**: restarted at 0.1.0; the two projects are not API-continuous

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

Install a local checkout by path instead: `dsh plugin --profile <profile> add link:<path>`.

1. The command appends `dsh-reckoner` to the profile's `dsh.profile.bundles`.
2. The profile boot merges the package's own `dsh.bundle.patch`, `cordis.patch.yml`.
3. That patch inserts the plugin row.

## Reckoner Mode

The package ships two agent presets. A session picks one when it is created: the pure `reckoner` preset, unless the question needs a fact from outside. A session that has produced anything cannot change its preset.

| preset | id | sandbox | outside lookup |
|---|---|---|---|
| **Reckoner** | `reckoner` | six plugin tools, no network | none |
| **Reckoner with search** | `reckoner-with-search` | the same six tools plus `search` | one fact at a time, written into the record with its sources |

### The pure preset

- **Surface**: the six plugin tools, nothing else; no shell, no file system, no network, no subagents
- **Number origin**: a value transcribed by `set`, or a result produced by `eval`
- **Missing quantity**: the persona stops and names it
- **Question carriage**: every question opens a record

The engine inside a record is optional: `set` and `eval` carry the parts that need numbers, and a question that needs none is answered through the record's own messages.

### The search preset

- **Surface**: the six tools plus exactly one tool, `search`, and nothing else
- **Generic lookup**: `web_search` and `web_fetch` are mounted by neither preset
- **Consequence**: the model can never search or fetch on its own
- **A lookup takes**: one question
- **A lookup gives the model**: one answer in words, never the queries, the pages or the sources

The record keeps what the model does not see: the question, every candidate source the provider returned, the sources the policy allowed, and the route and prompt version of the extractive step that wrote the answer. The retrieval policy is the preset row's config: the strict tier keeps only an allow-list of reference hosts, and a record carries at most four lookups by default.

Each plugin mount copies both preset directories into `$DSH_HOME/.agent-presets/`. Each preset contributes the persona only, because the plugin itself is mounted globally by the bundle patch.

## The engine

One engine runs per host process, and every session's calls act on it. It is a calculator with no domain knowledge: no solver, no registry, no named formula. It parses the value it is given, checks dimensions while it evaluates the model's formula, and records each call.

| tool | effect |
|---|---|
| `set` | writes one slot; `value: null` deletes it |
| `get` | reads one slot back; the only way to read a value |
| `eval` | writes one formula's result into the `target` slot |
| `record_start` / `record_message` / `record_end` | open, annotate and close a record |

### Values

A value is a number, a complex number (stored rectangular), an array or an object, plus an SI vector of 7 integer exponents in ISO 80000-1 order (m, kg, s, A, K, mol, cd). `dim` is a table name or those 7 integers; omitted, it is the zero vector. The table holds SI names only, so any other unit is converted by the model before the call, and `degC` is the one affine name, stored as kelvin.

`set` takes a tagged value:

- `{"num": 4500, "dim": "ohm"}` - a real
- `{re, im}` or `{mag, ang}` - a complex, stored rectangular
- `{array: [...]}` - an array, one vector for the whole array
- `{object: {...}}` - one vector per field

### Formulas

A formula is one expression. It reads `@name` for a slot, `@name[i]` for an element and `@name.field` for a field. The `$` notation supplies 5 constants, 20 unary functions, 4 binary functions and 6 bounded forms; `$sum`, `$prod` and `$seq` evaluate, while `$integral`, `$limit` and `$diff` can be written but not evaluated.

- **Operators**: `+ - * / ^`
- **Multiplication**: must be written, as `*`
- **Absent**: comparison, logic, conditional, assignment

### Dimensions

Dimensions are derived during evaluation.

- An exponent must be dimensionless; a real exponent scales the base's vector, and a complex exponent needs a dimensionless base.
- `+` and `-` need one vector on both sides; `*` and `/` add and subtract vectors.
- A fractional vector is refused at the slot.

### Receipts

A call answers `{ok: true, ...}` or `{ok: false, code, error}`. A refusal changes nothing and names one of the 19 stable codes.

## Records

A record is the process of one calculation: its title, conditions, explanations, evaluation steps and optional closing text.

| marker | effect | refused when |
|---|---|---|
| `record_start {title}` | opens a record | a record is already open |
| `record_message {text, hide?}` | one explanation, as many as the work needs | never |
| `record_end {text?}` | closes the record and writes it to disk | no record is open |

`hide: true` keeps a message out of the record view while the article writer still receives it. `set`, `get` and `eval` are refused while no record is open, and closing a record clears the slot table, so the table is non-empty exactly while a record is open.

- The open record: `<home>/open-record.jsonl`
- Closing: renames that file into `<home>/records/<id>.jsonl`, so closing is atomic and a closed record is always complete
- The first line: `{seq: 0, version: 1}`; a file without it, or with an older version, is counted as unknown, and an unknown record is never listed, served or used for generation
- An index file: none; the list is derived by scanning `records/`

### The panel

The **Reckoner** panel is the sidebar entry of the same name, a pen-ruler glyph. It reads eleven HTTP paths under `/api/dsh-reckoner/` and refreshes them every 5 s. It has two tabs.

**Records** holds the closed records, the unclosed record pinned above them, and a red `X unknown records` line that offers to delete those files. Selection is marked by the row's border; there are no checkboxes. A record opens as its timeline: the markers, one card per `eval` step with its formula and the slots it substituted. Hidden messages appear only under **Display all**, whose default is the preference **Settings** keeps.

**Settings** holds the generation defaults of each article format, the search policy and that display-all preference, and shows a line while a change is waiting for a host restart.

## Article generation

Every closed record can be written up as a standalone article. A host-side LLM call receives the record's facts as plain text: the title, the conditions still standing, the explanations and evaluation steps interleaved in `seq` order, and the closing text, with numbers cut to at most four decimal places and `hide: true` messages presented as author's notes the writer must not print. The product name appears only in the fixed title `DeepSeek Harness Reckoner Solution` and the fixed author line.

| format | output |
|---|---|
| Markdown | a flat `.md` file, never compiled |
| LaTeX | a `.tex` source in a folder named after the file, compiled to PDF when requested |

Each format remembers its own output directory and language, and LaTeX remembers whether to compile: the setup dialog opens with what its format remembers, and the Settings tab edits the same values. The file name is prefilled from the record identifier. PDF compilation is delegated to latexmk or MiKTeX's texify and needs the `xelatex` engine; with compilation requested and no usable driver or engine, Generate is disabled and the dialog names what is missing.

## Configuration

| setting | meaning |
|---|---|
| `DSH_RECKONER_HOME` | the plugin home, `~/.dsh-reckoner` by default |
| `DSH_RECKONER_LOG_LEVEL` | `debug`, `info`, `warn`, `error` or `off`; the default is `info` |

The home holds the unclosed record (`open-record.jsonl`), the closed records (`records/<id>.jsonl`), the plugin state and the logs (`logs/<YYYY-MM-DD_HH-mm-ss.SSS>.log`, one per plugin mount). The state file, `state.json`, is a tree with one subtree per module that remembers settings, plus the flat `restartRequired` marker.

## Documentation

| document | content |
|---|---|
| [Engine manual](docs/engine.md) ([简体中文](docs/engine.zh-CN.md)) | the long-form engine reference |
| [reckoner-interface](skills/reckoner-interface.md), [reckoner-template](skills/reckoner-template.md) | the manual the agent reads in Reckoner Mode |
| [Contributing](.github/CONTRIBUTING.md) ([简体中文](docs/CONTRIBUTING.zh-CN.md)) | setup, commit conventions, release process |

## License

MIT. Copyright (c) 2026 curtainsmall
