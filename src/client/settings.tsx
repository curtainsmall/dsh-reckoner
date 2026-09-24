/**
 * Reckoner settings tab: one page for the generation defaults, the search
 * policy and the panel preference, read from and written to the host's one
 * settings endpoint (`GET`/`PUT /api/dsh-reckoner/settings`).
 *
 * The module also owns the small store the rest of the panel reads. The panel
 * preference has to be known before this tab is ever opened — the record
 * detail's "Display all" toggle starts from it and writes it back — so the
 * snapshot, not the tab, is the source of truth here. Every request failure
 * stays a line of text: the panel keeps working when the host is old, serves
 * fewer fields than this build knows, or answers nothing at all.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { t, useAppLocale } from './locales.ts'
import { GhostButton } from './ui.tsx'

/** The one settings endpoint: GET reads the whole view, PUT writes the sections it names. */
export const SETTINGS_ENDPOINT = '/api/dsh-reckoner/settings'

/* ── The view the endpoint serves (client mirror, read defensively) ────────── */

/**
 * The search policy as the host resolves it: this is a mirror of the host's
 * `SearchConfig`, read leaf by leaf, so a host that serves fewer fields still
 * yields a usable view.
 */
export interface SearchConfig {
  tier: string
  allowedHosts: string[]
  maxResults: number
  maxSearchesPerRecord: number
  answerMaxChars: number
  enrich: { pages: number; charsPerPage: number }
  synthesis: { provider?: string; model?: string; maxTokens: number }
}

/** The three layers the host reports for one lookup: `preset` stays opaque (it is the row's raw config). */
export interface SearchPolicyView {
  defaults: SearchConfig
  preset: unknown | null
  override: Record<string, unknown>
  effective: SearchConfig
}

/** One article format's remembered generation defaults. */
export interface GenerationFormatView {
  directory: string
  language: string
  /** PDF compilation: LaTeX only; always false for Markdown. */
  compile: boolean
}

/** Everything the Settings tab shows. */
export interface SettingsView {
  generation: { markdown: GenerationFormatView; latex: GenerationFormatView }
  search: SearchPolicyView
  panel: { showAll: boolean }
  restartRequired: boolean
}

/** The code defaults as this build knows them: only the placeholders of a host that omits them. */
const FALLBACK_SEARCH: SearchConfig = {
  tier: 'strict',
  allowedHosts: [],
  maxResults: 12,
  maxSearchesPerRecord: 4,
  answerMaxChars: 1200,
  enrich: { pages: 0, charsPerPage: 4000 },
  synthesis: { maxTokens: 800 },
}

function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One leaf as text, or the fallback when it is not a string. */
function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/** One leaf as a number, or the fallback when it is not one. */
function count(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** One search policy, every field defaulting to the layer below it. */
function readSearchConfig(raw: unknown, fallback: SearchConfig): SearchConfig {
  if (!isBag(raw)) return fallback
  const enrich = isBag(raw['enrich']) ? raw['enrich'] : {}
  const synthesis = isBag(raw['synthesis']) ? raw['synthesis'] : {}
  const hosts = Array.isArray(raw['allowedHosts'])
    ? raw['allowedHosts'].filter((host): host is string => typeof host === 'string')
    : fallback.allowedHosts
  const provider = typeof synthesis['provider'] === 'string' ? synthesis['provider'] : undefined
  const model = typeof synthesis['model'] === 'string' ? synthesis['model'] : undefined
  return {
    tier: text(raw['tier'], fallback.tier),
    allowedHosts: [...hosts],
    maxResults: count(raw['maxResults'], fallback.maxResults),
    maxSearchesPerRecord: count(raw['maxSearchesPerRecord'], fallback.maxSearchesPerRecord),
    answerMaxChars: count(raw['answerMaxChars'], fallback.answerMaxChars),
    enrich: {
      pages: count(enrich['pages'], fallback.enrich.pages),
      charsPerPage: count(enrich['charsPerPage'], fallback.enrich.charsPerPage),
    },
    synthesis: {
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
      maxTokens: count(synthesis['maxTokens'], fallback.synthesis.maxTokens),
    },
  }
}

/** One format's remembered values; the defaults are what the host applies to an unset field. */
function readFormat(raw: unknown): GenerationFormatView {
  const bag = isBag(raw) ? raw : {}
  return {
    directory: text(bag['directory'], ''),
    language: text(bag['language'], 'auto'),
    compile: bag['compile'] === true,
  }
}

/** The whole response as this tab reads it; null when the body is not an object at all. */
function readSettings(raw: unknown): SettingsView | null {
  if (!isBag(raw)) return null
  const generation = isBag(raw['generation']) ? raw['generation'] : {}
  const search = isBag(raw['search']) ? raw['search'] : {}
  const panel = isBag(raw['panel']) ? raw['panel'] : {}
  const defaults = readSearchConfig(search['defaults'], FALLBACK_SEARCH)
  return {
    generation: {
      markdown: readFormat(generation['markdown']),
      latex: readFormat(generation['latex']),
    },
    search: {
      defaults,
      preset: search['preset'] ?? null,
      override: isBag(search['override']) ? search['override'] : {},
      // A host that reports no effective layer still has the defaults to show.
      effective: readSearchConfig(search['effective'], defaults),
    },
    panel: { showAll: panel['showAll'] === true },
    restartRequired: raw['restartRequired'] === true,
  }
}

/**
 * One format's generation defaults out of a raw settings body: what the generation setup dialog
 * opens with. Reading it here keeps the one defensive parse of the wire shape in one place.
 */
export function readGenerationFormat(raw: unknown, format: 'markdown' | 'latex'): GenerationFormatView {
  const generation = isBag(raw) && isBag(raw['generation']) ? raw['generation'] : {}
  return readFormat(generation[format])
}

/* ── The store (snapshot + subscription, shared with the record detail) ────── */

/** One immutable snapshot: server truth, plus the preference the user has just chosen. */
interface SettingsState {
  data: SettingsView | null
  /** The panel preference in force: server truth once loaded, the user's choice the moment they toggle. */
  showAll: boolean
  /** The load failure, as one line of text. */
  error: string | null
  /** True while a read is in flight; the reads are coalesced on it. */
  loading: boolean
  /**
   * Bumped by a read alone, never by a write's answer. The tab re-seeds its forms on this one, so a
   * save cannot discard edits the user has made in another section since it was sent.
   */
  loadedRevision: number
  /** A failed `panel` write made outside this tab — the record detail's toggle. */
  panelError: string | null
}

let state: SettingsState = { data: null, showAll: false, error: null, loading: false, loadedRevision: 0, panelError: null }
const listeners = new Set<() => void>()

function setState(next: SettingsState): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): SettingsState {
  return state
}

/** The settings store as a hook: a component re-renders on every load and every write. */
export function useSettings(): SettingsState {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** One failure as the text the tab shows under its label. */
function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Adopt one settings view: it replaces every loaded field, including the panel preference. */
function adopt(data: SettingsView, fromRead: boolean): void {
  setState({
    data,
    showAll: data.panel.showAll,
    error: null,
    loading: false,
    loadedRevision: fromRead ? state.loadedRevision + 1 : state.loadedRevision,
    panelError: null,
  })
}

/** Read the whole view from the host; a failure becomes a line of text, never a throw. */
export async function loadSettings(): Promise<void> {
  if (state.loading) return
  setState({ ...state, loading: true })
  try {
    const res = await fetch(SETTINGS_ENDPOINT)
    if (!res.ok) throw new Error(`settings endpoint returned ${res.status}`)
    const data = readSettings((await res.json()) as unknown)
    if (data === null) throw new Error('settings endpoint returned an unreadable body')
    adopt(data, true)
  } catch (error) {
    setState({ ...state, loading: false, error: failureText(error) })
  }
}

/** Ask for the view once: the panel does it at mount, so the detail's toggle has its default. */
export function ensureSettingsLoaded(): void {
  if (state.data === null && !state.loading) void loadSettings()
}

/** One write's outcome: the server's own answer, and the error line the tab shows otherwise. */
export type SaveResult = { ok: true; settings: SettingsView | null } | { ok: false; error: string }

/**
 * Write the sections the body names; the host answers with the whole view, which is adopted here.
 * Never rejects, so a caller may hand the promise to `void`.
 */
export async function putSettings(body: Record<string, unknown>): Promise<SaveResult> {
  try {
    const res = await fetch(SETTINGS_ENDPOINT, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = (await res.json().catch(() => null)) as unknown
    const bag = isBag(payload) ? payload : {}
    if (!res.ok) return { ok: false, error: text(bag['error'], `HTTP ${res.status}`) }
    const settings = readSettings(bag['settings'])
    if (settings !== null) adopt(settings, false)
    return { ok: true, settings }
  } catch (error) {
    return { ok: false, error: failureText(error) }
  }
}

/**
 * The panel preference, as the record detail's "Display all" toggle uses it: the value starts
 * from the settings and every toggle writes the new one back. The toggle stays usable when the
 * write fails — the failure is kept in the store and shown by the Settings tab.
 */
export function usePanelShowAll(): { showAll: boolean; setShowAll: (value: boolean) => void } {
  const snapshot = useSettings()
  return {
    showAll: snapshot.showAll,
    setShowAll: (value: boolean): void => {
      setState({ ...state, showAll: value, panelError: null })
      void putSettings({ panel: { showAll: value } }).then((result) => {
        if (!result.ok) setState({ ...state, panelError: result.error })
      })
    },
  }
}

/* ── Form state: every field a string, an empty one meaning "inherit" ──────── */

interface SearchForm {
  tier: string
  allowedHosts: string
  maxResults: string
  maxSearchesPerRecord: string
  answerMaxChars: string
  enrichPages: string
  enrichCharsPerPage: string
  synthesisProvider: string
  synthesisModel: string
  synthesisMaxTokens: string
}

/** One override leaf as the text an input shows; an absent leaf stays empty (it inherits). */
function overrideText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

/** Seed the search form from the override layer; the nested bags are read as leaves. */
function searchFormFrom(data: SettingsView): SearchForm {
  const override = data.search.override
  const enrich = isBag(override['enrich']) ? override['enrich'] : {}
  const synthesis = isBag(override['synthesis']) ? override['synthesis'] : {}
  const hosts = Array.isArray(override['allowedHosts'])
    ? override['allowedHosts'].filter((host): host is string => typeof host === 'string')
    : []
  return {
    tier: overrideText(override['tier']),
    allowedHosts: hosts.join('\n'),
    maxResults: overrideText(override['maxResults']),
    maxSearchesPerRecord: overrideText(override['maxSearchesPerRecord']),
    answerMaxChars: overrideText(override['answerMaxChars']),
    enrichPages: overrideText(enrich['pages']),
    enrichCharsPerPage: overrideText(enrich['charsPerPage']),
    synthesisProvider: overrideText(synthesis['provider']),
    synthesisModel: overrideText(synthesis['model']),
    synthesisMaxTokens: overrideText(synthesis['maxTokens']),
  }
}

/** A text input as the value to write: empty clears the override, so the layer below applies again. */
function textOrNull(entry: string): string | null {
  const trimmed = entry.trim()
  return trimmed.length === 0 ? null : trimmed
}

/** A number input as the value to write: empty (or unparsable) clears the override. */
function numberOrNull(entry: string): number | null {
  const trimmed = entry.trim()
  if (trimmed.length === 0) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/** The hosts textarea as the list to write: no lines clears the override. */
function hostListOrNull(entry: string): string[] | null {
  const hosts = entry.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  return hosts.length === 0 ? null : hosts
}

/** The whole search override as one write: every emptied field goes back to inheriting. */
function searchBody(form: SearchForm): Record<string, unknown> {
  return {
    search: {
      tier: textOrNull(form.tier),
      allowedHosts: hostListOrNull(form.allowedHosts),
      maxResults: numberOrNull(form.maxResults),
      maxSearchesPerRecord: numberOrNull(form.maxSearchesPerRecord),
      answerMaxChars: numberOrNull(form.answerMaxChars),
      enrich: {
        pages: numberOrNull(form.enrichPages),
        charsPerPage: numberOrNull(form.enrichCharsPerPage),
      },
      synthesis: {
        provider: textOrNull(form.synthesisProvider),
        model: textOrNull(form.synthesisModel),
        maxTokens: numberOrNull(form.synthesisMaxTokens),
      },
    },
  }
}

/** One format's editable generation defaults. */
interface GenForm {
  directory: string
  language: string
  compile: boolean
}

type GenFormat = 'markdown' | 'latex'

type GenForms = Record<GenFormat, GenForm>

/** The two formats in display order. */
const GEN_FORMATS: readonly GenFormat[] = ['markdown', 'latex']

function genFormsFrom(data: SettingsView): GenForms {
  return {
    markdown: { ...data.generation.markdown },
    latex: { ...data.generation.latex },
  }
}

/* ── Chrome shared by the sections ────────────────────────────────────────── */

/** One control height: the section headers keep it, so the three sections line up. */
const CONTROL_HEIGHT = 24

/** How long a "saved" marker stays on screen. */
const SAVED_MS = 1800

const cardStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l2)',
}

/** Header row of one section: title at the left, actions at the right, one control height tall. */
const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  minHeight: CONTROL_HEIGHT,
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-secondary)',
}

const inputStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  padding: '4px 8px',
  fontSize: 13,
  color: 'var(--dsw-alias-label-primary)',
  background: 'var(--dsw-specific-input-major)',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 6,
  outline: 'none',
  fontFamily: 'inherit',
}

/** Monospace variant: paths, hosts and model identifiers read better in a fixed pitch. */
const codeInputStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: 'ui-monospace, monospace',
}

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-tertiary)',
}

const errorStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-state-error-primary)',
  wordBreak: 'break-word',
}

const savedStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--dsw-alias-state-success-primary)',
}

const saveButtonStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  height: CONTROL_HEIGHT,
  padding: '0 10px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-state-business-primary)',
  background: 'none',
  color: 'var(--dsw-alias-state-business-primary)',
  cursor: 'pointer',
  fontSize: 12.5,
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

const resetButtonStyle: React.CSSProperties = {
  ...saveButtonStyle,
  border: '1px solid var(--dsw-alias-label-tertiary)',
  color: 'var(--dsw-alias-label-secondary)',
}

/** The two-column field grid of one section, collapsing to one column in a narrow panel. */
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 10,
  marginTop: 8,
}

/** A transient "saved" marker: raised by the returned callback and cleared on its own. */
function useSavedFlag(): [boolean, () => void] {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (tick === 0) return
    const timer = setTimeout(() => setTick(0), SAVED_MS)
    return () => clearTimeout(timer)
  }, [tick])
  return [tick > 0, () => setTick((value) => value + 1)]
}

/** One labelled control of a section. */
function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  )
}

/** Title + save action of one section, with the transient "saved" marker beside the button. */
function SectionHeader({ title, busy, saved, onSave }: { title: string; busy: boolean; saved: boolean; onSave: () => void }): React.JSX.Element {
  return (
    <div style={headerRowStyle}>
      <span style={sectionTitleStyle}>{title}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        {saved && <span style={savedStyle}>{t('saved')}</span>}
        <button
          type="button"
          disabled={busy}
          style={busy ? { ...saveButtonStyle, opacity: 0.4, cursor: 'default' } : saveButtonStyle}
          onClick={onSave}
        >
          {t('save')}
        </button>
      </span>
    </div>
  )
}

/** One failure line, framed by the section label it belongs to. */
function FailureLine({ message }: { message: string }): React.JSX.Element {
  return <div style={errorStyle}>{t('settingsSaveFailed', { message })}</div>
}

/* ── The tab ──────────────────────────────────────────────────────────────── */

type Section = 'generation' | 'search' | 'panel'

/**
 * The Settings tab: the generation defaults (one block per format), the search policy, and the
 * panel preference. Each section saves on its own, and every empty field of the search form is
 * written as `null`, which clears that override so the layer below applies again.
 *
 * @param active - true while the tab is the one on screen: it re-reads on the way in, since the
 *   generation dialog and the record detail's toggle write settings from the other tab.
 */
export function SettingsTab({ active }: { active: boolean }): React.JSX.Element {
  useAppLocale()
  const settings = useSettings()
  const [searchForm, setSearchForm] = useState<SearchForm | null>(null)
  const [genForms, setGenForms] = useState<GenForms | null>(null)
  const [showAllDraft, setShowAllDraft] = useState(false)
  const [busy, setBusy] = useState<Section | null>(null)
  const [saveError, setSaveError] = useState<{ section: Section; message: string } | null>(null)
  const [seeded, setSeeded] = useState(-1)
  const [mdSaved, flagMdSaved] = useSavedFlag()
  const [texSaved, flagTexSaved] = useSavedFlag()
  const [searchSaved, flagSearchSaved] = useSavedFlag()
  const [panelSaved, flagPanelSaved] = useSavedFlag()

  // Read every time the tab comes to the front: the record detail's toggle and the generation
  // dialog both write settings from the records tab, and this page must show what they wrote.
  useEffect(() => {
    if (active) void loadSettings()
  }, [active])

  // Seed every form from each read. A write's answer re-seeds only the section that wrote, so
  // unsaved edits in the other sections survive a save.
  useEffect(() => {
    if (settings.data === null || settings.loadedRevision === seeded) return
    setSeeded(settings.loadedRevision)
    setSearchForm(searchFormFrom(settings.data))
    setGenForms(genFormsFrom(settings.data))
    setShowAllDraft(settings.data.panel.showAll)
  }, [settings.data, settings.loadedRevision, seeded])

  const data = settings.data

  /** Write one section; the answer re-seeds that one section alone. */
  const saveSection = async (
    section: Section,
    body: Record<string, unknown>,
    reseed: (view: SettingsView) => void,
    flagSaved: () => void,
  ): Promise<void> => {
    setBusy(section)
    setSaveError(null)
    const result = await putSettings(body)
    setBusy(null)
    if (!result.ok) {
      setSaveError({ section, message: result.error })
      return
    }
    if (result.settings !== null) reseed(result.settings)
    flagSaved()
  }

  const saveGeneration = (format: GenFormat): void => {
    const form = genForms?.[format]
    if (form === undefined) return
    const body = {
      generation: {
        format,
        directory: form.directory.trim(),
        language: form.language,
        // PDF compilation is LaTeX-only: Markdown has no such step to remember.
        ...(format === 'latex' ? { compile: form.compile } : {}),
      },
    }
    void saveSection('generation', body, (view) => {
      setGenForms((prev) => (prev === null ? prev : { ...prev, [format]: { ...view.generation[format] } }))
    }, format === 'latex' ? flagTexSaved : flagMdSaved)
  }

  const saveSearch = (): void => {
    if (searchForm === null) return
    void saveSection('search', searchBody(searchForm), (view) => {
      setSearchForm(searchFormFrom(view))
    }, flagSearchSaved)
  }

  /** Clear every override: the preset row (or the code defaults) decides the policy again. */
  const resetSearch = (): void => {
    void saveSection('search', { search: null }, (view) => {
      setSearchForm(searchFormFrom(view))
    }, flagSearchSaved)
  }

  const savePanel = (): void => {
    void saveSection('panel', { panel: { showAll: showAllDraft } }, (view) => {
      setShowAllDraft(view.panel.showAll)
    }, flagPanelSaved)
  }

  if (data === null) {
    return (
      <div style={cardStyle}>
        {settings.error === null
          // Loading: the card is empty for a moment, so the panel keeps one stable block height.
          ? <div style={{ minHeight: CONTROL_HEIGHT }} />
          : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-state-error-primary)', wordBreak: 'break-word' }}>
                {t('settingsLoadFailed', { message: settings.error })}
              </span>
              <GhostButton onClick={() => void loadSettings()}>{t('retry')}</GhostButton>
            </div>
          )}
      </div>
    )
  }

  const search = data.search
  const effective = search.effective
  const generationError = saveError?.section === 'generation' ? saveError.message : null
  const searchError = saveError?.section === 'search' ? saveError.message : null
  const panelError = saveError?.section === 'panel' ? saveError.message : settings.panelError

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* A refresh that failed keeps the last view on screen; the line says so instead of hiding it. */}
      {settings.error !== null && (
        <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-state-error-primary)', wordBreak: 'break-word' }}>
            {t('settingsLoadFailed', { message: settings.error })}
          </span>
          <GhostButton onClick={() => void loadSettings()}>{t('retry')}</GhostButton>
        </div>
      )}

      {/* The one fact that no other line can carry: something was written that only a new process reads. */}
      {data.restartRequired && (
        <div style={{ ...cardStyle, borderColor: 'var(--dsw-alias-state-warn-primary)', color: 'var(--dsw-alias-state-warn-primary)', fontSize: 12.5, lineHeight: 1.5 }}>
          {t('settingsRestartNeeded')}
        </div>
      )}

      {/* Generation: one block per format, saved on its own. */}
      <div style={cardStyle}>
        <div style={{ ...headerRowStyle, justifyContent: 'flex-start' }}>
          <span style={sectionTitleStyle}>{t('settingsGeneration')}</span>
        </div>
        <div style={{ ...hintStyle, marginTop: 4 }}>{t('settingsGenerationHint')}</div>
        {generationError !== null && <FailureLine message={generationError} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          {GEN_FORMATS.map((format) => {
            const form = genForms?.[format]
            if (form === undefined) return null
            return (
              // One block per format inside the section card: the tinted fill keeps the nesting legible.
              <div key={format} style={{ ...cardStyle, background: 'var(--dsw-alias-bg-layer-1, transparent)' }}>
                <SectionHeader
                  title={format === 'latex' ? 'LaTeX' : 'Markdown'}
                  busy={busy !== null}
                  saved={format === 'latex' ? texSaved : mdSaved}
                  onSave={() => saveGeneration(format)}
                />
                <div style={gridStyle}>
                  <Field label={t('directory')}>
                    <input
                      type="text"
                      value={form.directory}
                      placeholder="/path/to/output"
                      onChange={(event) => setGenForms((prev) => (prev === null ? prev : { ...prev, [format]: { ...form, directory: event.target.value } }))}
                      style={codeInputStyle}
                    />
                  </Field>
                  <Field label={t('language')}>
                    <select
                      value={form.language}
                      onChange={(event) => setGenForms((prev) => (prev === null ? prev : { ...prev, [format]: { ...form, language: event.target.value } }))}
                      style={inputStyle}
                    >
                      <option value="auto">{t('languageAuto')}</option>
                      <option value="zh-CN">{t('languageZh')}</option>
                      <option value="en">{t('languageEn')}</option>
                    </select>
                  </Field>
                </div>
                {format === 'latex' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={form.compile}
                      onChange={(event) => setGenForms((prev) => (prev === null ? prev : { ...prev, [format]: { ...form, compile: event.target.checked } }))}
                      style={{ accentColor: 'var(--dsw-alias-state-business-primary)' }}
                    />
                    {t('compilePdf')}
                  </label>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Search: the policy as three named layers; the placeholder is the value in force. */}
      <div style={cardStyle}>
        <div style={headerRowStyle}>
          <span style={sectionTitleStyle}>{t('searchLabel')}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: 'none' }}>
            {searchSaved && <span style={savedStyle}>{t('saved')}</span>}
            <button
              type="button"
              disabled={busy !== null}
              style={busy !== null ? { ...resetButtonStyle, opacity: 0.4, cursor: 'default' } : resetButtonStyle}
              onClick={resetSearch}
            >
              {t('resetSearchOverrides')}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              style={busy !== null ? { ...saveButtonStyle, opacity: 0.4, cursor: 'default' } : saveButtonStyle}
              onClick={saveSearch}
            >
              {t('save')}
            </button>
          </span>
        </div>
        <div style={{ ...hintStyle, marginTop: 4 }}>{t('searchHintLayers')}</div>
        <div style={{ ...hintStyle, marginTop: 2 }}>{t('searchHintPlaceholder')}</div>
        {searchError !== null && <FailureLine message={searchError} />}
        {searchForm !== null && (
          <>
            <div style={gridStyle}>
              <Field label={t('tierLabel')}>
                <select
                  value={searchForm.tier}
                  onChange={(event) => setSearchForm({ ...searchForm, tier: event.target.value })}
                  style={inputStyle}
                >
                  <option value="">{t('tierInherit', { value: effective.tier })}</option>
                  <option value="strict">{t('tierStrict')}</option>
                  <option value="open">{t('tierOpen')}</option>
                </select>
              </Field>
              <Field label={t('maxResults')}>
                <input
                  type="number"
                  min={1}
                  value={searchForm.maxResults}
                  placeholder={String(effective.maxResults)}
                  onChange={(event) => setSearchForm({ ...searchForm, maxResults: event.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label={t('maxSearchesPerRecord')}>
                <input
                  type="number"
                  min={1}
                  value={searchForm.maxSearchesPerRecord}
                  placeholder={String(effective.maxSearchesPerRecord)}
                  onChange={(event) => setSearchForm({ ...searchForm, maxSearchesPerRecord: event.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label={t('answerMaxChars')}>
                <input
                  type="number"
                  min={1}
                  value={searchForm.answerMaxChars}
                  placeholder={String(effective.answerMaxChars)}
                  onChange={(event) => setSearchForm({ ...searchForm, answerMaxChars: event.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label={t('enrichPages')}>
                <input
                  type="number"
                  min={0}
                  value={searchForm.enrichPages}
                  placeholder={String(effective.enrich.pages)}
                  onChange={(event) => setSearchForm({ ...searchForm, enrichPages: event.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label={t('enrichCharsPerPage')}>
                <input
                  type="number"
                  min={0}
                  value={searchForm.enrichCharsPerPage}
                  placeholder={String(effective.enrich.charsPerPage)}
                  onChange={(event) => setSearchForm({ ...searchForm, enrichCharsPerPage: event.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label={t('synthesisProvider')}>
                <input
                  type="text"
                  value={searchForm.synthesisProvider}
                  placeholder={effective.synthesis.provider ?? t('deploymentDefault')}
                  onChange={(event) => setSearchForm({ ...searchForm, synthesisProvider: event.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label={t('synthesisModel')}>
                <input
                  type="text"
                  value={searchForm.synthesisModel}
                  placeholder={effective.synthesis.model ?? t('deploymentDefault')}
                  onChange={(event) => setSearchForm({ ...searchForm, synthesisModel: event.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label={t('synthesisMaxTokens')}>
                <input
                  type="number"
                  min={1}
                  value={searchForm.synthesisMaxTokens}
                  placeholder={String(effective.synthesis.maxTokens)}
                  onChange={(event) => setSearchForm({ ...searchForm, synthesisMaxTokens: event.target.value })}
                  style={inputStyle}
                />
              </Field>
            </div>
            <div style={{ marginTop: 10 }}>
              <Field label={t('allowedHosts')}>
                <textarea
                  rows={5}
                  value={searchForm.allowedHosts}
                  placeholder={effective.allowedHosts.join('\n')}
                  onChange={(event) => setSearchForm({ ...searchForm, allowedHosts: event.target.value })}
                  style={{ ...codeInputStyle, resize: 'vertical' }}
                />
              </Field>
              <div style={{ ...hintStyle, marginTop: 4 }}>{t('allowedHostsHint')}</div>
            </div>
          </>
        )}
      </div>

      {/* Panel: the preference the record detail's "Display all" toggle also writes. */}
      <div style={cardStyle}>
        <SectionHeader
          title={t('settingsPanel')}
          busy={busy !== null}
          saved={panelSaved}
          onSave={savePanel}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12.5, color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showAllDraft}
            onChange={(event) => setShowAllDraft(event.target.checked)}
            style={{ accentColor: 'var(--dsw-alias-state-business-primary)' }}
          />
          {t('showAllDefault')}
        </label>
        <div style={{ ...hintStyle, marginTop: 4 }}>{t('showAllHint')}</div>
        {panelError !== null && <FailureLine message={panelError} />}
      </div>
    </div>
  )
}
