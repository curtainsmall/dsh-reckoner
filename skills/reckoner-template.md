---
name: reckoner-template
description: The Reckoner record protocol - which marker to call when (record_start first, record_end last) and what each message carries.
whenToUse: Load before starting a reckoner workflow, so the record is opened, written and closed in the right order.
---

# Reckoner record protocol

## Record protocol

A record is one calculation: its title, the conditions it was solved from, the explanations written while working, the evaluation steps and the closing text. It is written by three markers; `set`, `get` and `eval` are refused until `record_start` has opened one.

1. `record_start {title}` - FIRST, before any other tool call. `title` is short, about the length of an article title, never a paragraph: it names the record in the list and titles the article written from it later.
2. `set` - one call per quantity the user gave, transcribed into SI with its `dim`. This is not a place to calculate: no value enters the record that the user did not give.
3. `record_message {text, hide?}` and `eval` - interleaved, in whatever order the work actually goes:
   - `record_message` says what is happening and why: what a step does, what a result means, which relation is used. Write it for the reader - it is shown in the record and the article is written from it.
   - `hide: true` marks a message as a note for the later article writer instead of the reader: conventions (whether a decibel takes 10 or 20), what to emphasise, which quantity the conclusion rests on, details of the problem statement. Hidden messages still reach the writer; they are only hidden from the record view.
   - `eval` computes one expression and writes it into a slot; read a result back with `get` or reference it as `@name` in the next formula. One message may cover several `eval` calls - the engine does not define steps, the order alone carries the meaning.
4. `record_end {text?}` - LAST. `text` is optional and is the closing text the user should read; the record is written to disk and becomes readable at this moment. With no open record it is refused and nothing is written.

Each marker answers `{ok}`; a refused marker answers `{ok: false, code, error}` and changes nothing.

The record is the structured presentation of the work: the chat reply stays prose, without the tables and headings the record already carries.
