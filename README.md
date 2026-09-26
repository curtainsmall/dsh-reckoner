# DeepSeek Harness Reckoner

A calculation engine for the DeepSeek Harness, to force LLM to use deterministic programe for evaluations rather than text generations.

[简体中文](README.zh-CN.md)

## Contents

- [DeepSeek Harness Reckoner](#deepseek-harness-reckoner)
  - [Contents](#contents)
  - [Install](#install)
  - [Reckoner Mode](#reckoner-mode)
    - [Preset: Reckoner](#preset-reckoner)
    - [Preset: Reckoner with search](#preset-reckoner-with-search)
  - [The engine](#the-engine)
  - [Records](#records)
    - [The panel](#the-panel)
  - [Article generation](#article-generation)
  - [Configuration](#configuration)
  - [Documentation](#documentation)
  - [License](#license)

## Install

```sh
dsh plugin --profile <profile> add dsh-reckoner
```

## Reckoner Preset

The package ships two agent presets:
| preset | id | tools| external sources |
|---|---|---|---|
| **Reckoner** | `reckoner` | record tools and evaluation tools| all knowledge comes from LLM  |
| **Reckoner with search** | `reckoner-with-search` | same tools as 'Reckoner' preset, plus web search tools| includes web search results |


The session gets the plugin tools and nothing else: no shell, no file system, no network, no subagents. Every number in an evaluation is therefore either a value the LLM sets with `set` or a result produced from `eval`.
 When
conditions given are not enough for solving, the LLM shall stop and point out.

For **Reckoner with search** preset, search tools are give for the LLM to search on web for external knowledges.

## The engine

### Basics

One engine runs per host process, and every session's calls act on it. It is a calculator with no domain knowledge. The LLM sets quantities given in conditions to engine, comes up with ideas and writes formulas to evaluation, and gets the results for output.
| tool | effect |
|---|---|
| `set` | writes one slot; `value: null` deletes it |
| `get` | reads one slot back; the only way to read a value |
| `eval` | writes one formula's result into the `target` slot |
| `record_start` / `record_end` | open and close a record |
|`record_message`|write down messages into records|
`search`(**Reckoner with search** preset only)|search on web|

A value is a number, a complex, an array of values or an object of named values. In the engine, the units are represented in the combinations of SI base units, A formula is one expression over the slots, with `+ - * / ^` and a set of `$` symbols and constants. No comparison, no logic and no assignment. Calls answer `{ok: true, ...}` or `{ok: false, code, error}`, and a refusal changes nothing.


### Records

A record is the process of one calculation: its title, conditions, explanations, evaluation steps and optional closing text.

A closed record lives in `<home>/records/<id>.jsonl`, and the one still open lives in `<home>/open-record.jsonl` until closing renames it into the first path, so a record that is closed is always complete. 

For the whole reference, see [engine manual](docs/engine.md) ([简体中文](docs/engine.zh-CN.md)).
## Article generation

Every closed record can be written up as a standalone article. A host-side LLM call receives the record's facts as plain text with numbers cut to at most four decimal places.
| format | output |
|---|---|
| Markdown | a flat `.md` file |
| LaTeX | a `.tex` source in a folder named after the file, compiled to PDF when requested |

For LaTex, PDF compilation is delegated to latexmk or MiKTeX's texify and needs the `xelatex` engine; with compilation requested and no usable driver or engine, Generate is disabled and the dialog names what is missing.

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
