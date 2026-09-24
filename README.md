# DeepSeek Harness Reckoner

A deterministic calculation engine for the DeepSeek Harness: the model writes every formula, the engine owns the numerical rules.

[Simplified Chinese](README.zh-CN.md)

| item | value |
|---|---|
| origin | [dsh-electro-lab](https://github.com/curtainsmall/dsh-electro-lab) v0.13.0 (MIT, Copyright (c) curtainsmall) |
| relation | this project continues that engine work under a new name |
| inherited | the engine, the value model, the record, the panel, article generation, logging |
| abandoned | the built-in solver catalog: the mathematics now comes from the model |
| version line | restarted at 0.1.0; the two projects are not API-continuous |

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

| case | command |
|---|---|
| published package | `dsh plugin --profile <profile> add dsh-reckoner` |
| local checkout | `dsh plugin --profile <profile> add link:<path>` |

| step | effect |
|---|---|
| the command | appends `dsh-reckoner` to the profile's `dsh.profile.bundles` |
| the profile boot | merges the package's own `dsh.bundle.patch` (`cordis.patch.yml`) |
| the patch | inserts the plugin row |

## Reckoner Mode

The package ships two agent presets. A session picks one when it is created.

| preset | id | sandbox | outside lookup |
|---|---|---|---|
| **Reckoner** | `reckoner` | six plugin tools, no network | none |
| **Reckoner with search** | `reckoner-with-search` | the same six tools plus `search` | one fact at a time, written into the record with its sources |

| rule | effect |
|---|---|
| which to pick | the pure `reckoner` preset, unless the question needs a fact from outside |
| why it is fixed | a session that has produced anything cannot change its preset |

### The pure preset

| aspect | behaviour |
|---|---|
| surface | the six plugin tools, nothing else: no shell, no file system, no network, no subagents |
| number origin | a value transcribed by `set`, or a result produced by `eval` |
| missing quantity | the persona stops and names it |
| question carriage | every question opens a record |

The engine inside a record is optional: `set` and `eval` carry the parts that need numbers, and a question that needs none is answered through the record's own messages.

### The search preset

| aspect | behaviour |
|---|---|
| surface | the six tools plus exactly one tool, `search`, and nothing else |
| generic lookup | `web_search` and `web_fetch` are mounted by neither preset |
| consequence | the model can never search or fetch on its own |
| question | one per lookup |
| answer | in words, never the queries, the pages or the sources |

| kept in the record | detail |
|---|---|
| the question | as asked |
| candidates | every candidate source the provider returned |
| allowed | the sources the policy allowed |
| provenance | the route and prompt version of the extractive step that wrote the answer |
| policy | the preset row's config: the strict tier keeps only an allow-list of reference hosts |
| budget | at most four lookups per record, by default |

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

A value is a number, a complex number (stored rectangular), an array or an object, plus an SI vector of 7 integer exponents in ISO 80000-1 order (m, kg, s, A, K, mol, cd).

| `set` takes | example | note |
|---|---|---|
| a real | `{"num": 4500, "dim": "ohm"}` | |
| a complex | `{re, im}` | stored rectangular |
| a complex | `{mag, ang}` | converted on the way in |
| an array | `{array: [...]}` | one vector for the whole array |
| an object | `{object: {...}}` | one vector per field |

| `dim` is | note |
|---|---|
| a table name | the table holds SI names only |
| the 7 integers | the same vector, written out |
| omitted | the zero vector |

Any unit outside the table is converted by the model before the call. `degC` is the one affine name, and it is stored as kelvin.

### Formulas

A formula is one expression.

| syntax | reads |
|---|---|
| `@name` | a slot |
| `@name[i]` | an element |
| `@name.field` | a field |

| the `$` notation | count | evaluable |
|---|---|---|
| constants | 5 | yes |
| unary functions | 20 | yes |
| binary functions | 4 | yes |
| bounded forms | 6 | `$sum`, `$prod`, `$seq` yes; `$integral`, `$limit`, `$diff` writable only |

| rule | detail |
|---|---|
| operators | `+ - * / ^` |
| multiplication | must be written: `*` |
| absent | comparison, logic, conditional, assignment |

### Dimensions

Dimensions are derived during evaluation.

| construct | rule |
|---|---|
| an exponent | must be dimensionless |
| a real exponent | scales the base's vector |
| a complex exponent | needs a dimensionless base |
| `+` / `-` | one vector on both sides |
| `*` / `/` | add and subtract vectors |
| a fractional vector | refused at the slot |

### Receipts

A call answers `{ok: true, ...}` or `{ok: false, code, error}`. A refusal changes nothing and names one of the 19 stable codes.

## Records

A record is the process of one calculation: its title, conditions, explanations, evaluation steps and optional closing text.

| marker | refused when |
|---|---|
| `record_start {title}` | a record is already open |
| `record_end {text?}` | no record is open |
| `record_message {text, hide?}` | never; `hide: true` keeps it out of the record view while the article writer still receives it |

| rule | effect |
|---|---|
| `set`, `get`, `eval` | refused while no record is open |
| closing a record | clears the slot table |
| hence | the table is non-empty exactly while a record is open |

| on disk | path | note |
|---|---|---|
| the open record | `<home>/open-record.jsonl` | rows are appended here |
| closing | renames that file into `<home>/records/<id>.jsonl` | closing is atomic, and a closed record is always complete |
| the first line | `{seq: 0, version: 1}` | a file without it, or with an older version, is counted as unknown |
| an unknown record | never listed, served or used for generation | |
| an index file | none | the list is derived by scanning `records/` |

### The panel

| item | value |
|---|---|
| entry | the sidebar entry `Reckoner`, a pen-ruler glyph |
| routes | eleven HTTP paths under `/api/dsh-reckoner/` |
| refresh | every 5 s |
| tabs | two: **Records** and **Settings** |

| **Records** holds | detail |
|---|---|
| closed records | one row each |
| the unclosed record | pinned above them |
| unknown records | a red `X unknown records` line that offers to delete those files |
| selection | marked by the row's border; there are no checkboxes |
| an opened record | its timeline, one card per `eval` step |
| hidden messages | appear only under **Display all**, whose default is the preference **Settings** keeps |

| **Settings** shows | detail |
|---|---|
| generation defaults | one set per article format |
| the search policy | |
| display all | the preference above |
| a pending restart | a line shown while a change waits for a host restart |

## Article generation

Every closed record can be written up as a standalone article.

| the writer receives | detail |
|---|---|
| title | |
| conditions | those still standing |
| explanations and steps | interleaved in `seq` order |
| closing text | |
| numbers | cut to at most four decimal places |
| `hide: true` messages | presented as author's notes the writer must not print |

The product name appears only in the fixed title `DeepSeek Harness Reckoner Solution` and the fixed author line.

| format | output |
|---|---|
| Markdown | a flat `.md` file, never compiled |
| LaTeX | a `.tex` source in a folder named after the file, compiled to PDF when requested |

| remembered per format | detail |
|---|---|
| output directory | yes |
| language | yes |
| compile | LaTeX only |

The setup dialog opens with what its format remembers, and the Settings tab edits the same values. The file name is prefilled from the record identifier. PDF compilation is delegated to latexmk or MiKTeX's texify and needs the `xelatex` engine. With compilation requested and no usable driver or engine, Generate is disabled and the dialog names what is missing.

## Configuration

| setting | meaning |
|---|---|
| `DSH_RECKONER_HOME` | the plugin home, `~/.dsh-reckoner` by default |
| `DSH_RECKONER_LOG_LEVEL` | `debug`, `info`, `warn`, `error` or `off`; the default is `info` |

| the home holds | path |
|---|---|
| the unclosed record | `open-record.jsonl` |
| the closed records | `records/<id>.jsonl` |
| the plugin state | `state.json` |
| the logs | `logs/<YYYY-MM-DD_HH-mm-ss.SSS>.log` |

The state file is a tree with one subtree per module that remembers settings, plus the flat `restartRequired` marker. One log file is written per plugin mount.

## Documentation

| document | content |
|---|---|
| [Engine manual](docs/engine.md) ([Chinese](docs/engine.zh-CN.md)) | the long-form engine reference |
| [reckoner-interface](skills/reckoner-interface.md), [reckoner-template](skills/reckoner-template.md) | the manual the agent reads in Reckoner Mode |
| [Contributing](.github/CONTRIBUTING.md) ([Chinese](docs/CONTRIBUTING.zh-CN.md)) | setup, commit conventions, release process |

## License

MIT. Copyright (c) 2026 curtainsmall
