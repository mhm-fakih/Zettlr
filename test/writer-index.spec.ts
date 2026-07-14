/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Writer index tests
 * CVM-Role:        Test
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Tests the writer index parser (structural includes,
 *                  headings, TODOs) and the manuscript tree builder.
 *
 * END HEADER
 */

import { strictEqual, deepStrictEqual, ok } from 'assert'
import { parseWriterFile } from 'source/app/service-providers/writer/parse-writer-file'
import { assembleManuscript } from 'source/app/service-providers/writer/assemble-manuscript'
import { scanTodos } from 'source/common/util/scan-todos'
import { scanLdlCodes } from 'source/common/util/scan-codes'
import { buildManuscriptTree, type IncludeResolver } from 'source/app/service-providers/writer/build-manuscript-tree'
import type { WriterFileEntry } from 'source/types/common/writer'

describe('Writer#parseWriterFile()', function () {
  it('detects structural includes and ignores non-structural embeds', function () {
    const content = `# Master

![](notes/01-intro.md)

![[notes/02-sources]]

![Alt text](notes/03-with-title.md "A title")

![](diagram.png)

Inline mention ![](notes/inline.md) inside a paragraph.

- ![](notes/in-list.md)

> ![](notes/in-quote.md)

\`\`\`
![](notes/in-fence.md)
\`\`\`

[Just a link](notes/plain-link.md)
`
    const entry = parseWriterFile('/ws/master.md', content)
    deepStrictEqual(entry.includes.map(i => i.target), [
      'notes/01-intro.md',
      'notes/02-sources',
      'notes/03-with-title.md'
    ])
    deepStrictEqual(entry.includes.map(i => i.line), [ 3, 5, 7 ])
  })

  it('extracts headings with levels, lines, and word counts', function () {
    const content = `# One

two words

## Nested

three more words

# Two

end
`
    const entry = parseWriterFile('/ws/file.md', content)
    deepStrictEqual(entry.headings.map(h => [ h.level, h.text, h.line ]), [
      [ 1, 'One', 1 ],
      [ 2, 'Nested', 5 ],
      [ 1, 'Two', 9 ]
    ])
    // Section of '# One' includes '## Nested' subsection; both end at '# Two'
    ok(entry.headings[0].words > entry.headings[1].words)
    strictEqual(entry.words > 0, true)
  })

  it('parses Arabic headings correctly', function () {
    const entry = parseWriterFile('/ws/ar.md', '# مقدمة في التحرير\n\nنص عربي هنا\n')
    deepStrictEqual(entry.headings.map(h => h.text), ['مقدمة في التحرير'])
  })
})

describe('Writer#scanTodos()', function () {
  it('harvests tags from prose, comments, and lists, but not fences or frontmatter', function () {
    const content = `---
title: TODO: not this one
---

TODO: plain prose todo

<!-- FIXME: in a comment -->

- QUESTION: in a list item

Some sentence with SOURCE: find a citation

\`\`\`js
// TODO: not this one either
\`\`\`
`
    const todos = scanTodos(content)
    deepStrictEqual(todos.map(t => [ t.tag, t.message ]), [
      [ 'TODO', 'plain prose todo' ],
      [ 'FIXME', 'in a comment' ],
      [ 'QUESTION', 'in a list item' ],
      [ 'SOURCE', 'find a citation' ]
    ])
    deepStrictEqual(todos.map(t => t.line), [ 5, 7, 9, 11 ])
  })

  it('supports custom tags', function () {
    const todos = scanTodos('NB: note this\n', ['NB'])
    deepStrictEqual(todos.map(t => [ t.tag, t.message ]), [[ 'NB', 'note this' ]])
  })
})

describe('Writer#scanLdlCodes()', function () {
  it('finds standalone letter-digit-letter codes', function () {
    const codes = scanLdlCodes('See T3Z and k9m here.\nSecond line has A1B.\n')
    deepStrictEqual(codes.map(c => [ c.code, c.line ]), [
      [ 'T3Z', 1 ],
      [ 'k9m', 1 ],
      [ 'A1B', 2 ]
    ])
  })

  it('ignores codes embedded in longer alphanumeric runs', function () {
    deepStrictEqual(scanLdlCodes('xT3Z T3Zx T3Z9 9T3Z aT3Za'), [])
  })

  it('supports non-Latin letters and digits', function () {
    const codes = scanLdlCodes('رمز م٣ك في النص')
    deepStrictEqual(codes.map(c => c.code), ['م٣ك'])
  })
})

describe('Writer#buildManuscriptTree()', function () {
  function makeEntry (path: string, partial: Partial<WriterFileEntry>): [string, WriterFileEntry] {
    return [ path, {
      path,
      name: path.split('/').pop() ?? path,
      words: 0,
      headings: [],
      includes: [],
      todos: [],
      codes: [],
      ...partial
    } ]
  }

  const resolver: IncludeResolver = (source, target) => {
    if (target.includes('missing')) {
      return { error: 'missing' }
    }
    if (target.includes('ambiguous')) {
      return { error: 'ambiguous' }
    }
    const dir = source.slice(0, source.lastIndexOf('/'))
    return { path: `${dir}/${target}` }
  }

  it('interleaves headings and includes and nests included files under sections', function () {
    const entries = new Map<string, WriterFileEntry>([
      makeEntry('/ws/master.md', {
        words: 10,
        headings: [
          { level: 1, text: 'Part One', line: 1, words: 10 },
          { level: 1, text: 'Part Two', line: 7, words: 0 }
        ],
        includes: [
          { target: 'ch1.md', line: 3 },
          { target: 'ch2.md', line: 9 }
        ]
      }),
      makeEntry('/ws/ch1.md', {
        words: 100,
        headings: [{ level: 2, text: 'Background', line: 1, words: 100 }]
      }),
      makeEntry('/ws/ch2.md', { words: 50 })
    ])

    const tree = buildManuscriptTree('/ws/master.md', entries, resolver)
    ok(tree !== null)
    strictEqual(tree.type, 'file')
    // Root words = own + included descendants
    strictEqual(tree.words, 160)
    // Two part headings at the top level
    deepStrictEqual(tree.children.map(c => [ c.type, c.label ]), [
      [ 'heading', 'Part One' ],
      [ 'heading', 'Part Two' ]
    ])
    // The includes nest under their respective sections
    deepStrictEqual(tree.children[0].children.map(c => [ c.type, c.label ]), [[ 'file', 'ch1.md' ]])
    deepStrictEqual(tree.children[1].children.map(c => [ c.type, c.label ]), [[ 'file', 'ch2.md' ]])
    // The included file's own headings are its children
    deepStrictEqual(tree.children[0].children[0].children.map(c => c.label), ['Background'])
  })

  it('marks missing and ambiguous targets as error nodes', function () {
    const entries = new Map<string, WriterFileEntry>([
      makeEntry('/ws/master.md', {
        includes: [
          { target: 'missing.md', line: 1 },
          { target: 'ambiguous.md', line: 2 }
        ]
      })
    ])

    const tree = buildManuscriptTree('/ws/master.md', entries, resolver)
    ok(tree !== null)
    deepStrictEqual(tree.children.map(c => c.error), [ 'missing', 'ambiguous' ])
  })

  it('detects cycles instead of hanging', function () {
    const entries = new Map<string, WriterFileEntry>([
      makeEntry('/ws/a.md', { includes: [{ target: 'b.md', line: 1 }] }),
      makeEntry('/ws/b.md', { includes: [{ target: 'a.md', line: 1 }] })
    ])

    const tree = buildManuscriptTree('/ws/a.md', entries, resolver)
    ok(tree !== null)
    const b = tree.children[0]
    strictEqual(b.label, 'b.md')
    strictEqual(b.error, undefined)
    strictEqual(b.children[0].error, 'cycle')
  })

  it('marks self-includes as cycles', function () {
    const entries = new Map<string, WriterFileEntry>([
      makeEntry('/ws/a.md', { includes: [{ target: 'a.md', line: 1 }] })
    ])

    const tree = buildManuscriptTree('/ws/a.md', entries, resolver)
    ok(tree !== null)
    strictEqual(tree.children[0].error, 'cycle')
  })

  it('caps the include depth at 8', function () {
    const entries = new Map<string, WriterFileEntry>(
      Array.from({ length: 12 }, (_, i) => makeEntry(`/ws/f${i}.md`, {
        includes: i < 11 ? [{ target: `f${i + 1}.md`, line: 1 }] : []
      }))
    )

    const tree = buildManuscriptTree('/ws/f0.md', entries, resolver)
    ok(tree !== null)
    let node = tree
    let depth = 0
    while (node.children.length > 0 && node.children[0].error === undefined) {
      node = node.children[0]
      depth++
    }
    strictEqual(node.children[0]?.error, 'depth')
    strictEqual(depth, 7) // f0 (depth 0) … f7; f8 would be depth 8 -> blocked
  })

  it('returns null for unindexed roots', function () {
    strictEqual(buildManuscriptTree('/nope.md', new Map(), resolver), null)
  })
})

describe('Writer#assembleManuscript()', function () {
  const FILES: Record<string, string> = {
    '/ws/master.md': `---
title: The Book
---

# Part One

TODO: fix the intro.

![](ch1.md)

![](missing.md)
`,
    '/ws/ch1.md': `---
title: Chapter One
---

# Chapter One

Some text. FIXME: revise.

## Detail

\`\`\`
# not a heading, and TODO: not a todo
\`\`\`

![](ch2.md)
`,
    '/ws/ch2.md': `# Deep Chapter

Deepest text.
`
  }

  const readFile = async (p: string): Promise<string> => {
    const content = FILES[p]
    if (content === undefined) {
      throw new Error(`No such file: ${p}`)
    }
    return content
  }

  const resolver = (source: string, target: string): { path?: string, error?: 'missing'|'ambiguous' } => {
    const dir = source.slice(0, source.lastIndexOf('/'))
    const resolved = `${dir}/${target}`
    return resolved in FILES ? { path: resolved } : { error: 'missing' }
  }

  it('splices includes depth-first with heading shift and TODO stripping', async function () {
    const result = await assembleManuscript('/ws/master.md', readFile, resolver, {
      shiftHeadings: true,
      stripTodos: true
    })

    // Root frontmatter survives, included frontmatter does not
    ok(result.startsWith('---\ntitle: The Book'))
    ok(!result.includes('Chapter One\n---'))
    // TODO/FIXME lines are gone
    ok(!result.includes('TODO: fix the intro'))
    ok(!result.includes('FIXME: revise'))
    // Heading shift: depth 1 => ##, depth 2 => ###; fenced pseudo-heading untouched
    ok(result.includes('\n## Chapter One'))
    ok(result.includes('\n### Detail'))
    ok(result.includes('\n### Deep Chapter'))
    ok(result.includes('# not a heading, and TODO: not a todo'))
    // Unresolved include becomes a comment marker
    ok(result.includes('<!-- writer-export: unresolved include "missing.md" (missing) -->'))
    // No embed lines survive
    ok(!result.includes('!['))
  })

  it('keeps headings and TODOs when the settings say so', async function () {
    const result = await assembleManuscript('/ws/master.md', readFile, resolver, {
      shiftHeadings: false,
      stripTodos: false
    })

    ok(result.includes('\n# Chapter One'))
    ok(result.includes('TODO: fix the intro'))
    ok(result.includes('FIXME: revise'))
  })

  it('injects the pandoc working directory into the root frontmatter', async function () {
    const result = await assembleManuscript('/ws/master.md', readFile, resolver, {
      shiftHeadings: true,
      stripTodos: true,
      pandocWorkingDir: '/ws'
    })

    ok(result.includes('zettlr:\n  pandoc_working_dir: "/ws"'))
    // Injected before the closing fence of the root frontmatter
    ok(result.indexOf('pandoc_working_dir') < result.indexOf('# Part One'))
  })

  it('marks circular includes instead of hanging', async function () {
    const cyclic: Record<string, string> = {
      '/ws/a.md': '![](b.md)\n',
      '/ws/b.md': '![](a.md)\n'
    }
    const read = async (p: string): Promise<string> => cyclic[p]
    const res = (source: string, target: string): { path?: string } => ({ path: `/ws/${target}` })

    const result = await assembleManuscript('/ws/a.md', read, res, {
      shiftHeadings: true,
      stripTodos: true
    })
    ok(result.includes('circular include "a.md" skipped'))
  })
})
