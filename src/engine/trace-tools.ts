/**
 * Every tool that can write a trace row, named once.
 *
 * One declaration serves all three readers of a record - the engine that writes
 * the rows, the facts that turn them into an article prompt, and the panel that
 * draws them - so a tool rename cannot leave one of them behind. The module is
 * deliberately free of Node imports: the browser bundle imports it too.
 *
 * The enum carries the names; `TRACE_TOOLS` is the same values as a list, for
 * the places that iterate or validate rather than name one tool.
 */

/** The tool names, declared in the order the tools are registered. */
export enum TraceTool {
  Set = 'set',
  Get = 'get',
  Eval = 'eval',
  Start = 'record_start',
  Message = 'record_message',
  End = 'record_end',
}

/** The same values as a list: registration order, iteration and validation. */
export const TRACE_TOOLS: readonly TraceTool[] = Object.values(TraceTool)

/** Whether a string read from disk is a tool this build knows. */
export function isTraceTool(value: unknown): value is TraceTool {
  return typeof value === 'string' && (TRACE_TOOLS as readonly string[]).includes(value)
}
