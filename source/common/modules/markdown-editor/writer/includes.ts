/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Inline include previews
 * CVM-Role:        CodeMirror Extension
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Shows the contents of every structural include (an embed
 *                  of a Markdown file alone on its line at the top level)
 *                  directly below the include line, in both raw and preview
 *                  mode, so a manuscript root reads like one document.
 *                  Clicking a preview swaps it for a full nested editor on
 *                  the included file. That editor talks to the same document
 *                  authority as the tabs, so edits stay in sync with any open
 *                  tab and are saved like any other edit. Nested editors
 *                  render their own includes; cycles and the depth cap are
 *                  enforced as in the manuscript tree.
 *
 * END HEADER
 */

import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { configField, type EditorConfigOptions } from '../util/configuration'
import { editorMetadataFacet } from '../plugins/editor-metadata'
import { documentAuthorityIPCAPI } from '../util/ipc-api'
import MarkdownEditor from '..'
import { matchEmbedTarget } from '@common/util/match-embed-target'
import { md2html } from '@common/modules/markdown-utils/markdown-to-html'
import { sanitizeHTML } from '@common/util/sanitize-html'
import makeValidUri from '@common/util/make-valid-uri'
import { pathDirname } from '@common/util/renderer-path-polyfill'
import { trans } from '@common/i18n-renderer'
import { CITEPROC_MAIN_DB } from '@dts/common/citeproc'
import type { ForceOpenAPI } from 'source/app/service-providers/commands/force-open'

const ipcRenderer = window.ipc

/**
 * Maximum include depth (file levels below the root), as in the manuscript
 * tree. Deeper includes are shown as errors.
 */
const MAX_INCLUDE_DEPTH = 8

/**
 * An inline editor on an included file. It outlives the widget that shows
 * it: CodeMirror destroys block widgets that scroll far out of the viewport,
 * so the session is parked (detached, but alive with its cursor and undo
 * history) and re-attached when the include scrolls back into view. It is
 * only disposed once its include line is gone or the outer editor closes.
 */
interface IncludeSession {
  /**
   * Identifies the include within the outer editor (see `includeKey`)
   */
  key: string
  editor: MarkdownEditor
  resolvedPath: string
  name: string
  meta: string
  dirty: boolean
  attached: boolean
  /**
   * Whether the user was typing in it when it was last attached. Detaching
   * drops the DOM focus, so it is restored on re-attach.
   */
  focused: boolean
}

/**
 * All sessions per outer editor view, keyed by include key.
 */
const sessionsByView = new WeakMap<EditorView, Map<string, IncludeSession>>()

/**
 * How many sessions (across all views) currently hold each file, so a file
 * is only released by the document provider once no session needs it.
 */
const sessionRefs = new Map<string, number>()

/**
 * The last rendered height per include, so CodeMirror can reserve the right
 * space for includes outside the viewport (avoids scroll jumps).
 */
const heightCache = new Map<string, number>()

/**
 * All live controllers, refreshed when the writer index changes (i.e. after
 * a file has been saved or changed on disk).
 */
const liveControllers = new Set<IncludeController>()
let stopIndexListener: (() => void)|undefined

/**
 * Maps a widget's DOM to its controller, so the widget can destroy it.
 */
const controllerByDom = new WeakMap<HTMLElement, IncludeController>()

/**
 * Identifies an include within its outer editor. The same file can be
 * included more than once; `occurrence` tells those apart.
 */
function includeKey (sourcePath: string, ancestors: string[], target: string, occurrence: number): string {
  return [ ...ancestors, sourcePath, target, String(occurrence) ].join('\u0000')
}

function getSessions (view: EditorView): Map<string, IncludeSession> {
  let sessions = sessionsByView.get(view)
  if (sessions === undefined) {
    sessions = new Map()
    sessionsByView.set(view, sessions)
  }
  return sessions
}

/**
 * Tears a session down for good: saves pending edits and lets the document
 * provider drop the file unless a tab or another session still uses it.
 */
function disposeSession (view: EditorView, session: IncludeSession): void {
  sessionsByView.get(view)?.delete(session.key)
  session.editor.unmount()

  const refs = (sessionRefs.get(session.resolvedPath) ?? 1) - 1
  if (refs > 0) {
    sessionRefs.set(session.resolvedPath, refs)
    if (session.dirty) {
      saveFile(session.resolvedPath)
    }
    return
  }

  sessionRefs.delete(session.resolvedPath)
  // Saves first if the file has unsaved changes
  ipcRenderer.invoke('documents-provider', {
    command: 'release-document',
    payload: { path: session.resolvedPath }
  }).catch(err => console.error(err))
}

function saveFile (filePath: string): void {
  ipcRenderer.invoke('documents-provider', {
    command: 'save-file',
    payload: { path: filePath }
  }).catch(err => console.error(err))
}

function registerController (controller: IncludeController): void {
  liveControllers.add(controller)
  if (stopIndexListener === undefined) {
    stopIndexListener = ipcRenderer.on('writer-index', () => {
      for (const c of liveControllers) {
        c.refresh()
      }
    })
  }
}

function unregisterController (controller: IncludeController): void {
  liveControllers.delete(controller)
  if (liveControllers.size === 0 && stopIndexListener !== undefined) {
    stopIndexListener()
    stopIndexListener = undefined
  }
}

/**
 * Manages one include block: resolution, the read-only preview, and
 * attaching the include's editing session once the user clicks into the
 * preview.
 */
class IncludeController {
  readonly dom: HTMLDivElement
  private readonly header: HTMLDivElement
  private readonly nameElement: HTMLSpanElement
  private readonly metaElement: HTMLSpanElement
  private readonly body: HTMLDivElement
  private readonly resizeObserver: ResizeObserver
  private resolvedPath: string|undefined
  private session: IncludeSession|undefined
  private destroyed: boolean
  private refreshToken: number

  constructor (
    private readonly view: EditorView,
    private readonly sourcePath: string,
    private readonly target: string,
    private readonly ancestors: string[],
    private readonly key: string
  ) {
    this.destroyed = false
    this.refreshToken = 0

    this.dom = document.createElement('div')
    this.dom.className = 'cm-writer-include'

    this.header = document.createElement('div')
    this.header.className = 'cm-writer-include-header'
    this.nameElement = document.createElement('span')
    this.nameElement.className = 'cm-writer-include-name'
    this.nameElement.textContent = target
    this.nameElement.title = trans('Open in a tab')
    this.nameElement.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      this.openInTab()
    })
    this.metaElement = document.createElement('span')
    this.metaElement.className = 'cm-writer-include-meta'
    this.header.append(this.nameElement, this.metaElement)

    this.body = document.createElement('div')
    this.body.className = 'cm-writer-include-body cm-writer-include-preview'
    this.body.setAttribute('dir', 'auto')
    this.body.textContent = trans('Loading…')
    this.body.addEventListener('mousedown', this.onPreviewMouseDown)
    // Links in the preview must not navigate: a click means "edit"
    this.body.addEventListener('click', this.onPreviewClick)
    this.body.addEventListener('focusout', this.onEditorFocusOut)
    this.body.addEventListener('focusin', () => {
      if (this.session !== undefined) {
        this.session.focused = true
      }
    })

    this.dom.append(this.header, this.body)
    this.applyBackground()

    this.resizeObserver = new ResizeObserver(() => {
      if (this.dom.isConnected && this.dom.offsetHeight > 0) {
        heightCache.set(this.key, this.dom.offsetHeight)
      }
    })
    this.resizeObserver.observe(this.dom)

    registerController(this)

    // Scrolled back into view while being edited: pick the session back up
    const parked = sessionsByView.get(view)?.get(key)
    if (parked !== undefined && !parked.attached) {
      this.attach(parked)
    } else {
      this.refresh()
    }
  }

  /**
   * (Re-)resolves the include and, unless the user is editing it, reloads
   * the preview.
   */
  refresh (): void {
    if (this.destroyed || this.session !== undefined) {
      return
    }

    this.refreshToken++
    this.load().catch(err => {
      console.error(`[Includes] Could not load include ${this.target}`, err)
    })
  }

  private isStale (token: number): boolean {
    return token !== this.refreshToken || this.destroyed || this.session !== undefined
  }

  private async load (): Promise<void> {
    const token = this.refreshToken

    if (this.ancestors.length > MAX_INCLUDE_DEPTH) {
      this.showError(trans('Include depth limit (%s levels) reached', String(MAX_INCLUDE_DEPTH)))
      return
    }

    const res: { path?: string, error?: 'missing'|'ambiguous' } = await ipcRenderer.invoke('writer-provider', {
      command: 'resolve-include',
      payload: { sourcePath: this.sourcePath, target: this.target }
    })

    if (this.isStale(token)) {
      return
    }

    if (res.path === undefined) {
      this.resolvedPath = undefined
      this.showError(res.error === 'ambiguous'
        ? trans('Ambiguous include: several files match %s', this.target)
        : trans('Included file not found: %s', this.target))
      return
    }

    if (res.path === this.sourcePath || this.ancestors.includes(res.path)) {
      this.resolvedPath = undefined
      this.showError(trans('Include cycle: %s includes one of its ancestors', this.target))
      return
    }

    this.resolvedPath = res.path
    this.nameElement.textContent = res.path.split(/[\\/]/).pop() ?? this.target

    const file: { content: string, words: number }|undefined = await ipcRenderer.invoke('writer-provider', {
      command: 'read-include',
      payload: { filePath: res.path }
    })

    if (this.isStale(token)) {
      return
    }

    if (file === undefined) {
      this.showError(trans('Included file not found: %s', this.target))
      return
    }

    this.dom.classList.remove('cm-writer-include-has-error')
    this.metaElement.textContent = trans('%s words', String(file.words))

    if (file.content.trim() === '') {
      this.body.innerHTML = ''
      const empty = document.createElement('span')
      empty.className = 'cm-writer-include-empty'
      empty.textContent = trans('Empty note. Click to write.')
      this.body.appendChild(empty)
      return
    }

    const basePath = pathDirname(res.path)
    const { zknLinkFormat } = this.view.state.field(configField)
    const html = await md2html(file.content, {
      zknLinkFormat,
      onCitation: window.getCitationCallback(CITEPROC_MAIN_DB),
      onImageSrc (src) {
        const isDataUrl = /^data:[a-zA-Z0-9/;=]+(?:;base64){0,1},.+/.test(src)
        return isDataUrl ? src : makeValidUri(src, basePath)
      }
    })

    if (this.isStale(token)) {
      return
    }

    this.body.innerHTML = sanitizeHTML(html)
    // Arabic and English notes mix freely; let each block pick its direction
    for (const child of Array.from(this.body.children)) {
      child.setAttribute('dir', 'auto')
    }
  }

  private showError (message: string): void {
    this.dom.classList.add('cm-writer-include-has-error')
    this.metaElement.textContent = ''
    this.body.innerHTML = ''
    const error = document.createElement('span')
    error.className = 'cm-writer-include-error'
    error.textContent = message
    this.body.appendChild(error)
  }

  private readonly onPreviewMouseDown = (event: MouseEvent): void => {
    if (this.session !== undefined || event.button !== 0 || this.resolvedPath === undefined) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    this.startEditing(this.resolvedPath)
  }

  private readonly onPreviewClick = (event: MouseEvent): void => {
    if (this.session === undefined) {
      event.preventDefault()
    }
  }

  /**
   * Swaps the preview for a new editing session on the included file.
   */
  private startEditing (filePath: string): void {
    const { windowId, leafId } = this.view.state.facet(editorMetadataFacet)

    // NOTE: The constructor's configOverride argument can't be used: it is
    // applied before the view exists. Setting the options right away still
    // lands before the (async) document load builds the extensions.
    const editor = new MarkdownEditor(leafId ?? '', windowId ?? '', filePath, documentAuthorityIPCAPI)
    editor.setOptions(this.nestedConfig(filePath))

    const session: IncludeSession = {
      key: this.key,
      editor,
      resolvedPath: filePath,
      name: this.nameElement.textContent ?? this.target,
      meta: this.metaElement.textContent ?? '',
      dirty: false,
      attached: false,
      focused: true
    }

    // Focus the editor on its first load (the user just clicked into it),
    // but never on later reloads (e.g. after the file changed on disk).
    editor.once('loaded', () => { editor.focusOnLoad = false })
    editor.on('change', () => { session.dirty = true })
    editor.on('zettelkasten-link', (linkContents: string) => {
      ipcRenderer.invoke('application', {
        command: 'force-open',
        payload: { linkContents, newTab: undefined } satisfies ForceOpenAPI
      }).catch(err => console.error(err))
    })

    getSessions(this.view).set(this.key, session)
    sessionRefs.set(filePath, (sessionRefs.get(filePath) ?? 0) + 1)
    this.attach(session)
  }

  private attach (session: IncludeSession): void {
    this.refreshToken++ // Discard any preview load still in flight
    this.session = session
    this.resolvedPath = session.resolvedPath
    session.attached = true

    this.nameElement.textContent = session.name
    this.metaElement.textContent = session.meta
    this.dom.classList.remove('cm-writer-include-has-error')
    this.body.innerHTML = ''
    this.body.classList.remove('cm-writer-include-preview')
    this.body.classList.add('cm-writer-include-editing')
    this.body.appendChild(session.editor.dom)
    session.editor.setOptions(this.nestedConfig(session.resolvedPath))

    // NOTE: On re-attach this runs inside toDOM, before CodeMirror has put
    // the widget into the document, so focusing has to wait a tick.
    setTimeout(() => {
      const active = document.activeElement
      if (this.session === session && session.focused && this.dom.isConnected &&
        (active === null || active === document.body)) {
        session.editor.focus()
      }
    }, 0)
  }

  /**
   * The nested editor inherits the outer editor's configuration, minus the
   * whole-window features.
   */
  private nestedConfig (filePath: string): EditorConfigOptions {
    const outer = this.view.state.field(configField)
    return {
      ...JSON.parse(JSON.stringify(outer)),
      metadata: { ...outer.metadata, path: filePath },
      includeAncestors: [ ...this.ancestors, this.sourcePath ],
      showStatusbar: false,
      typewriterMode: false,
      distractionFree: false
    }
  }

  /**
   * Tints the block with the configured preview background, so included
   * content reads as distinct from the including document.
   */
  private applyBackground (): void {
    const { darkMode, includePreviewBackground, includePreviewBackgroundDark } = this.view.state.field(configField)
    this.dom.style.backgroundColor = darkMode ? includePreviewBackgroundDark : includePreviewBackground
  }

  /**
   * Forwards a config change of the outer editor to the nested one.
   */
  updateConfig (): void {
    this.applyBackground()
    if (this.session !== undefined) {
      this.session.editor.setOptions(this.nestedConfig(this.session.resolvedPath))
    }
  }

  /**
   * Saves the included file once focus leaves its editor, so edits are not
   * stranded when autosave is off.
   */
  private readonly onEditorFocusOut = (event: FocusEvent): void => {
    if (this.session === undefined) {
      return
    }

    const next = event.relatedTarget
    if (next instanceof Node && this.body.contains(next)) {
      return // Focus moved within the include (e.g. into a nested include)
    }

    // Focus moving elsewhere means the user left this include. Losing it
    // because the widget scrolled out of view does not: the focusout fires
    // before the widget is removed, so decide once the dust has settled.
    const session = this.session
    setTimeout(() => {
      if (this.dom.isConnected && !this.body.contains(document.activeElement)) {
        session.focused = false
      }
    }, 0)

    this.save()
  }

  private save (): void {
    if (this.session === undefined || !this.session.dirty) {
      return
    }

    this.session.dirty = false
    saveFile(this.session.resolvedPath)
  }

  private openInTab (): void {
    if (this.resolvedPath === undefined) {
      return
    }

    const { windowId, leafId } = this.view.state.facet(editorMetadataFacet)
    ipcRenderer.invoke('documents-provider', {
      command: 'open-file',
      payload: { path: this.resolvedPath, windowId, leafId, newTab: true }
    }).catch(err => console.error(err))
  }

  /**
   * Called when the widget leaves the DOM. An editing session is parked, not
   * disposed: the sessions plugin disposes it once its include is gone.
   */
  destroy (): void {
    this.destroyed = true
    this.resizeObserver.disconnect()
    unregisterController(this)

    if (this.session !== undefined) {
      this.save()
      this.session.attached = false
      this.session.editor.dom.remove()
      this.session = undefined
    }
  }
}

class IncludeWidget extends WidgetType {
  constructor (
    readonly sourcePath: string,
    readonly target: string,
    readonly ancestors: string[],
    readonly key: string
  ) {
    super()
  }

  eq (other: IncludeWidget): boolean {
    // Keeping the widget alive across edits of the outer document is what
    // keeps a nested editor (and its cursor) alive while the user types.
    return other.key === this.key
  }

  toDOM (view: EditorView): HTMLElement {
    const controller = new IncludeController(view, this.sourcePath, this.target, this.ancestors, this.key)
    controllerByDom.set(controller.dom, controller)
    return controller.dom
  }

  destroy (dom: HTMLElement): void {
    controllerByDom.get(dom)?.destroy()
    controllerByDom.delete(dom)
  }

  // All interaction inside the block belongs to the preview/nested editor
  ignoreEvent (): boolean { return true }

  get estimatedHeight (): number { return heightCache.get(this.key) ?? 80 }
}

/**
 * Finds all structural includes (any top-level block whose entire source is
 * one embed of a Markdown file, as in the writer index) and places a preview
 * block after each.
 */
function buildIncludeDecorations (state: EditorState): DecorationSet {
  const config = state.field(configField, false)
  if (config === undefined || config.metadata.path === '') {
    return Decoration.none
  }

  const sourcePath = config.metadata.path
  const ancestors = config.includeAncestors ?? []
  const decorations: Range<Decoration>[] = []
  const occurrences = new Map<string, number>()

  for (let node = syntaxTree(state).topNode.firstChild; node !== null; node = node.nextSibling) {
    const target = matchEmbedTarget(state.sliceDoc(node.from, node.to))
    if (target === undefined) {
      continue
    }

    const occurrence = occurrences.get(target) ?? 0
    occurrences.set(target, occurrence + 1)
    const key = includeKey(sourcePath, ancestors, target, occurrence)
    const widget = new IncludeWidget(sourcePath, target, ancestors, key)
    decorations.push(Decoration.widget({ widget, block: true, side: 1 }).range(node.to))
  }

  return Decoration.set(decorations)
}

const includeField = StateField.define<DecorationSet>({
  create (state) {
    return buildIncludeDecorations(state)
  },
  update (value, tr) {
    const configChanged = tr.startState.field(configField, false)?.metadata.path !== tr.state.field(configField, false)?.metadata.path
    if (tr.docChanged || configChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return buildIncludeDecorations(tr.state)
    }
    return value
  },
  provide: f => EditorView.decorations.from(f)
})

/**
 * Owns the editing sessions of an editor view: forwards config changes
 * (theme, rendering mode, ...) to them, and disposes sessions whose include
 * line is gone, or all of them once the view's state is replaced (another
 * file loaded) or the view closes.
 */
const sessionManager = ViewPlugin.fromClass(class {
  constructor (private readonly view: EditorView) {}

  update (update: ViewUpdate): void {
    if (update.startState.field(configField, false) !== update.state.field(configField, false)) {
      for (const dom of Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>('.cm-writer-include'))) {
        controllerByDom.get(dom)?.updateConfig()
      }
    }

    if (update.docChanged) {
      // Widgets are destroyed (and their sessions parked) only after the
      // plugins have updated, so check once the DOM update is through
      setTimeout(() => { this.disposeOrphans() }, 0)
    }
  }

  disposeOrphans (): void {
    const sessions = sessionsByView.get(this.view)
    if (sessions === undefined || sessions.size === 0) {
      return
    }

    const liveKeys = new Set<string>()
    const iter = this.view.state.field(includeField).iter()
    for (; iter.value !== null; iter.next()) {
      liveKeys.add((iter.value.spec.widget as IncludeWidget).key)
    }

    for (const session of [...sessions.values()]) {
      if (!session.attached && !liveKeys.has(session.key)) {
        disposeSession(this.view, session)
      }
    }
  }

  destroy (): void {
    for (const session of [...(sessionsByView.get(this.view)?.values() ?? [])]) {
      disposeSession(this.view, session)
    }
  }
})

const includeTheme = EditorView.baseTheme({
  '.cm-writer-include': {
    margin: '0.25em 0 1em',
    padding: '0.5em 0.9em',
    borderRadius: '4px',
    borderInlineStart: '3px solid rgba(100, 140, 200, 0.45)',
    cursor: 'text'
  },
  '.cm-writer-include.cm-writer-include-has-error': {
    borderInlineStartColor: 'rgba(200, 60, 60, 0.6)'
  },
  '.cm-writer-include-header': {
    display: 'flex',
    gap: '1em',
    fontSize: '0.75em',
    opacity: '0.6',
    marginBottom: '0.25em',
    fontFamily: 'system-ui, sans-serif'
  },
  '.cm-writer-include-name': {
    cursor: 'pointer',
    '&:hover': { textDecoration: 'underline' }
  },
  '.cm-writer-include-preview > :first-child': { marginTop: '0' },
  '.cm-writer-include-preview > :last-child': { marginBottom: '0' },
  '.cm-writer-include-preview img': { maxWidth: '100%' },
  '.cm-writer-include-preview a': { pointerEvents: 'none' },
  '.cm-writer-include-empty': { opacity: '0.5', fontStyle: 'italic' },
  '.cm-writer-include-error': { color: '#c33', fontSize: '0.9em' },
  // The nested editor flows with the outer document instead of scrolling
  '.cm-writer-include-editing .cm-editor': { height: 'auto' },
  '.cm-writer-include-editing .cm-scroller': {
    padding: '0 !important',
    overflow: 'visible !important'
  },
  '.cm-writer-include-editing .cm-gutters': { display: 'none' }
})

/**
 * Inline previews of structural includes, editable in place.
 */
export function writerIncludes (): Extension {
  return [ includeField, sessionManager, includeTheme ]
}
