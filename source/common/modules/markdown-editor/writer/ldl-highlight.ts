/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        LDL code highlighter
 * CVM-Role:        CodeMirror Extension
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Highlights standalone letter-digit-letter codes (e.g.
 *                  T3Z) in the editor: the code itself gets a dark
 *                  background, and the line containing it a light one. Uses
 *                  the same pattern as the writer index's codes panel.
 *
 * END HEADER
 */

import { RangeSetBuilder, StateField, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, gutter, GutterMarker, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { LDL_CODE_RE, scanLdlCodes } from '@common/util/scan-codes'

const codeDecoration = Decoration.mark({ class: 'cm-ldl-code' })
const lineDecoration = Decoration.line({ class: 'cm-ldl-line' })

function buildDecorations (view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()

  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      const matches = [...line.text.matchAll(LDL_CODE_RE)]
      if (matches.length > 0) {
        builder.add(line.from, line.from, lineDecoration)
        for (const match of matches) {
          builder.add(line.from + (match.index ?? 0), line.from + (match.index ?? 0) + match[0].length, codeDecoration)
        }
      }
      pos = line.to + 1
    }
  }

  return builder.finish()
}

const ldlPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor (view: EditorView) {
    this.decorations = buildDecorations(view)
  }

  update (update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildDecorations(update.view)
    }
  }
}, { decorations: plugin => plugin.decorations })

class LdlMarker extends GutterMarker {
  toDOM (): HTMLElement {
    const element = document.createElement('span')
    element.className = 'cm-ldl-marker'
    element.textContent = '◆'
    return element
  }
}

const ldlMarker = new LdlMarker()

/**
 * The set of 1-indexed lines containing an LDL code (gutter marker, analogous
 * to the TODO gutter)
 */
const ldlLinesField = StateField.define<Set<number>>({
  create (state) {
    return new Set(scanLdlCodes(state.doc.toString()).map(entry => entry.line))
  },
  update (value, transaction) {
    if (!transaction.docChanged) {
      return value
    }
    return new Set(scanLdlCodes(transaction.newDoc.toString()).map(entry => entry.line))
  }
})

const ldlTheme = EditorView.baseTheme({
  // The line carrying a code gets a light background ...
  '.cm-ldl-line': {
    backgroundColor: 'rgba(255, 246, 190, 0.45)'
  },
  '&dark .cm-ldl-line': {
    backgroundColor: 'rgba(255, 255, 255, 0.07)'
  },
  // ... the code itself a dark one
  '.cm-ldl-code': {
    backgroundColor: 'rgb(45, 45, 55)',
    color: 'rgb(255, 255, 255)',
    borderRadius: '3px',
    padding: '0 3px'
  },
  '&dark .cm-ldl-code': {
    backgroundColor: 'rgb(10, 10, 15)',
    color: 'rgb(255, 255, 255)'
  },
  '.cm-gutter.cm-ldl-gutter': {
    width: '10px'
  },
  '.cm-ldl-marker': {
    color: 'rgb(45, 45, 55)',
    fontSize: '7px',
    lineHeight: 'inherit',
    cursor: 'default'
  },
  '&dark .cm-ldl-marker': {
    color: 'rgb(200, 200, 210)'
  }
})

/**
 * Highlights standalone letter-digit-letter codes and their lines, and marks
 * those lines in the gutter (analogous to the TODO gutter).
 *
 * @return  {Extension}  The extension
 */
export function writerLdlHighlight (): Extension {
  return [
    ldlPlugin,
    ldlLinesField,
    gutter({
      class: 'cm-ldl-gutter',
      lineMarker (view, line) {
        const lineNumber = view.state.doc.lineAt(line.from).number
        return view.state.field(ldlLinesField).has(lineNumber) ? ldlMarker : null
      },
      lineMarkerChange (update) {
        return update.state.field(ldlLinesField) !== update.startState.field(ldlLinesField)
      }
    }),
    ldlTheme
  ]
}
