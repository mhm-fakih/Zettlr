# Zettlr Nibras

A fork of [Zettlr](https://github.com/Zettlr/Zettlr) v4.6.0, optimized for
Arabic typing and nested notes, TODOs, and (later) Nibras PKM integration.

Upstream's original README is preserved as [README-upstream.md](README-upstream.md).
Everything Zettlr does — workspaces, wikilinks, citations, Pandoc export —
still works exactly as before; this document covers what the fork adds.

**License:** GPL-3.0, inherited from Zettlr. Attribution stays with Hendrik Erz
and the Zettlr contributors. If you distribute a build, you must publish the
sources.

---

## What this fork adds

### 1. Bidirectional (Arabic/English) writing

Mixed-direction writing without fighting the caret.

- Every line resolves its own base direction from its first strong character
  (`dir="auto"` line decorations + CodeMirror's `perLineTextDirection`), so an
  Arabic paragraph and an English paragraph can sit in one document and each
  reads correctly.
- Markdown syntax is bidi-**isolated**: link brackets, parentheses, URLs, code
  spans, emphasis marks and wikilinks stay coherent inside Arabic runs
  (`NodeProp.isolate` markings + `bidiIsolates()`).
- Cursor motion is visual, Backspace/Delete stay logical (CodeMirror defaults,
  deliberately not reimplemented).
- Editor chrome never mirrors — only text direction changes, not layout.
- **Per-document override:** a `direction: ltr|rtl|auto` key in the YAML
  frontmatter. The statusbar (bottom right) shows the current direction and
  offers *Application default / Automatic / Left-to-right / Right-to-left*;
  choosing one writes it into the frontmatter (choosing "Application default"
  removes the key).
- **Application default:** Preferences → Editor → *Writing direction*.
- Preview/print HTML emits `dir="auto"` on paragraphs, headings and table
  cells, so exports and previews match the editor.
- The note ToC mirrors for RTL documents (numbers on the right, indentation
  from the right). Direction is resolved from frontmatter `direction:`, then
  `lang:`, then the first strong character of the title/first heading.

### 2. Manuscript view (master TOC)

A manuscript is a Markdown file that embeds other notes. It appears
automatically — there is no project setting.

```markdown
# The Master Document

![](notes/01-intro.md)

![](notes/02-sources.md)
```

- A **structural include** is an embed with the `!` prefix, a Markdown target,
  alone on its own line at the top level. `![[wikilink]]` embeds work too.
  Plain links (`[Chapter](note.md)`), images, and inline/list/quote embeds are
  *not* includes.
- The **Manuscript panel** sits at the top of the left bar, above the file
  explorer. It renders the whole manuscript **as if it were a single note**:
  included files don't appear as rows, their headings splice in where the embed
  sits. A caption shows the manuscript name and total word count.
- Heading rows are colored by level: **H1–H2** dark greens, **H3–H4** dark
  oranges, **H5+** gray (CSS variables `--writer-heading-1…5`).
- Word-count badges per heading section (transclusions included), `dir="auto"`
  labels so Arabic headings read correctly, click to open the file at that
  line, collapse state and root selection persist.
- The panel's height is **drag-resizable** (10–85% of the column, default 60%)
  via the handle at its bottom edge; collapse it to reclaim the space.
- Error rows surface problems instead of hiding them: *Not found*, *Ambiguous*,
  *Circular include*, *Too deeply nested* (depth cap: 8).
- Path resolution prefers explicit relative paths (relative to the including
  file), then falls back to unique-name lookup. Ambiguity is reported, never
  guessed.
- Files stay separate on disk — nothing is ever concatenated into one buffer.

The full format contract for generating master documents programmatically is
in **[docs/MASTER-TOC-FORMAT.md](docs/MASTER-TOC-FORMAT.md)**.

### 3. TODO panel

- Harvests `TODO:`, `FIXME:`, `QUESTION:`, `SOURCE:` (configurable —
  Preferences → Editor → *TODO tags*) from prose, list items and HTML comments.
  Fenced code blocks and the frontmatter are skipped.
- Right sidebar panel: grouped by file, tag filter chips, and a scope selector
  — whole workspace vs. the current manuscript tree only.
- Click an entry to open the file at that line. Messages render `dir="auto"`.
- Lines carrying a TODO get a marker in the editor gutter.

### 4. Codes panel (letter-digit-letter)

- Standalone letter-digit-letter tokens (e.g. `T3Z`, and non-Latin like `م٣ك`)
  are highlighted in the editor: dark background on the code, light background
  on its line, plus a gutter marker.
- The Codes panel lists them grouped by file, with per-code filter chips and
  click-to-jump.

### 5. Manuscript export

The **Export…** button in the Manuscript panel assembles the manuscript and
hands it to Zettlr's regular Pandoc pipeline, so every export format works.

- Includes resolved depth-first and spliced in order; included files lose their
  frontmatter (only the master's is kept).
- Heading levels of included files shift by nesting depth (Preferences →
  Import/Export, default on).
- TODO lines are stripped (default on).
- `@@ field @@` DB-sync marker lines are stripped, their content kept
  (default on).
- Unresolvable/circular/too-deep includes become HTML comments rather than
  breaking the export.
- Pandoc's working directory is pinned to the master file's folder, so relative
  image paths keep resolving even though the assembled file is temporary.

### 6. UI changes

- **Left bar:** Manuscript panel (resizable) above the file explorer.
- **Right sidebar:** stacked collapsible panels instead of a tab bar — Table of
  contents, TODO, Codes, References, Related files, Other files. Every header
  stays visible; expanded panels share the height and scroll internally; the
  whole header bar toggles a panel.
- **Editor margins** configurable: Preferences → Editor → *Editor margins*
  (small / medium / large).
- **Toolbar** hidden by default, toggle with **View → Toggle Toolbar**
  (`Ctrl/Cmd+Shift+9`). Sidebar shown by default (`Ctrl/Cmd+Shift+0`).
- **Welcome window acts as a splash screen:** it shows for 5 seconds with a
  "Starting in N…" countdown and then dismisses itself (identical to clicking
  *Get started*). Clicking or pressing a key cancels the countdown so the setup
  pages can still be used.
- Accent color is dark blue instead of Zettlr green.

### 7. DB-sync field markers

Notes generated from a database delimit sections with `@@ field @@` lines
(`@@ summary @@`, `@@ description @@`, `@@ notes @@`). These are **inert for
parsing** — never headings, includes, TODOs or codes — and are stripped from
manuscript exports while their content is kept. See
[docs/MASTER-TOC-FORMAT.md](docs/MASTER-TOC-FORMAT.md).

---

## Setting up on another machine

### Requirements

| Tool | Version used here | Notes |
|---|---|---|
| Node.js | 22.x | Anything Zettlr v4.6 supports works |
| Yarn | 4.11.0 | Via corepack — **do not** `npm i -g yarn` |
| git | any | Only needed to keep the upstream remote |
| Python 3, make, g++ | system | Native modules (`nodehun`) are compiled during install |

On Debian/Ubuntu: `sudo apt install build-essential python3`.

### First-time setup

```bash
# 1. Get the sources (either clone your copy, or unpack the transfer bundle)
cd ~/prj/nbr-zettlr

# 2. Enable the pinned Yarn via corepack (no global yarn install!)
corepack enable --install-directory ~/.local/bin
export PATH="$HOME/.local/bin:$PATH"     # add this to ~/.bashrc
yarn -v                                   # must print 4.11.0

# 3. Install dependencies (compiles native modules; takes a few minutes)
yarn install

# 4. Sanity check
yarn test          # 394 passing
yarn lint          # eslint + vue-tsc, 0 errors
```

### Everyday development

```bash
yarn start           # dev app with a sandboxed test workspace + HMR
yarn start --clean   # ... and regenerate the sample workspace from scratch
yarn test            # unit tests (mocha)
yarn lint            # eslint + vue-tsc
```

`yarn start` never touches your real notes: it uses `resources/test` as the
workspace and `resources/test-cfg` as the config directory. Use `--clean` to
reset both (also the only way to re-trigger the splash screen).

### Building a distributable

```bash
./build-appImage.sh
```

That script stamps the build number, runs the production build, and wraps it
into `release/Zettlr-<version>-x86_64.AppImage` (~176 MB, self-contained,
bundled Pandoc). Copy the AppImage to the target machine, `chmod +x`, run it.

Under the hood it is:

```bash
yarn version:build          # version becomes e.g. 4.6.1+9181 (git commit count)
yarn package:linux-x64      # production webpack build + electron-forge package
yarn electron-builder --linux AppImage --x64 --publish never \
     --prepackaged out/Zettlr-linux-x64
```

Other targets (`yarn package:win-x64`, `release:mac-arm`, …) exist as in
upstream, but Electron apps must be built on the platform they target.

**Note:** `yarn version:build` modifies `package.json`; commit that one-line
change or fold it into your next commit.

### Keeping up with upstream Zettlr

The repository has upstream as a remote and the fork's changes are deliberately
small and namespaced, so rebasing stays feasible:

```bash
git fetch upstream
git rebase upstream/master      # or merge, if you prefer
```

New code lives under `writer/` directories; existing Zettlr files are touched
only at narrow integration points (extension set, parser props, statusbar item
list, sidebar composition, config template, HTML emitter).

### Git identity

If git cannot auto-detect an identity on a new machine (it fails when the
hostname has no domain suffix), configure one globally or per-repository:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

---

## Where the fork's code lives

| Path | What |
|---|---|
| `source/common/modules/markdown-editor/writer/` | Editor extensions: bidi, TODO gutter, LDL highlight, direction statusbar |
| `source/app/service-providers/writer/` | Main-process index: file parser, manuscript tree, export assembly, IPC |
| `source/win-main/sidebar/writer/` | Manuscript, TODO and Codes panels |
| `source/win-main/sidebar/SidebarPanel.vue` | The collapsible panel shell |
| `source/common/util/scan-todos.ts`, `scan-codes.ts`, `text-direction.ts` | Shared scanners/helpers |
| `source/types/common/writer.ts` | Shared types |
| `test/writer-index.spec.ts` | Parser, scanner, tree and assembly tests |
| `docs/MASTER-TOC-FORMAT.md` | Format contract for generated manuscripts |
| `ARCHITECTURE-NOTES.md` | Recon of Zettlr's internals (how the fork hooks in) |
| `SPEC-writing-ide.md` | The original specification |
| `build-appImage.sh` | One-command AppImage build |

## Configuration added by the fork

| Setting | Where | Default |
|---|---|---|
| `editor.defaultTextDirection` | Preferences → Editor → Writing direction | `auto` |
| `editor.editorMargins` | Preferences → Editor → Editor margins | `medium` |
| `editor.todoTags` | Preferences → Editor → TODO tags | TODO, FIXME, QUESTION, SOURCE |
| `export.manuscriptShiftHeadings` | Preferences → Import/Export | on |
| `export.manuscriptStripTodos` | Preferences → Import/Export | on |
| `export.manuscriptStripFieldMarkers` | Preferences → Import/Export | on |
| `window.sidebarVisible` | View menu | on |
| `window.showToolbar` | View → Toggle Toolbar | off |
