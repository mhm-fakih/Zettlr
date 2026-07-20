/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        WriterIndexProvider
 * CVM-Role:        Service Provider
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Maintains the writer index: for every Markdown file in the
 *                  workspaces, its headings, structural includes (spec §2),
 *                  and TODO annotations (spec §4). The index is kept current
 *                  incrementally via FSAL events and is exposed to the
 *                  renderer over the 'writer-provider' IPC channel; updates
 *                  are announced with a debounced 'writer-index' broadcast.
 *
 * END HEADER
 */

import { promises as fs } from 'fs'
import path from 'path'
import { app, ipcMain } from 'electron'
import broadcastIpcMessage from '@common/util/broadcast-ipc-message'
import { hasMarkdownExt } from '@common/util/file-extention-checks'
import ProviderContract, { type IPCAPI } from '../provider-contract'
import type LogProvider from '@providers/log'
import type ConfigProvider from '@providers/config'
import type FSAL from '@providers/fsal'
import type { FSALEventPayload } from '@providers/fsal'
import type { ManuscriptTreeNode, WriterFileEntry, WriterRoot } from '@dts/common/writer'
import { parseWriterFile } from './parse-writer-file'
import { buildManuscriptTree } from './build-manuscript-tree'
import { assembleManuscript, assembledFileName } from './assemble-manuscript'

export type WriterProviderIPCAPI = IPCAPI<{
  'get-roots': undefined
  'get-tree': { rootPath: string }
  'get-todos': undefined
  'get-codes': undefined
  'get-index': undefined
  'assemble-manuscript': { rootPath: string }
}>

const BROADCAST_DEBOUNCE_MS = 300

/**
 * How many files to parse before yielding back to the event loop
 */
const REINDEX_BATCH_SIZE = 20

export default class WriterIndexProvider extends ProviderContract {
  private readonly _index: Map<string, WriterFileEntry>
  private _broadcastTimeout: ReturnType<typeof setTimeout>|undefined
  private _reindexToken: number

  constructor (
    private readonly _logger: LogProvider,
    private readonly _config: ConfigProvider,
    private readonly _fsal: FSAL
  ) {
    super()
    this._index = new Map()
    this._reindexToken = 0

    ipcMain.handle('writer-provider', async (event, message: WriterProviderIPCAPI) => {
      const { command } = message

      if (command === 'get-roots') {
        return this.getRoots()
      } else if (command === 'get-tree') {
        return this.getTree(message.payload.rootPath)
      } else if (command === 'get-todos') {
        return this.getTodos()
      } else if (command === 'get-codes') {
        return this.getCodes()
      } else if (command === 'get-index') {
        return Object.fromEntries(this._index)
      } else if (command === 'assemble-manuscript') {
        return await this.assembleForExport(message.payload.rootPath)
      }
    })
  }

  public async boot (): Promise<void> {
    this._fsal.on('fsal-event', payload => {
      this.processEvent(payload)
    })

    // The TODO tags are configurable; a change invalidates every entry
    this._config.on('update', (option: string) => {
      if (option === 'editor.todoTags') {
        this.startReindex()
      }
    })

    // NOTE: The initial scan must not block the boot sequence -- on large
    // workspaces it can take a while, and the app is perfectly usable while
    // the index fills up (the panels refresh via the 'writer-index' event).
    this.startReindex()
  }

  /**
   * Kicks off a full reindex in the background, discarding a run that may
   * still be in progress.
   */
  private startReindex (): void {
    this._reindexToken++
    const token = this._reindexToken
    this.reindex(token)
      .catch(err => this._logger.error(`[WriterIndex] Could not build the index: ${err.message as string}`, err))
  }

  public async shutdown (): Promise<void> {
    if (this._broadcastTimeout !== undefined) {
      clearTimeout(this._broadcastTimeout)
    }
    this._logger.verbose('Writer index provider shutting down ...')
  }

  /**
   * Returns all potential manuscript roots (files with at least one
   * structural include).
   */
  public getRoots (): WriterRoot[] {
    return [...this._index.values()]
      .filter(entry => entry.includes.length > 0)
      .map(entry => ({ path: entry.path, name: entry.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Builds the manuscript tree for the given root file.
   */
  public getTree (rootPath: string): ManuscriptTreeNode|null {
    return buildManuscriptTree(rootPath, this._index, (source, target) => this.resolveInclude(source, target))
  }

  /**
   * Returns the index entry for a single file, if indexed.
   */
  public getEntry (filePath: string): WriterFileEntry|undefined {
    return this._index.get(filePath)
  }

  /**
   * Returns all files containing TODO annotations (spec §4).
   */
  public getTodos (): Array<Pick<WriterFileEntry, 'path'|'name'|'todos'>> {
    return [...this._index.values()]
      .filter(entry => entry.todos.length > 0)
      .map(entry => ({ path: entry.path, name: entry.name, todos: entry.todos }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Returns all files containing letter-digit-letter codes (e.g. T3Z).
   */
  public getCodes (): Array<Pick<WriterFileEntry, 'path'|'name'|'codes'>> {
    return [...this._index.values()]
      .filter(entry => entry.codes.length > 0)
      .map(entry => ({ path: entry.path, name: entry.name, codes: entry.codes }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Assembles the manuscript rooted at the given master file (spec §5) and
   * writes it to a temporary file whose path is returned. The file carries
   * the root's base name so export artifacts are named after it; Pandoc's
   * working directory is pinned to the root's folder via frontmatter so
   * relative resource paths keep working.
   */
  public async assembleForExport (rootPath: string): Promise<string> {
    const exportConfig = this._config.get().export

    const content = await assembleManuscript(
      rootPath,
      async absPath => await fs.readFile(absPath, 'utf-8'),
      (source, target) => this.resolveInclude(source, target),
      {
        shiftHeadings: exportConfig.manuscriptShiftHeadings,
        stripTodos: exportConfig.manuscriptStripTodos,
        stripFieldMarkers: exportConfig.manuscriptStripFieldMarkers,
        todoTags: this._config.get().editor.todoTags,
        pandocWorkingDir: path.dirname(rootPath)
      }
    )

    const targetDir = path.join(app.getPath('temp'), 'writer-manuscript')
    await fs.mkdir(targetDir, { recursive: true })
    const targetPath = path.join(targetDir, assembledFileName(rootPath))
    await fs.writeFile(targetPath, content, 'utf-8')

    this._logger.info(`[WriterIndex] Assembled manuscript ${rootPath} -> ${targetPath}`)
    return targetPath
  }

  /**
   * Keeps the index current: re-parses changed/added Markdown files, drops
   * removed ones (incremental; spec §2).
   */
  private processEvent (payload: FSALEventPayload): void {
    if (payload.event === 'unlink' || payload.event === 'unlinkDir') {
      let changed = false
      for (const key of this._index.keys()) {
        if (key === payload.path || (payload.event === 'unlinkDir' && key.startsWith(payload.path + path.sep))) {
          this._index.delete(key)
          changed = true
        }
      }
      if (changed) {
        this.scheduleBroadcast()
      }
      return
    }

    if (payload.event !== 'add' && payload.event !== 'addDir' && payload.event !== 'change') {
      return
    }

    const { descriptor } = payload
    if (descriptor.type === 'file' && hasMarkdownExt(descriptor.path)) {
      this.scanFile(descriptor.path)
        .then(() => { this.scheduleBroadcast() })
        .catch((err: any) => this._logger.error(`[WriterIndex] Could not scan ${descriptor.path}: ${err.message as string}`, err))
    }
  }

  /**
   * Announces an index update to all renderers, debounced so that bursts of
   * file events produce a single refresh.
   */
  private scheduleBroadcast (): void {
    if (this._broadcastTimeout !== undefined) {
      clearTimeout(this._broadcastTimeout)
    }
    this._broadcastTimeout = setTimeout(() => {
      this._broadcastTimeout = undefined
      broadcastIpcMessage('writer-index')
    }, BROADCAST_DEBOUNCE_MS)
  }

  /**
   * Performs the initial full scan of all loaded Markdown files.
   */
  private async reindex (token: number): Promise<void> {
    const descriptors = (await this._fsal.getAllLoadedDescriptors())
      .filter(descriptor => descriptor.type === 'file' && hasMarkdownExt(descriptor.path))

    // Parsing is CPU-bound, so work through the files in small batches and
    // yield in between: the main process stays responsive on large workspaces
    for (let i = 0; i < descriptors.length; i += REINDEX_BATCH_SIZE) {
      if (token !== this._reindexToken) {
        return // A newer reindex has superseded this one
      }

      const batch = descriptors.slice(i, i + REINDEX_BATCH_SIZE)
      await Promise.all(batch.map(async descriptor => {
        try {
          await this.scanFile(descriptor.path)
        } catch (err: any) {
          this._logger.error(`[WriterIndex] Could not scan ${descriptor.path}: ${err.message as string}`, err)
        }
      }))

      await new Promise(resolve => setImmediate(resolve))
    }

    this._logger.info(`[WriterIndex] Indexed ${this._index.size} files.`)
    this.scheduleBroadcast()
  }

  /**
   * (Re-)parses a single file into the index.
   */
  private async scanFile (filePath: string): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8')
    const { appLang, editor } = this._config.get()
    this._index.set(filePath, parseWriterFile(filePath, content, appLang, editor.todoTags))
  }

  /**
   * Resolves an include target (spec §2): explicit paths relative to the
   * including file first, then a name-based fallback over the whole index.
   * Ambiguous names are surfaced as errors, never guessed.
   */
  private resolveInclude (sourcePath: string, target: string): { path?: string, error?: 'missing'|'ambiguous' } {
    let cleaned = target
    try {
      cleaned = decodeURI(target)
    } catch (err) {
      // Malformed URI escapes: keep the raw string
    }

    // First: resolve as a path relative to the including file (also covers
    // absolute paths). Targets without extension get .md appended.
    const base = path.dirname(sourcePath)
    const candidates = [path.resolve(base, cleaned)]
    if (path.extname(cleaned) === '') {
      candidates.push(path.resolve(base, cleaned + '.md'))
    }
    for (const candidate of candidates) {
      if (this._index.has(candidate)) {
        return { path: candidate }
      }
    }

    // Fallback: name-based resolution à la wikilinks, but collecting all
    // matches so ambiguity can be reported
    const normalized = cleaned.split('/').join(path.sep)
    const suffixes = hasMarkdownExt(normalized)
      ? [normalized]
      : [ normalized + '.md', normalized + '.markdown' ]

    const matches: string[] = []
    for (const key of this._index.keys()) {
      for (const suffix of suffixes) {
        if (key === suffix || key.endsWith(path.sep + suffix)) {
          matches.push(key)
          break
        }
      }
    }

    if (matches.length === 1) {
      return { path: matches[0] }
    } else if (matches.length > 1) {
      return { error: 'ambiguous' }
    } else {
      return { error: 'missing' }
    }
  }
}
