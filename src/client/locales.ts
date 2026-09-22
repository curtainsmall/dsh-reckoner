/**
 * Reckoner UI dictionaries: zh/en copies for every user-facing string in
 * the panel and the records page, registered into the DSH locale service
 * (dsh-client-locale) so the active language is the one the user chose.
 * Components subscribe through useAppLocale (LocaleFace) and translate with
 * t().
 */
import { useSyncExternalStore } from 'react'

export const LOCALE_NS = 'dsh-reckoner'

const zh = {
  backToSession: '返回会话',
  emptyHint: '暂无 Reckoner 记录——让智能体做一次计算。',
  unreachable: '暂未检测到记录——记录端点未响应,面板会自动重试;若刚更新插件,宿主可能需要重启。',
  confirm: '确定',
  irreversible: '此操作不可恢复。',
  cancel: '取消',
  delete: '删除',
  selectAll: '全选',
  enterSelectMode: '选择',
  exitSelectMode: '完成',
  selectedCount: '已选 {n} 条',
  selectRow: '选择记录',
  deleteSelected: '删除所选',
  deleteRecordsConfirm: '确定删除选中的 {n} 条记录？',
  deleteFailed: '{n} 条删除失败：{message}',
  incomplete: '未完成',
  backToRecords: '返回记录',
  displayAll: '显示全部',
  rowsCount: '{n} 行',
  failedCount: '{n} 次失败',
  recordUnreachable: '记录详情不可用——端点未响应；若刚更新插件，宿主可能需要重启。',
  writesGroup: '写入（{n}）',
  readsGroup: '读取（{n}）',
  failuresGroup: '失败尝试（{n}）',
  deleted: '（已删除）',
  evalLabel: '计算',
  evalFormula: '公式',
  evalTarget: '写入槽',
  evalNoTarget: '（只求值，不写入）',
  jumpToSet: '跳到槽 {name} 的定义',
  evalResult: '结果',
  articleGenerateMarkdown: '生成 Markdown',
  articleGenerateTex: '生成 LaTeX',
  generate: '生成',
  generateSetupMarkdown: 'Markdown 生成设置',
  generateSetupLatex: 'LaTeX 生成设置',
  generating: '生成中…',
  generateDone: '生成完成',
  generateFailed: '生成失败',
  generatedAt: '已生成至',
  openFile: '打开文件',
  openDirectory: '打开目录',
  phasePrepare: '读取记录…',
  phaseGenerate: '生成文章中…',
  phaseWrite: '写入文件…',
  phaseCompile: '编译 PDF 中…',
  minimize: '最小化',
  directoryRequired: '输出目录不能为空。',
  compilePdf: '编译为 PDF',
  toolchainMissing: '本机没有可用的 LaTeX 工具链（需要 latexmk 或 texify，以及 xelatex），无法编译 PDF。',
  macroHint: '可能缺少宏包：',
  generatedPdfAt: 'PDF 已生成至',
  compileFailed: 'PDF 编译失败：',
  compileFailedNoDetail: 'PDF 编译失败：驱动没有给出原因，详情见日志。',
  language: '语言',
  languageAuto: '跟随问题',
  languageZh: '简体中文',
  languageEn: 'English',
  directory: '目录',
  fileName: '文件名',
  browse: '浏览',
  browseDirectory: '选择输出目录',
  upLevel: '上一级',
  markerQuestion: '问题',
  markerAnalyse: '分析',
  markerAnswer: '答案',
  markerDuplicateStart: '重复开启（已按错误记录结算）',
  markerDuplicateEnd: '无记录时结算（错误记录）',
} as const

const en: Record<keyof typeof zh, string> = {
  backToSession: 'Back to session',
  emptyHint: 'No Reckoner records yet — ask the agent for a calculation.',
  unreachable: 'No records detected yet — the records endpoint is not responding; the panel keeps retrying automatically. If you just updated the plugin, the host process may need a restart.',
  confirm: 'OK',
  irreversible: 'This cannot be undone.',
  cancel: 'Cancel',
  delete: 'Delete',
  selectAll: 'Select all',
  enterSelectMode: 'Select',
  exitSelectMode: 'Done',
  selectedCount: '{n} selected',
  selectRow: 'Select record',
  deleteSelected: 'Delete selected',
  deleteRecordsConfirm: 'Delete the {n} selected record(s)?',
  deleteFailed: '{n} deletion(s) failed: {message}',
  incomplete: 'incomplete',
  backToRecords: 'Back to records',
  displayAll: 'Display all',
  rowsCount: '{n} row(s)',
  failedCount: '{n} failure(s)',
  recordUnreachable: 'Record detail unavailable — the endpoint is not responding; if you just updated the plugin, the host may need a restart.',
  writesGroup: 'Writes ({n})',
  readsGroup: 'Reads ({n})',
  failuresGroup: 'Failed attempts ({n})',
  deleted: '(deleted)',
  evalLabel: 'Eval',
  evalFormula: 'Formula',
  evalTarget: 'Written slot',
  evalNoTarget: '(evaluated without writing)',
  jumpToSet: 'Jump to slot {name}',
  evalResult: 'Result',
  articleGenerateMarkdown: 'Generate Markdown',
  articleGenerateTex: 'Generate LaTeX',
  generate: 'Generate',
  generateSetupMarkdown: 'Markdown generation setup',
  generateSetupLatex: 'LaTeX generation setup',
  generating: 'Generating…',
  generateDone: 'Generation complete',
  generateFailed: 'Generation failed',
  generatedAt: 'Generated at',
  openFile: 'Open file',
  openDirectory: 'Open directory',
  phasePrepare: 'Reading record…',
  phaseGenerate: 'Generating article…',
  phaseWrite: 'Writing file…',
  phaseCompile: 'Compiling PDF…',
  minimize: 'Minimize',
  directoryRequired: 'The output directory is required.',
  compilePdf: 'Compile to PDF',
  toolchainMissing: 'No usable LaTeX toolchain on this machine (needs latexmk or texify, and xelatex) — PDF compilation is unavailable.',
  macroHint: 'Packages may be missing:',
  generatedPdfAt: 'PDF generated at',
  compileFailed: 'PDF compilation failed:',
  compileFailedNoDetail: 'PDF compilation failed: the driver gave no reason — see the log.',
  language: 'Language',
  languageAuto: 'Auto (follow the question)',
  languageZh: '简体中文',
  languageEn: 'English',
  directory: 'Directory',
  fileName: 'File name',
  browse: 'Browse',
  browseDirectory: 'Select output directory',
  upLevel: 'Up one level',
  markerQuestion: 'Question',
  markerAnalyse: 'Analysis',
  markerAnswer: 'Answer',
  markerDuplicateStart: 'Duplicate open (settled as an error record)',
  markerDuplicateEnd: 'Settled with no open record (error record)',
}

export type LocaleKey = keyof typeof zh

/** Registered into the DSH locale service under LOCALE_NS. */
export const dictionaries = { zh, en }

/** Immutable locale snapshot mirrored from the DSH locale service. */
interface LocaleSnapshot {
  active: string
  revision: number
}

let current: LocaleSnapshot = { active: 'zh', revision: 0 }
const listeners = new Set<() => void>()

/** Wire the DSH locale service (LocaleFace getSnapshot/subscribe) into this module. */
export function installLocale(locale: { getSnapshot(): LocaleSnapshot; subscribe(listener: () => void): () => void }): void {
  current = locale.getSnapshot()
  locale.subscribe(() => {
    current = locale.getSnapshot()
    for (const listener of listeners) listener()
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): LocaleSnapshot {
  return current
}

/** Subscribe the calling component to the active language. */
export function useAppLocale(): string {
  return useSyncExternalStore(subscribe, getSnapshot).active
}

function isZh(active: string): boolean {
  return active.toLowerCase().startsWith('zh')
}

/** Translate one key in the active language; `{name}` placeholders are replaced from args. Unknown keys return themselves. */
export function t(key: LocaleKey | string, args?: Record<string, string | number>): string {
  const dict = isZh(current.active) ? zh : en
  let text = dict[key as LocaleKey]
  if (text === undefined) return key
  if (args !== undefined) {
    for (const [name, value] of Object.entries(args)) text = text.replace(`{${name}}`, String(value))
  }
  return text
}
