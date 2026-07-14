# SPEC — Writing IDE (Zettlr fork)

A Markdown writing environment with LaTeX-style includes, a master/notes TOC tree,
a TODO index, and first-class Arabic/English bidirectional typing.

**Base:** [Zettlr](https://github.com/Zettlr/Zettlr) v4.6.0 — Electron + Vue 3 + TypeScript + CodeMirror 6, GPL-3.0.
**Fork obligations:** GPL-3.0. Keep the licence, keep attribution, publish sources if distributed.

---

## 0. Ground rules for the agent

| Rule | Reason |
|---|---|
| **Do reconnaissance before writing code.** No file path in this spec is authoritative — I have not verified Zettlr's internal layout. Find the real ones. | Prevents building on hallucinated structure. |
| **Minimise the diff.** New code in new files under a `writer/` namespace wherever possible. Touch existing Zettlr files only at explicit integration points. | We want to rebase on upstream Zettlr for years. A sprawling diff kills that. |
| **One phase at a time. Build and run after each.** `yarn lint && yarn test && yarn start` (verify actual scripts in `package.json`). | Electron builds fail loudly; use that. |
| **Do not refactor Zettlr.** Resist all urges. | Not our repo. |
| **Ask before adding a dependency.** CM6, Vue, and markdown-it are already present; almost nothing new should be needed. | Dependency creep. |

### Phase 0 — Recon (do this first, report back, write no features)

Produce a short `ARCHITECTURE-NOTES.md` answering:

1. Where is the CodeMirror 6 editor constructed? What is the extension list, and how are extensions added/configured?
2. How does Zettlr model a workspace/folder and an open document? What is the file-tree component and its data source?
3. What is the main↔renderer IPC pattern? How do "providers" (main-process services) expose data to the renderer?
4. How are sidebars/panels registered, and can a new panel be added without modifying core layout components?
5. Which Markdown parser is used for preview/export, and where does `markdown-it` (or equivalent) get configured?
6. What are the real build/test/lint commands, and does `yarn start` give a working dev loop with HMR?
7. **Critical for §2:** how does Zettlr currently parse and resolve `[[wikilinks]]` and `![](path)` embeds? Does it already treat `![[note]]` or `![](note.md)` as a transclusion, or only as an image/link? Is there an existing link-index we can read instead of building our own? If Zettlr already assigns meaning to these, report it before we overload the syntax.

Stop after this and show me the notes.

---

## 1. Phase 1 — Bidi / Arabic typing (do this first; it is the reason for the fork)

This is the highest-value, smallest-diff change. If it doesn't work, the project is dead and we've lost a day, not a month.

### Requirements

| # | Requirement |
|---|---|
| 1.1 | Enable CM6 `EditorView.perLineTextDirection.of(true)` on the Markdown editor. |
| 1.2 | Add `dir="auto"` to every rendered line (a `ViewPlugin`/line decoration adding the attribute), so each line's base direction is resolved from its first strong character. |
| 1.3 | Enable CM6 `bidiIsolates` so Markdown syntax (`[]()`, `**`, `` ` ``, `#`) is not swallowed by a surrounding Arabic run. |
| 1.4 | Verify cursor motion is **visual** (← moves left regardless of run direction) and that Backspace/Delete remain **logical**. This is CM6 default; confirm, don't reimplement. |
| 1.5 | Per-document base-direction override: `ltr` \| `rtl` \| `auto` (default `auto`), persisted in YAML frontmatter as `direction:`. Toggle in the UI. |
| 1.6 | The **preview/export** renderer must match: `dir="auto"` per block element, or `unicode-bidi: plaintext` on block containers. |
| 1.7 | Editor chrome (line numbers, gutters, status bar) must NOT mirror. Only text direction changes, not layout. |

### Reference implementations to read first
- Joplin PR #10810 — enables `perLineTextDirection.of(true)` + `dir=auto` per line in a CM6 Markdown editor. Closest prior art; read it before writing anything.
- `obsidian-rtl` PR #48 — auto direction per line via the same CM6 primitives.
- <https://codemirror.net/examples/bidi/>

### Acceptance (I will test this by hand)
- Type a paragraph of Arabic, then a paragraph of English, then a paragraph mixing both. Each line orients correctly on its own.
- Place the caret mid-line in a Latin word inside an Arabic sentence; arrow left/right; the caret goes where the eye expects.
- Select across an Arabic→English boundary with shift+arrows and with the mouse; the selection is contiguous and sane.
- A Markdown link with an Arabic label and a Latin URL renders coherently, brackets and parens on the correct sides.
- No regression for pure-LTR documents.

**Stop here and let me use it for a few days before proceeding.**

---

## 2. Data model — includes via Obsidian-style embeds

Reuse Markdown embed syntax. Portable to Obsidian/Logseq/Foam; leverages Zettlr's existing link
resolver, autocomplete, and backlinks rather than inventing a parallel mechanism.

```markdown
# The Master Document

![](notes/01-intro.md)
![](notes/02-sources.md)
```

### The `!` carries the semantics

| Syntax | Meaning |
|---|---|
| `![](notes/01-intro.md)` **on its own line, top level** | **Structural include.** A child node in the manuscript tree; concatenated on export. **Canonical form — normalise to this.** |
| `![[notes/01-intro]]` | Same. Accept and support; resolve via Zettlr's existing wikilink resolver. |
| `[Chapter 1](notes/01-intro.md)` (no `!`) | A plain link. Navigable and backlinked, but **not** a manuscript child. |
| `![](notes/aside.md)` **inline / nested in a list or quote** | Transclusion — render inline in preview, but **not** a tree node. |
| `![](diagram.png)` | An image. Not an include. Only `.md` targets are structural. |

### Rules

| Rule | Value |
|---|---|
| Structural-include test | `!` prefix **AND** target resolves to `.md` **AND** the embed is alone on its line at top level (not inside a list, blockquote, or fenced code) |
| Path resolution | Prefer explicit relative paths (relative to the **including** file). Fall back to Zettlr's name-based wikilink resolver. Ambiguous name → surface as an error, do not guess. |
| Recursion | Allowed. Depth cap 8. Cycles detected and surfaced as an error, never a hang. |
| Files stay separate | **No concatenation into one buffer.** N independent documents + a virtual index. Concatenation destroys undo, cursor state, and per-file frontmatter. |
| Missing target | Shown in the tree in an error state; never crashes; never auto-creates |
| Master file | Any file containing ≥1 structural include is a potential root. A workspace may have several. |

**Do not change Zettlr's existing `[[wikilink]]` link semantics.** We are *reading* its resolver and
*adding* meaning to the `!`-prefixed embed form. Non-embed links behave exactly as they do today.

Build this as a **main-process index provider**: scan workspace `.md` files, parse frontmatter + headings + embeds (§2) + TODOs into an in-memory index, keep it current via the existing file-watcher, expose it to the renderer over the existing IPC pattern. Incremental — re-parse only changed files.

---

## 3. Phase 2 — Manuscript view (master TOC + notes TOC, one tree)

A new sidebar panel: **Manuscript**.

```
📄 master.md                    ← root (has includes)
   ├─ # Introduction            ← headings of master.md itself
   ├─ 📄 01-intro.md            ← included file
   │    ├─ ## Background
   │    │    └─ ### Sources     ← nested headings
   │    └─ ## Method
   └─ 📄 02-sources.md
        └─ ## Bibliography
```

| # | Requirement |
|---|---|
| 3.1 | Master TOC and per-note TOC are **the same tree** at different depths. No separate outline panel. |
| 3.2 | Click a heading → open that file, scroll to that line, place cursor. |
| 3.3 | Click a file node → open it. |
| 3.4 | Live update on save (and ideally on edit, debounced ~300ms). |
| 3.5 | Collapse/expand state persists across restart. |
| 3.6 | Heading text renders with `dir="auto"` — Arabic headings must read correctly in the tree. |
| 3.7 | Show a word-count badge per node (file and heading subtree). Cheap, and genuinely useful for writing. |
| 3.8 | *(stretch, only if clean)* Drag to reorder siblings → rewrites the order of the embed lines in the parent file. Do not attempt if it fights the tree component. |

---

## 4. Phase 3 — TODO index

| # | Requirement |
|---|---|
| 4.1 | Harvest `TODO:`, `FIXME:`, `QUESTION:`, `SOURCE:` from Markdown text. Tags configurable in settings. |
| 4.2 | Recognised in prose, in HTML comments (`<!-- TODO: ... -->`), and in list items. **Not** inside fenced code blocks. |
| 4.3 | A new **TODO** panel: flat list, grouped by file, showing tag, message, file, line. |
| 4.4 | Click → open file at that line. |
| 4.5 | Filter by tag; filter by "current manuscript tree only" vs "whole workspace". |
| 4.6 | Gutter marker in the CM6 editor on lines with a TODO. |
| 4.7 | Messages render `dir="auto"` (Arabic TODOs are the norm, not the exception). |
| 4.8 | Index lives in the same main-process provider as §2. Do not build a second scanner. |

---

## 5. Phase 4 — Export

| # | Requirement |
|---|---|
| 5.1 | "Export manuscript" from a master file: resolve includes depth-first, concatenate in order, hand to Zettlr's existing Pandoc export pipeline. |
| 5.2 | Heading levels of included files shift by nesting depth (a `#` in a file included at depth 2 becomes `###`). Make this a setting; default on. |
| 5.3 | TODO lines are **stripped** from export by default. Setting to keep them. |
| 5.4 | Reuse Zettlr's exporter. Do not write a new one. |

---

## 6. Explicit non-goals

Zotero/citations (Zettlr already has it — leave alone) · WYSIWYG · collaboration · mobile · LSP · plugin API · rewriting Zettlr's file tree · changing the meaning of non-embed links · a new link resolver (reuse Zettlr's).

---

## 7. Definition of done

I can open a workspace, see `master.md` and its included notes as one navigable tree, jump to any heading, write a paragraph of mixed Arabic and English **without fighting the caret**, drop a `TODO:` mid-sentence and find it in the TODO panel seconds later, and export the whole thing to a single PDF.
