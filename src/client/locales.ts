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
  selectNone: '取消全选',
  enterSelectMode: '选择',
  exitSelectMode: '完成',
  selectedCount: '已选 {n} 条',
  selectRow: '选择记录',
  deleteSelected: '删除所选',
  deleteUnknown: '删除未知记录',
  deleteUnknownConfirm: '这 {n} 条记录格式未知、无法显示；删除后不可恢复。',
  deleteRecordsConfirm: '确定删除选中的 {n} 条记录？',
  deleteFailed: '{n} 条删除失败：{message}',
  incomplete: '未完成',
  unknownRecords: '{n} 条未知记录',
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
  searchLabel: '检索',
  searchOpenTier: '开放网络·未核实',
  searchSources: '出处（{n}）',
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
  markerStart: '开启记录',
  markerMessage: '说明',
  markerEnd: '封闭记录',
  markerDuplicateStart: '重复开启（已被拒绝）',
  markerDuplicateEnd: '无记录时封闭（已被拒绝）',
  tabRecords: '记录',
  tabSettings: '设置',
  settingsGeneration: '生成',
  settingsGenerationHint: '生成对话框以这些值作为它的默认值。',
  settingsPanel: '面板',
  showAllDefault: '默认显示被隐藏的行',
  showAllHint: '记录详情默认显示被隐藏的行（在详情页也可以切换）。',
  searchHintLayers: '检索策略三层依次生效：代码默认值 → 预设行配置 → 你的覆盖值；改动在下一次检索时生效，无需重启。',
  searchHintPlaceholder: '灰色提示为当前生效值；留空表示清除该覆盖值、重新继承下层。',
  allowedHosts: '允许的主机',
  allowedHostsHint: '每行一个主机后缀。',
  tierLabel: '网络范围',
  tierStrict: '严格（仅允许列表）',
  tierOpen: '开放（整个网络，未核实）',
  tierInherit: '继承（{value}）',
  maxResults: '单次最大结果数',
  maxSearchesPerRecord: '每条记录最大检索次数',
  answerMaxChars: '答案最大字符数',
  enrichPages: '抓取页面数',
  enrichCharsPerPage: '每页字符数',
  synthesisProvider: '合成提供方',
  synthesisModel: '合成模型',
  synthesisMaxTokens: '合成最大令牌数',
  deploymentDefault: '部署默认',
  resetSearchOverrides: '清除全部覆盖',
  save: '保存',
  saved: '已保存',
  retry: '重试',
  settingsLoadFailed: '设置加载失败：{message}',
  settingsSaveFailed: '保存失败：{message}',
  settingsRestartNeeded: '有待生效的改动：需要重启宿主进程后才会应用。',
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
  selectNone: 'Clear all',
  enterSelectMode: 'Select',
  exitSelectMode: 'Done',
  selectedCount: '{n} selected',
  selectRow: 'Select record',
  deleteSelected: 'Delete selected',
  deleteUnknown: 'Delete unknown records',
  deleteUnknownConfirm: 'These {n} records use an unknown format and cannot be shown; deleting them is irreversible.',
  deleteRecordsConfirm: 'Delete the {n} selected record(s)?',
  deleteFailed: '{n} deletion(s) failed: {message}',
  incomplete: 'incomplete',
  unknownRecords: '{n} unknown records',
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
  searchLabel: 'Search',
  searchOpenTier: 'open web · unverified',
  searchSources: 'Sources ({n})',
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
  markerStart: 'Record start',
  markerMessage: 'Message',
  markerEnd: 'Record end',
  markerDuplicateStart: 'Duplicate open (refused)',
  markerDuplicateEnd: 'Close with no open record (refused)',
  tabRecords: 'Records',
  tabSettings: 'Settings',
  settingsGeneration: 'Generation',
  settingsGenerationHint: 'The generation dialog uses these values as its defaults.',
  settingsPanel: 'Panel',
  showAllDefault: 'Show hidden rows by default',
  showAllHint: 'The record detail shows hidden rows by default (it can also be switched there).',
  searchHintLayers: 'The search policy layers in order: code defaults -> preset row -> your override. A change takes effect on the next lookup, with no restart.',
  searchHintPlaceholder: 'Grey placeholders are the values in force; leaving a field empty clears that override and inherits the layer below again.',
  allowedHosts: 'Allowed hosts',
  allowedHostsHint: 'One host suffix per line.',
  tierLabel: 'Network scope',
  tierStrict: 'Strict (allowed hosts only)',
  tierOpen: 'Open (whole web, unverified)',
  tierInherit: 'Inherit ({value})',
  maxResults: 'Max results per lookup',
  maxSearchesPerRecord: 'Max lookups per record',
  answerMaxChars: 'Answer max characters',
  enrichPages: 'Fetched pages',
  enrichCharsPerPage: 'Characters per page',
  synthesisProvider: 'Synthesis provider',
  synthesisModel: 'Synthesis model',
  synthesisMaxTokens: 'Synthesis max tokens',
  deploymentDefault: 'deployment default',
  resetSearchOverrides: 'Reset all overrides',
  save: 'Save',
  saved: 'Saved',
  retry: 'Retry',
  settingsLoadFailed: 'Cannot load settings: {message}',
  settingsSaveFailed: 'Save failed: {message}',
  settingsRestartNeeded: 'A pending change needs a host restart before it takes effect.',
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
