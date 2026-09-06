/**
 * Generation UI: the format setup dialog (language / output directory with
 * the host-driven directory browser / file name / optional PDF compile) and
 * the body-level generation overlay (progress dialog + minimized pill). The
 * running job itself lives in the module-level generation store so it
 * survives navigation; the overlay is mounted by panel.tsx into a
 * body-level React root.
 */
import { useEffect, useRef, useState } from 'react'
import { t, useAppLocale, type LocaleKey } from './locales.ts'
import { Dialog, GhostButton, PrimaryButton } from './ui.tsx'
import { IconArrowUp, IconFile, IconFolder, IconMinus } from './icons.tsx'
import { useGenState, startGenerate, cancelGenerate, clearProgress, setMinimized } from './generation.ts'
import { ArticleFormat, ArticleLanguage, GenerationPhase } from '../generate.ts'

const GENERATE_DIR_ENDPOINT = '/api/dsh-electro-lab/generate-dir'
const REVEAL_ENDPOINT = '/api/dsh-electro-lab/reveal'
const LIST_DIRS_ENDPOINT = '/api/dsh-electro-lab/list-dirs'
const LIST_ROOTS_ENDPOINT = '/api/dsh-electro-lab/list-roots'

/* ── Small shared bits ─────────────────────────────────────────────────────── */

/** Text input inside the generation setup dialog. */
const genInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '6px 8px',
  fontSize: 13,
  color: 'var(--dsw-alias-label-primary)',
  background: 'var(--dsw-specific-input-major)',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 6,
  outline: 'none',
  fontFamily: 'ui-monospace, monospace',
}

/** Dropdown inside the generation setup dialog. */
const genSelectStyle: React.CSSProperties = {
  flex: 1,
  padding: '6px 8px',
  fontSize: 13,
  color: 'var(--dsw-alias-label-primary)',
  background: 'var(--dsw-specific-input-major)',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 6,
}

/** Map a generation phase code to its translated label. */
function genPhaseKey(phase: GenerationPhase): LocaleKey | string {
  switch (phase) {
    case GenerationPhase.Prepare: return 'phasePrepare'
    case GenerationPhase.Generate: return 'phaseGenerate'
    case GenerationPhase.Write: return 'phaseWrite'
    case GenerationPhase.Compile: return 'phaseCompile'
  }
}

/** mm:ss elapsed-time display. */
function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** Parse the remembered/typed language from its raw string (unknown values → undefined). */
function parseArticleLanguage(value: string | undefined): ArticleLanguage | undefined {
  switch (value) {
    case ArticleLanguage.Auto:
    case ArticleLanguage.ZhCN:
    case ArticleLanguage.En:
      return value
    default:
      return undefined
  }
}

/** The file extension for an output format. */
function formatExtension(format: ArticleFormat): string {
  switch (format) {
    case ArticleFormat.Latex: return 'tex'
    case ArticleFormat.Markdown: return 'md'
  }
}

/* ── Directory browser state (one node of the lazily loaded host tree) ─────── */

interface DirEntry {
  name: string
  type: 'directory' | 'file'
  absolutePath: string
  children?: DirEntry[]
}

/* ── Generation setup dialog ──────────────────────────────────────────────── */

/**
 * The setup dialog for one format (the dialog never switches formats — the
 * caller picks Markdown or LaTeX by which button opened it).
 */
export function GenerationSetupDialog({ open, format, recordId, onClose }: {
  open: boolean
  format: ArticleFormat
  recordId: string
  onClose: () => void
}): React.JSX.Element | null {
  useAppLocale()
  const [genDir, setGenDir] = useState('')
  const [genLanguage, setGenLanguage] = useState<ArticleLanguage>(ArticleLanguage.Auto)
  const [genCompile, setGenCompile] = useState(false)
  const [genFile, setGenFile] = useState('')
  const [genSetupError, setGenSetupError] = useState<string | null>(null)
  const { progress: genProgress } = useGenState()
  const genRunning = genProgress?.status === 'running'
  const [dirBrowserOpen, setDirBrowserOpen] = useState(false)
  const [dirEntries, setDirEntries] = useState<DirEntry[]>([])
  const [dirExpanded, setDirExpanded] = useState<Set<string>>(new Set())
  const [dirSelected, setDirSelected] = useState('')
  const [dirLoading, setDirLoading] = useState(false)
  const [dirSnapshot, setDirSnapshot] = useState<{ dir: string; file: string } | null>(null)
  const treeListRef = useRef<HTMLDivElement>(null)

  // Auto-fill the remembered generation settings whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    let alive = true
    fetch(GENERATE_DIR_ENDPOINT)
      .then((r) => r.json() as Promise<{ directory?: string; language?: string; compile?: boolean }>)
      .then((body) => {
        if (!alive) return
        if (body.directory !== undefined && body.directory !== '') setGenDir(body.directory)
        const language = parseArticleLanguage(body.language)
        if (language !== undefined) setGenLanguage(language)
        if (typeof body.compile === 'boolean') setGenCompile(body.compile)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [open])

  /** Default file name placeholder of the dialog. */
  const defaultFileName = `electro-lab-${recordId.slice(0, 8)}.${formatExtension(format)}`

  /** Persist the directory, language and PDF-compile toggle so the next dialog auto-fills them. */
  const saveGenState = (): void => {
    const dir = genDir.trim()
    const params = new URLSearchParams()
    if (dir.length > 0) params.set('dir', dir)
    params.set('language', genLanguage)
    params.set('compile', String(genCompile))
    void fetch(`${GENERATE_DIR_ENDPOINT}?${params.toString()}`, { method: 'PUT' }).catch(() => {})
  }

  const closeDialog = (): void => {
    saveGenState()
    setGenSetupError(null)
    onClose()
  }

  /** Ask the host to generate the article (LLM) and write it to disk. */
  const runGenerate = (): void => {
    const dir = genDir.trim()
    if (dir.length === 0) {
      setGenSetupError(t('directoryRequired'))
      return
    }
    setGenSetupError(null)
    saveGenState()
    onClose()
    startGenerate({
      recordId,
      format,
      language: genLanguage,
      directory: dir,
      fileName: genFile.trim(),
      compile: genCompile,
    })
  }

  /** Load one directory's subdirectories AND files through the host (pure HTTP). */
  const loadDirListing = async (path: string): Promise<{ path: string; entries: string[]; files: string[]; parent: string }> => {
    const res = await fetch(`${LIST_DIRS_ENDPOINT}?path=${encodeURIComponent(path)}`)
    if (!res.ok) throw new Error(`list-dirs returned ${res.status}`)
    const body = (await res.json()) as { path?: string; entries?: string[]; files?: string[]; parent?: string }
    return { path: body.path ?? path, entries: body.entries ?? [], files: body.files ?? [], parent: body.parent ?? '' }
  }

  /** Immutably attach lazily loaded children to one node in the tree. */
  const attachChildren = (nodes: DirEntry[], path: string, children: DirEntry[]): DirEntry[] =>
    nodes.map((node) => {
      if (node.absolutePath === path) return { ...node, children }
      if (node.children !== undefined) return { ...node, children: attachChildren(node.children, path, children) }
      return node
    })

  /** Find one entry by absolute path (depth-first over the loaded tree). */
  const findEntry = (nodes: DirEntry[], path: string): DirEntry | undefined => {
    for (const node of nodes) {
      if (node.absolutePath === path) return node
      if (node.children !== undefined) {
        const found = findEntry(node.children, path)
        if (found !== undefined) return found
      }
    }
    return undefined
  }

  /** Open the directory browser at the current output directory. */
  const openDirBrowser = async (): Promise<void> => {
    try {
      const res = await fetch(LIST_ROOTS_ENDPOINT)
      if (!res.ok) throw new Error(`list-roots returned ${res.status}`)
      const body = (await res.json()) as { roots?: string[] }
      const roots = body.roots ?? []
      if (roots.length === 0) return
      let tree: DirEntry[] = roots.map((root) => ({ name: root, type: 'directory', absolutePath: root }))
      const expanded = new Set<string>()
      const current = genDir.trim()
      setDirSelected(current)
      setDirSnapshot({ dir: genDir, file: genFile })
      setDirBrowserOpen(true)

      // Walk UP from the current directory to a root, then expand the chain
      // top-down so the current directory is visible and selected.
      if (current.length > 0) {
        const chain: Array<{ path: string; parent: string }> = []
        let probe = current
        try {
          for (;;) {
            const snap = await loadDirListing(probe)
            chain.push({ path: snap.path, parent: snap.parent })
            if (snap.parent === snap.path) break
            probe = snap.parent
          }
        } catch {
          chain.length = 0
        }
        for (const item of [...chain].reverse()) {
          if (item.parent === item.path) continue
          try {
            const { entries, files } = await loadDirListing(item.parent)
            const base = item.parent.replace(/[\\/]+$/, '')
            const children: DirEntry[] = [
              ...entries.map((name) => ({ name, type: 'directory' as const, absolutePath: `${base}/${name}` })),
              ...files.map((name) => ({ name, type: 'file' as const, absolutePath: `${base}/${name}` })),
            ]
            tree = attachChildren(tree, item.parent, children)
            expanded.add(item.parent)
          } catch {
            // skip this level
          }
        }
        setDirSelected(current)
      }
      setDirEntries(tree)
      setDirExpanded(expanded)
      setDirLoading(false)
      if (current.length > 0) {
        setTimeout(() => {
          treeListRef.current?.querySelector(`[data-path="${CSS.escape(current)}"]`)?.scrollIntoView({ block: 'start' })
        }, 0)
      }
    } catch (error) {
      window.alert(`Cannot browse directories: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Navigate the browser up one level. */
  const goUpLevel = async (): Promise<void> => {
    const current = dirSelected.trim()
    if (current.length === 0) return
    let parent: string
    try {
      parent = (await loadDirListing(current)).parent
    } catch {
      return
    }
    if (parent === current) return
    const parentNode = findEntry(dirEntries, parent)
    if (parentNode === undefined) return
    if (parentNode.children === undefined) {
      try {
        const { entries, files } = await loadDirListing(parent)
        const base = parent.replace(/[\\/]+$/, '')
        const children: DirEntry[] = [
          ...entries.map((name) => ({ name, type: 'directory' as const, absolutePath: `${base}/${name}` })),
          ...files.map((name) => ({ name, type: 'file' as const, absolutePath: `${base}/${name}` })),
        ]
        setDirEntries((prev) => attachChildren(prev, parent, children))
      } catch {
        return
      }
    }
    setDirExpanded((prev) => new Set(prev).add(parent))
    setDirSelected(parent)
    setGenDir(parent)
    setTimeout(() => {
      treeListRef.current?.querySelector(`[data-path="${CSS.escape(parent)}"]`)?.scrollIntoView({ block: 'start' })
    }, 0)
  }

  /** Click a tree row: directories lazily load + toggle expand; files fill the name + its directory. */
  const onDirClick = async (node: DirEntry): Promise<void> => {
    setDirSelected(node.absolutePath)
    if (node.type === 'file') {
      const parent = node.absolutePath.slice(0, node.absolutePath.lastIndexOf('/') + 1) || node.absolutePath
      setGenDir(parent)
      setGenFile(node.name)
      return
    }
    setGenDir(node.absolutePath)
    if (node.children === undefined) {
      setDirLoading(true)
      try {
        const { entries, files } = await loadDirListing(node.absolutePath)
        const base = node.absolutePath.replace(/[\\/]+$/, '')
        const children: DirEntry[] = [
          ...entries.map((name) => ({ name, type: 'directory' as const, absolutePath: `${base}/${name}` })),
          ...files.map((name) => ({ name, type: 'file' as const, absolutePath: `${base}/${name}` })),
        ]
        setDirEntries((prev) => attachChildren(prev, node.absolutePath, children))
      } catch (error) {
        window.alert(`Cannot browse directories: ${error instanceof Error ? error.message : String(error)}`)
        setDirLoading(false)
        return
      }
      setDirLoading(false)
    }
    setDirExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(node.absolutePath)) next.delete(node.absolutePath)
      else next.add(node.absolutePath)
      return next
    })
  }

  /** Recursive tree node renderer (flat state: entries tree + expanded set). */
  const renderDirNode = (node: DirEntry, depth: number): React.JSX.Element => {
    const expanded = dirExpanded.has(node.absolutePath)
    const isSelected = dirSelected === node.absolutePath
    const isDir = node.type === 'directory'
    return (
      <div key={node.absolutePath} data-path={node.absolutePath}>
        <div
          role="button"
          className="directory-tree-entry flex items-center cursor-pointer relative select-none text-xs leading-tight w-full"
          style={{
            paddingLeft: 8 + depth * 14,
            paddingRight: 8,
            height: 26,
            gap: 4,
            color: 'var(--dsw-alias-label-primary)',
            background: isSelected ? 'var(--dsw-alias-interactive-bg-active)' : 'none',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
          onClick={() => void onDirClick(node)}
          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)' }}
          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'none' }}
        >
          <span className="directory-tree-expand-icon w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center" style={{ color: 'var(--dsw-alias-label-secondary)' }}>
            {isDir ? (expanded ? '▾' : '▸') : ''}
          </span>
          <span className="directory-tree-type-icon w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center">
            {isDir ? <IconFolder size={14} /> : <IconFile size={14} />}
          </span>
          <span className="directory-tree-name flex-1 min-w-0" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {node.name}
          </span>
        </div>
        {isDir && expanded && node.children !== undefined && node.children.map((child) => renderDirNode(child, depth + 1))}
      </div>
    )
  }

  /** Cancel the browse: revert the setup fields to their pre-browse values and close. */
  const closeDirBrowser = (): void => {
    if (dirSnapshot !== null) {
      setGenDir(dirSnapshot.dir)
      setGenFile(dirSnapshot.file)
    }
    setDirBrowserOpen(false)
  }

  if (!open) return null

  /** One label span of the setup grid (fixed label column). */
  const setupLabel = (text: string): React.JSX.Element => (
    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)', textAlign: 'left' }}>{text}</span>
  )

  return (
    <>
      <Dialog
        open
        title={format === ArticleFormat.Markdown ? t('generateSetupMarkdown') : t('generateSetupLatex')}
        width={430}
        onClose={closeDialog}
        footer={[
          <GhostButton key="cancel" onClick={closeDialog}>{t('cancel')}</GhostButton>,
          <PrimaryButton key="generate" disabled={genRunning} onClick={runGenerate}>{t('generate')}</PrimaryButton>,
        ]}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '104px 1fr', gap: '12px 10px', alignItems: 'center' }}>
          {setupLabel(t('language'))}
          <select
            value={genLanguage}
            onChange={(e) => {
              const language = parseArticleLanguage(e.target.value)
              if (language !== undefined) setGenLanguage(language)
            }}
            style={{ ...genSelectStyle }}
          >
            <option value="auto">{t('languageAuto')}</option>
            <option value="zh-CN">{t('languageZh')}</option>
            <option value="en">{t('languageEn')}</option>
          </select>
          {setupLabel(t('directory'))}
          <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
            <input
              type="text"
              value={genDir}
              onChange={(e) => { setGenDir(e.target.value); if (genSetupError !== null) setGenSetupError(null) }}
              placeholder="/path/to/output"
              style={{ ...genInputStyle }}
            />
            <GhostButton onClick={() => void openDirBrowser()}>{t('browse')}</GhostButton>
          </div>
          {setupLabel(t('fileName'))}
          <input
            type="text"
            value={genFile}
            onChange={(e) => setGenFile(e.target.value)}
            placeholder={defaultFileName}
            style={{ ...genInputStyle }}
          />
          {format === ArticleFormat.Latex && setupLabel(t('compilePdf'))}
          {format === ArticleFormat.Latex && (
            <input
              type="checkbox"
              checked={genCompile}
              onChange={(e) => setGenCompile(e.target.checked)}
              style={{ width: 14, height: 14, accentColor: 'var(--dsw-alias-state-business-primary)', cursor: 'pointer' }}
            />
          )}
        </div>
        {genSetupError !== null && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' }}>{genSetupError}</div>
        )}
      </Dialog>
      <Dialog
        open={dirBrowserOpen}
        title={t('browseDirectory')}
        width={440}
        height={420}
        onClose={closeDirBrowser}
        footer={[
          <GhostButton key="cancel" onClick={closeDirBrowser}>{t('cancel')}</GhostButton>,
          <PrimaryButton key="confirm" onClick={() => setDirBrowserOpen(false)}>{t('confirm')}</PrimaryButton>,
        ]}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
          <button
            type="button"
            title={t('upLevel')}
            onClick={() => void goUpLevel()}
            style={{
              width: 30,
              height: 30,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              border: 'none',
              background: 'none',
              color: 'var(--dsw-alias-label-secondary)',
              cursor: 'pointer',
            }}
          >
            <IconArrowUp size={18} />
          </button>
          <div style={{ font: '12px ui-monospace, monospace', color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {dirSelected}
          </div>
        </div>
        <div ref={treeListRef} style={{ marginTop: 8, flex: 1, minHeight: 0, overflowY: 'auto', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '4px 0' }}>
          {dirLoading && (
            <div style={{ padding: '4px 8px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>…</div>
          )}
          {dirEntries.map((node) => renderDirNode(node, 0))}
        </div>
      </Dialog>
    </>
  )
}

/* ── Global generation overlay ─────────────────────────────────────────────── */

/** Reveal a generated file in the OS file manager, or open it with its default application. */
async function launchPath(path: string, action: 'open' | 'reveal'): Promise<void> {
  try {
    const res = await fetch(`${REVEAL_ENDPOINT}?path=${encodeURIComponent(path)}&action=${action}`, { method: 'POST' })
    const body = (await res.json()) as { result?: string }
    if (!res.ok || body.result !== 'ok') throw new Error(body.result ?? `reveal returned ${res.status}`)
  } catch (error) {
    window.alert(`Cannot open: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * The generation overlay: the progress dialog and the minimized status pill,
 * rendered in a body-level React root (panel.tsx). Driven by the module-level
 * generation store, so a running job survives any navigation.
 */
export function GenerationOverlay(): React.JSX.Element | null {
  useAppLocale()
  const [minimizeHover, setMinimizeHover] = useState(false)
  const { progress, minimized, elapsed } = useGenState()
  if (progress === null) return null
  return (
    <div
      style={{
        font: '13px/1.5 var(--dsw-font-family, ui-sans-serif, system-ui, sans-serif)',
        color: 'var(--dsw-alias-label-primary)',
      }}
    >
      {!minimized && (
        <Dialog
          open
          title={progress.status === 'done' ? t('generateDone') : progress.status === 'error' ? t('generateFailed') : t('generating')}
          width={380}
          height={190}
          dismissible={false}
          onClose={() => {}}
          headerRight={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
              <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' }}>{formatElapsed(elapsed)}</div>
              {progress.status === 'running' && (
                <button
                  type="button"
                  title={t('minimize')}
                  aria-label={t('minimize')}
                  onClick={() => setMinimized(true)}
                  onMouseEnter={() => setMinimizeHover(true)}
                  onMouseLeave={() => setMinimizeHover(false)}
                  style={{
                    width: 28,
                    height: 28,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 6,
                    border: 'none',
                    background: minimizeHover ? 'var(--dsw-alias-interactive-bg-hover)' : 'none',
                    color: minimizeHover ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <IconMinus size={16} />
                </button>
              )}
            </div>
          }
          footer={[
            progress.status === 'running' && (
              <GhostButton key="cancel" onClick={cancelGenerate}>{t('cancel')}</GhostButton>
            ),
            progress.status === 'done' && progress.path !== undefined && (
              <>
                <GhostButton key="openfile" onClick={() => void launchPath(progress.pdfPath ?? progress.path!, 'open')}>{t('openFile')}</GhostButton>
                <GhostButton key="opendir" onClick={() => void launchPath(progress.path!, 'reveal')}>{t('openDirectory')}</GhostButton>
              </>
            ),
            <PrimaryButton key="confirm" disabled={progress.status === 'running'} onClick={clearProgress}>
              {t('confirm')}
            </PrimaryButton>,
          ].filter(Boolean)}
        >
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <div style={{ margin: 'auto', width: '100%', textAlign: 'center' }}>
              {progress.status === 'running' && (
                <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-primary)', fontWeight: 600 }}>
                  {t(genPhaseKey(progress.phase))}
                </div>
              )}
              {progress.status === 'done' && (
                <>
                  <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all' }}>
                    {t('generatedAt')} {progress.path ?? ''}
                  </div>
                  {progress.pdfPath !== undefined && (
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all' }}>
                      {t('generatedPdfAt')} {progress.pdfPath}
                    </div>
                  )}
                  {progress.compileError !== undefined && progress.pdfPath === undefined && (
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {t('compileFailed')} {progress.compileError}
                    </div>
                  )}
                </>
              )}
              {progress.status === 'error' && (
                <div style={{ fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {progress.error ?? 'unknown error'}
                </div>
              )}
            </div>
          </div>
        </Dialog>
      )}
      {minimized && (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          title={progress.status === 'running' ? t('generating') : progress.status === 'error' ? t('generateFailed') : t('generateDone')}
          style={{
            position: 'fixed',
            right: 16,
            bottom: 16,
            zIndex: 90,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            borderRadius: 8,
            background: 'var(--dsw-alias-bg-layer-2)',
            border: '1px solid var(--dsw-alias-border-l2)',
            boxShadow: 'var(--dsw-shadow-lv3)',
            fontSize: 13,
            color: 'var(--dsw-alias-label-primary)',
            cursor: 'pointer',
            pointerEvents: 'auto',
          }}
        >
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            flex: 'none',
            background: progress.status === 'error'
              ? 'var(--dsw-alias-state-error-primary)'
              : progress.status === 'done'
                ? 'var(--dsw-alias-state-success-primary)'
                : 'var(--dsw-alias-label-secondary)',
          }} />
          <span>
            {progress.status === 'done' ? t('generateDone') : progress.status === 'error' ? t('generateFailed') : t('generating')}
          </span>
          {progress.status === 'running' && (
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-secondary)' }}>{formatElapsed(elapsed)}</span>
          )}
        </button>
      )}
    </div>
  )
}
