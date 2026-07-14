# ARCHITECTURE-NOTES — Zettlr v4.6.0 recon (Phase 0)

Answers to the seven recon questions from `SPEC-writing-ide.md` §0. All paths are
repo-relative; line numbers are for the v4.6.0 tree and will drift.

Toolchain status: `yarn install` clean (Yarn 4.11.0 via corepack, Node 22),
`yarn test` → 375 passing, `yarn lint` = `eslint` + `vue-tsc --noEmit`.

---

## 1. Where is the CM6 editor constructed, and how are extensions configured?

**Construction.** `source/common/modules/markdown-editor/index.ts` — class
`MarkdownEditor` (default export). The `EditorView` is created empty in the
constructor (~line 274) and held as `_instance`; the real state is built in
`loadDocument()` (~line 366), which assembles extensions and calls
`EditorState.create` + `setState`. (A second `new EditorView` in
`table-editor/subview.ts:257` is the nested table-cell editor — ignore.)

**Extension assembly.** `source/common/modules/markdown-editor/editor-extension-sets.ts`.
A private `getCoreExtensions()` (~line 152) is layered into per-doctype exported
sets — `getMarkdownExtensions()` (~line 270) is the one we care about. Selection
happens in `MarkdownEditor._getExtensions` via a `switch (DocumentType)`
(index.ts ~350).

**Configuration channel.** Three mechanisms, in order of preference:

1. **`configField` + `configUpdateEffect`** (`markdown-editor/util/configuration.ts`,
   field ~line 156) — the primary channel. Most options are consumed live via
   `Facet.from(configField, …)` derivations; dispatching the effect updates
   everything without a rebuild. `EditorConfiguration` interface + defaults live
   here (~lines 31–151).
2. **Compartments** — only one exists (`inputModeCompartment`,
   extension-sets.ts:103), reconfigured in `MarkdownEditor.onConfigUpdate`
   (index.ts ~551). Precedent for options that need extension swapping.
3. **Full rebuild** — `MarkdownEditor.reload()` (index.ts ~439) re-runs
   `loadDocument()` for anything baked at state-creation time.

**Config flow from app settings to editor:** Pinia `useConfigStore` →
`source/win-main/MainEditor.vue` computed `editorConfiguration` (~lines 229–290)
→ `watch → currentEditor.setOptions()` (~line 432) →
`MarkdownEditor.setOptions` dispatches `configUpdateEffect`.
**A new per-editor option plugs in at exactly these four spots:** key+default in
`EditorConfiguration`, mapping in `MainEditor.vue`, consumption in the extension
set, and (if user-facing) a preferences field.

**Bidi status today: none.** No `perLineTextDirection`, no `bidiIsolates`, no
`dir` handling anywhere in the editor. Notably,
`source/win-preferences/schema/editor.ts:38-46` contains an **empty "Writing
direction" preferences section** with a comment saying bidi support is planned
for reintroduction (`fields: []`, `// TODO: Add field for LTR/RTL`). Upstream
has left us a designated parking spot for the Phase 1 toggle.

**Frontmatter access for the per-document `direction:` override.** Precedent:
the LanguageTool linter reads a frontmatter override with
`extractYamlFrontmatter(state.sliceDoc())`
(`markdown-editor/linters/language-tool.ts:107-114`, util in
`source/common/util/extract-yaml-frontmatter.ts`). Same pattern works for
`direction:`; for a hot path, read only the `YAMLFrontmatter` node range from
the syntax tree instead of the whole doc.

---

## 2. Workspace / open-document model, and the file tree

**Workspace (main): FSAL** — `source/app/service-providers/fsal/index.ts`
(`class FSAL`), instantiated with all other providers in
`source/app/app-service-container.ts` (~lines 105–135; every provider extends
`ProviderContract` from `source/app/service-providers/provider-contract.ts`).
FSAL keeps one chokidar watchdog per root, syncs roots from config. The model is
**flat, not a tree**: `getAllLoadedDescriptors()`, `getDescriptorFor()`,
`readDirectory()`; the renderer reconstructs hierarchy.

**Descriptors** — `source/types/common/fsal.ts`: `MDFileDescriptor` (~line 84)
already caches per-file metadata parsed at load: `id`, `tags`, **`links`
(wikilink targets)**, `citekeys`, `wordCount`, `charCount`, `firstHeading`,
`yamlTitle`, `frontmatter`. Parsing happens in
`source/app/service-providers/fsal/util/file-parser.ts` over the shared
markdown AST. **Not cached:** full heading tree, heading positions, embeds,
TODOs — our index must walk the AST itself (cheap: `markdownToAST` +
`extractASTNodes(ast, 'Heading')` already exist).

**Open documents (main): DocumentManager** —
`source/app/service-providers/documents/index.ts`. Window/pane/tab tree in
`documents/document-tree/` (`DocumentTree` → `DTBranch` → `DTLeaf` →
`TabManager`). Serialized types + the `DP_EVENTS` event vocabulary in
`source/types/common/documents.ts`.

**File-tree component (renderer):**
`source/win-main/file-manager/FileManager.vue` → `FileTree.vue` →
`TreeItem.vue`. Data source is Pinia `useWorkspaceStore`
(`source/pinia/workspace-store.ts`): a flat `descriptorMap` + `workspaceMap`
patched incrementally by `ipcRenderer.on('fsal-event', …)`.

---

## 3. Main↔renderer IPC pattern

Two complementary halves:

1. **Command channels:** each provider registers
   `ipcMain.handle('<provider-name>', (event, { command, payload }) => …)`,
   typed via the `IPCAPI<T>` helper in `provider-contract.ts`. Renderer calls
   `window.ipc.invoke('<provider-name>', { command, payload })`.
   Examples: `'fsal'` (fsal/index.ts ~91), `'documents-provider'`
   (documents/index.ts ~283), `'link-provider'` (links/index.ts ~45).
2. **Push notifications:** `broadcastIPCMessage(channel, …args)`
   (`source/common/util/broadcast-ipc-message.ts`) sends to all windows;
   renderer Pinia stores subscribe with `ipcRenderer.on(channel, …)` and
   re-fetch or patch state.

**The template for our index provider is `LinkProvider`**
(`source/app/service-providers/links/index.ts`): constructor-injects FSAL,
subscribes `fsal.on('fsal-event', …)` in `boot()`, keeps in-memory Maps,
answers over `ipcMain.handle('link-provider', …)`, and broadcasts `'links'` on
change. Note its refresh is coarse (full `reindex()` on any event — an
acknowledged TODO at lines 66–68); our provider should use the event payload
(`{event, descriptor}` for add/change, `{event, path}` for unlink — emitted in
fsal/index.ts `emitChokidarEvent`, ~line 177) for **incremental** re-parse, as
the spec requires.

---

## 4. Sidebar / panel registration

**No registration mechanism exists.** The right sidebar
(`source/win-main/sidebar/MainSidebar.vue`) hardcodes its four tabs (ToC,
References, Related files, Other files) in two places: a `tabs` array literal
(~lines 55–81) feeding the generic `TabBar.vue`, and a `v-show`-gated component
block in the template (~lines 10–19). The current tab is persisted as config
`window.currentSidebarTab`, whose **type union must be widened** in
`source/app/service-providers/config/get-config-template.ts:225`.

**Minimal integration point for the Manuscript and TODO panels:** one new
self-contained `.vue` file each in `source/win-main/sidebar/` (they consume
Pinia + `window.ipc` directly), plus ~4 touched lines in `MainSidebar.vue` and
the config-type union. That's an acceptable, small, rebase-friendly diff.

**Prior art — the ToC tab** (`sidebar/ToCTab.vue`): headings come from a CM6
`StateField` (`markdown-editor/plugins/toc-field.ts`, `ToCEntry {line, pos,
text, level, id}`), pushed into `windowStateStore.tableOfContents` by
`MainEditor.vue`. Note this covers **only the active document** — our tree needs
workspace-wide data, hence the main-process index instead.

**Jump-to-line already exists** (needed for tree/TODO click-through):
`App.vue` `jtl(filePath, lineNumber, newTab)` (~line 810) opens the file if
needed and forwards through the `editorCommands` prop bus → `MainEditor.vue`
watcher → `MarkdownEditor.jtl(line)` (index.ts ~480, selects + scrolls +
focuses). Global Search uses exactly this; we emit the same event.

---

## 5. Markdown parsing for preview/export

**There is no markdown-it.** Two distinct pipelines:

- **Preview/HTML** (print window, ToC rendering): Zettlr's own `md2html` in
  `source/common/modules/markdown-utils/markdown-to-html.ts`, built on the same
  CM6 Lezer parser as the editor (`markdown-editor/parser/markdown-parser.ts`,
  `@codemirror/lang-markdown` + custom sub-parsers for citations, footnotes,
  frontmatter, math). The AST layer is
  `source/common/modules/markdown-utils/markdown-ast/index.ts`. §1.6's
  `dir="auto"` per block goes into the HTML emission here.
- **Export**: raw markdown files are handed to **Pandoc** — no JS-side
  conversion. Flow: `PopoverExport.vue` → IPC `application`/`export` →
  `source/app/service-providers/commands/export.ts` →
  `commands/exporter/index.ts` (`makeExport`), which writes a Pandoc defaults
  YAML (reader extensions incl. `wikilinks_*`, CSL, Lua filters from
  `userData/lua-filter`) and spawns `pandoc --defaults`. The exporter already
  handles "unsaved buffer → temp file" (export.ts ~115). **Phase 4 hook:** the
  natural include-resolution point is a preprocessing step producing one
  concatenated temp file that then flows through `makeExport` unchanged.

**Word count** (§3.7 badge): `source/common/util/counter.ts` — `countAll(ast,
locale, from?, to?)` takes character ranges, so per-file and per-heading-subtree
badges are a direct application. FSAL already stores per-file `wordCount`.

---

## 6. Build / test / lint commands, dev loop

Verified from `package.json` + `scripts/test-gui/index.mjs`:

| Command | What it actually does | Status |
|---|---|---|
| `yarn start` | Runs `scripts/test-gui/index.mjs` → spawns `electron-forge start` with a **sandboxed** data dir (`resources/test-cfg`) and sample workspace (`resources/test`). `--clean` regenerates both. Webpack HMR via forge's webpack plugin. | Not yet launched (GUI) |
| `yarn test` | mocha over `test/**` (unit tests, no GUI) | ✅ 375 passing |
| `yarn lint` | `eslint --cache` + `vue-tsc --noEmit` | ✅ passes |
| `yarn package` / `release:linux-x64` | electron-forge package / AppImage | untested |

The spec's assumed `yarn lint && yarn test && yarn start` loop is real. The
sandboxed test workspace is ideal for our acceptance tests — we can drop
Arabic/mixed-direction sample files and a `master.md` + includes fixture into
`scripts/test-gui/test-files/` so `yarn start --clean` always opens a ready-made
manuscript.

---

## 7. Critical: what do `[[wikilink]]`, `![](note.md)`, `![[note]]` mean today?

**Good news — no conflicts. The `!`-embed syntax is unclaimed.**

| Syntax | Zettlr v4.6.0 behavior |
|---|---|
| `[[wikilink]]` | First-class ZKN link. Parsed by a custom Lezer inline parser (`markdown-editor/parser/zkn-link-parser.ts` → `ZknLink` node; AST `ZettelkastenLink` with `target` + `targetRange`). Resolved **by name/ID only** in `FSAL.findExact` (fsal/index.ts ~418): ZKN id → filename with ext → filename without ext. No relative-path resolution. Ctrl/cmd-click opens via the `force-open` command. |
| `![](note.md)` | **Pure image.** `renderers/render-images.ts` has no extension check; a `.md` src fails to load and shows the "image not found" placeholder. Export passes it to Pandoc as an image. No transclusion concept exists anywhere in `source/` (zero hits for "transclu"). |
| `![[note]]` | **Zero meaning.** Literal `![[` appears nowhere in the source. (Lezer sees `!` + a `ZknLink`; it does not form an `Image` node.) |
| `[link](note.md)` | Plain markdown link — untouched, per spec §2. |

**Existing link index:** `LinkProvider` keeps `Map<sourcePath, rawTargets[]>` +
`Map<path, zknId>`, fed from `descriptor.links` — which contains **only
wikilink targets** extracted in `file-parser.ts:76-77`, as raw strings with
**order and positions dropped**. IPC: `get-inbound-links`,
`get-link-database`. Autocomplete candidates come from `MainEditor.vue`
`updateFileDatabase` (~line 621), which merges all workspace files with the
link database.

**Consequence for §2:** we can *reuse* the resolver (`findExact`) and the
provider *pattern*, but the manuscript index cannot be derived from
LinkProvider's data — it lacks embeds, order, positions, and heading structure.
As the spec already mandates, we build our own main-process index provider that
walks the AST (`Image` nodes for `![](x.md)`, `!`+`ZknLink` adjacency for
`![[x]]`, `Heading` nodes, TODO patterns) per changed file.

---

## Implications / proposed integration map (for later phases)

New code lives under `source/app/service-providers/writer/` (main) and
`source/win-main/sidebar/writer/` + `source/common/modules/markdown-editor/writer/`
(renderer), namespaced per the spec. Explicit touch points in existing files:

| Phase | Existing files touched (expected) |
|---|---|
| 1 Bidi | `editor-extension-sets.ts` (add extension), `util/configuration.ts` (option), `MainEditor.vue` (mapping), `win-preferences/schema/editor.ts` (fill the empty "Writing direction" section), `markdown-to-html.ts` (dir=auto on blocks) |
| 2 Index | `app-service-container.ts` (instantiate provider) — everything else new files |
| 3 Manuscript panel | `MainSidebar.vue` (+tab), `get-config-template.ts` (tab union) |
| 4 TODO panel | same two, plus `editor-extension-sets.ts` (gutter marker extension) |
| 5 Export | `commands/export.ts` or a new command routed like it (concatenate-then-`makeExport`) |

Dependency check for Phase 1: installed `@codemirror/view` is **6.41.1**, which
exposes both `EditorView.perLineTextDirection` and
`EditorView.bidiIsolatedRanges` (the basis of the `bidiIsolates` extension from
the CM6 bidi example). **No new dependency is needed for Phase 1.**
