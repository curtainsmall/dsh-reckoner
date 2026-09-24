---
name: reckoner-template
description: The Reckoner record protocol - which marker to call when (record_start first, record_end last) and what each message carries.
whenToUse: Load before starting a reckoner workflow, so the record is opened, written and closed in the right order.
---

# Reckoner record protocol

## Record protocol

A record is one calculation: its title, the conditions it was solved from, the explanations written while working, the evaluation steps and the closing text. It is written by three markers. `set`, `get` and `eval` are refused until `record_start` has opened one. Every question gets a record, whatever it is.

| step | call | rule |
|---|---|---|
| 1 | `record_start {title}` | FIRST, before any other tool call; a short title, about the length of an article title, never a paragraph |
| 2 | `set` | one call per quantity the user gave, transcribed into SI with its `dim`; no value enters the record that the user did not give |
| 3 | `record_message {text, hide?}`, `eval` | interleaved, in whatever order the work goes |
| 4 | `record_end {text?}` | LAST; `text` is the closing text the user should read |

The markers are unconditional; `set` and `eval` are not. A question that needs numbers carries them in `set` and `eval` between the markers; one that needs none carries its answer in `record_message` alone.

## Step 3 in detail

- `record_message` says what is happening and why: what a step does, what a result means, which relation is used. Write it for the reader; the record shows it and the article is written from it.
- `hide: true` marks a message as a note for the later article writer instead of the reader: conventions (whether a decibel takes 10 or 20), what to emphasise, which quantity the conclusion rests on, details of the problem statement. Hidden messages still reach the writer, and stay out of the record view.
- `eval` computes one expression and writes it into a slot; read a result back with `get`, or reference it as `@name` in the next formula. One message may cover several `eval` calls: the engine defines no steps, and the order alone carries the meaning.

## Receipts

Each marker answers `{ok}`; a refused marker answers `{ok: false, code, error}` and changes nothing.

## The lookup row

In the `reckoner-with-search` preset a fourth kind of row appears: `search`. You never write it, because every lookup appends its own row.

- The row holds the question, the candidate sources, the sources the policy allowed, the route and prompt version of the extractive step, and the answer it gave you.
- Do not describe a lookup in `record_message`. Say what you used the value for, the way you would write any other step; the record already names where the number came from.
- A lookup that answered nothing also writes a row. Its sentence is the record's account of a missing quantity, so close the record with what the record does hold.
- The sources are for the reader and the article, not for you: the answer is what you receive, and credit appears in the article because the record carries the sources.

The record is the structured presentation of the work: the chat reply stays prose, without the tables and headings the record already carries.
