---
name: reckoner-template
description: The Reckoner record protocol - which marker to call when (record_start first, record_end last) and what each message carries.
whenToUse: Load before starting a reckoner workflow, so the record is opened, written and closed in the right order.
---

# Reckoner record protocol

## Record protocol

A record is one calculation: its title, the conditions it was solved from, the explanations written while working, the evaluation steps and the closing text. It is written by three markers. `set`, `get` and `eval` are refused until `record_start` has opened one.

Every question gets a record, whatever it is.

| part | content |
|---|---|
| title | names the record, and titles the article written from it |
| conditions | what the calculation was solved from |
| explanations | written while working |
| steps | one per `eval` |
| closing text | optional |

| step | call | rule |
|---|---|---|
| 1 | `record_start {title}` | FIRST; a short title, never a paragraph |
| 2 | `set` | one call per quantity the user gave, transcribed into SI with its `dim` |
| 3 | `record_message {text, hide?}`, `eval` | interleaved, in whatever order the work goes |
| 4 | `record_end {text?}` | LAST; `text` is the closing text the user reads |

The markers are unconditional; `set` and `eval` are not. A question that needs numbers carries them in `set` and `eval` between the markers; one that needs none carries its answer in `record_message` alone.

## Step 3 in detail

| call | carries |
|---|---|
| `record_message` | what is happening and why: what a step does, what a result means, which relation is used |
| `record_message {hide: true}` | a note for the article writer: conventions, emphasis, the quantity the conclusion rests on |
| `eval` | one expression, written into a slot |

| rule | detail |
|---|---|
| a message | written for the reader; the record shows it and the article is written from it |
| hidden messages | reach the writer, and stay out of the record view |
| an `eval` result | read back with `get`, or referenced as `@name` in the next formula |
| several `eval` calls under one message | allowed: the engine defines no steps, the order carries the meaning |

## Receipts

| answer | effect |
|---|---|
| `{ok}` | the marker succeeded |
| `{ok: false, code, error}` | the marker was refused, and nothing changed |

## The lookup row

In the `reckoner-with-search` preset a fourth kind of row appears: `search`. You never write it: every lookup appends its own row.

| the row holds |
|---|
| the question |
| the candidate sources |
| the sources the policy allowed |
| the route and prompt version of the extractive step |
| the answer it gave you |

| rule | detail |
|---|---|
| no narration | do not describe a lookup in `record_message`; say what you used the value for |
| a lookup that answered nothing | also writes a row: its sentence is the record's account of a missing quantity |
| the sources | for the reader and the article, not for you |

Credit appears in the article because the record carries the sources. The record is the structured presentation of the work: the chat reply stays prose, without the tables and headings the record already carries.
