# Master ToC format (for programmatic generation)

This document specifies the exact Markdown format the writer fork's manuscript
index understands. Hand it to any tool (or Claude Code session) that generates
master documents from a database. The parser implementing these rules lives in
`source/app/service-providers/writer/parse-writer-file.ts` and
`.../build-manuscript-tree.ts`; treat this document as the contract.

## What makes a file a manuscript root

Any Markdown file containing **at least one structural include** appears in the
Manuscript panel's root picker. A workspace may contain several roots; the tree
is built per root, on demand.

## Structural includes

A structural include is an embed that satisfies **all three** conditions:

1. It has the `!` prefix (embed, not a plain link).
2. Its target is a Markdown file (`.md`, or extensionless — `.md` is appended
   during resolution).
3. It is **alone on its own line at the top level** of the document — not
   inside a list, blockquote, table, fenced code block, or in the middle of a
   multi-line paragraph.

### Canonical form (generate this)

```markdown
![](notes/01-intro.md)
```

- Empty alt text, explicit **relative path from the including file**, explicit
  `.md` extension, one blank line before and after.
- Relative-path resolution is tried first and is unambiguous by construction —
  a generator must always emit relative paths, never bare names.

### Accepted but not canonical

| Form | Notes |
|---|---|
| `![alt text](notes/01-intro.md)` | Alt text is ignored |
| `![](notes/01-intro.md "title")` | Title is ignored |
| `![](<notes/with spaces.md>)` | Use angle brackets if the path contains spaces; otherwise the target is cut at the first space |
| `![](notes/01-intro)` | Extensionless: `.md` is appended |
| `![[01-intro]]` | Wikilink embed: resolved relative-first, then by unique name across the workspace; `![[target\|title]]` and `![[target#heading]]` are stripped to `target` |
| `%20`-encoded paths | Decoded before resolution |

### Explicitly NOT structural includes

```markdown
[Chapter 1](notes/01-intro.md)        <- no `!`: plain link, navigable only
![](diagram.png)                      <- non-Markdown target: an image
Text before ![](notes/x.md) or after  <- inline: transclusion, not a tree node
- ![](notes/x.md)                     <- inside a list
> ![](notes/x.md)                     <- inside a blockquote
```

## Tree semantics

- **Headings and includes interleave in document order.** An include nests
  under the innermost heading section it appears in. Headings nest by level
  (`##` under the preceding `#`, etc.).
- **Recursion** is allowed: included files may include further files.
  Depth cap: **8 file levels**; deeper includes become error nodes.
- **Cycles** (a file including any of its ancestors or itself) are detected
  and shown as error nodes — never followed.
- **Missing targets** are shown as error nodes; files are never auto-created.
- **Ambiguous names** (a name-based `![[wikilink]]` matching several files)
  are error nodes; the resolver never guesses. Relative paths cannot be
  ambiguous — another reason generators must emit them.
- Word-count badges: a heading counts its section (including subsections);
  a file counts its own words plus all included descendants.

## Frontmatter keys the fork understands

```markdown
---
title: Display title            # used as display title where applicable
direction: rtl                  # ltr | rtl | auto — overrides the app default
lang: ar                        # used for ToC direction if `direction` absent
---
```

All keys are optional. For Arabic chapters, setting `lang: ar` (or relying on
first-strong-character detection) is usually enough; use `direction:` only to
force a direction.

## Annotations picked up by the index

- **TODOs** (TODO panel + editor gutter): `TODO:`, `FIXME:`, `QUESTION:`,
  `SOURCE:` at the start of a line, mid-prose, in list items, or in HTML
  comments (`<!-- TODO: ... -->`). Not recognised inside fenced code blocks or
  the frontmatter. The message is the rest of the line.
- **Codes** (Codes panel + editor highlight): standalone letter-digit-letter
  tokens, e.g. `T3Z` — exactly one letter, one digit, one letter, not embedded
  in a longer alphanumeric run. Any Unicode letters/digits work (`م٣ك`).

## DB-sync field markers

Notes generated from the database delimit their sections with marker lines of
the form:

```markdown
@@ summary @@
Backup items

@@ description @@
backup profiles

@@ notes @@
...
```

Contract:

- A marker line matches `/^@@\s*[^@\n]+?\s*@@\s*$/` — `@@`, a field name,
  `@@`, alone on its line. Everything until the next marker (or EOF) is that
  field's content.
- The markers are **inert for parsing**: not headings, not includes, not
  TODOs/codes; the editor and the manuscript index treat them as plain text.
- On **manuscript export** the marker lines are stripped by default (the
  section content is kept) — configurable in Preferences > Import/Export.
- The sync feature reads/writes these sections; generators must keep marker
  lines intact and must not indent them or place them inside fenced code.

## File conventions for generators

- UTF-8, LF line endings, one trailing newline.
- One blank line between consecutive includes (each must be its own
  top-level paragraph — two embeds on adjacent lines would merge into one
  paragraph and stop being structural).
- Prefer ASCII-safe, space-free file names (`01-intro.md`); Arabic titles go
  in the frontmatter `title:` or the first heading, not the file name.
- Number files for stable ordering (`01-`, `02-`, …): the tree order is the
  document order of the embed lines, so the master file is the single source
  of ordering truth.

## Complete example

```markdown
---
title: كتاب التحرير
direction: rtl
---

# كتاب التحرير

TODO: write the preamble.

## الجزء الأول

![](notes/01-intro.md)

![](notes/02-sources.md)

## الجزء الثاني

![[03-analysis]]
```

This yields one tree: the two `##` headings under the root, each include as a
child of its heading, and each included file's own headings as its children.
