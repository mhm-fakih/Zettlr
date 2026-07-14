/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        TODO gutter
 * CVM-Role:        CodeMirror Extension
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Shows a marker in the editor gutter on lines containing a
 *                  TODO-style annotation (spec §4.6), using the same scanner
 *                  as the writer index.
 *
 * END HEADER
 */

import { StateField, type Extension } from '@codemirror/state'
import { EditorView, gutter, GutterMarker } from '@codemirror/view'
import { scanTodos } from '@common/util/scan-todos'

class TodoMarker extends GutterMarker {
  toDOM (): HTMLElement {
    const element = document.createElement('span')
    element.className = 'cm-todo-marker'
    element.textContent = '●'
    return element
  }
}

const todoMarker = new TodoMarker()

/**
 * The set of 1-indexed lines containing a TODO annotation
 */
const todoLinesField = StateField.define<Set<number>>({
  create (state) {
    return new Set(scanTodos(state.doc.toString()).map(todo => todo.line))
  },
  update (value, transaction) {
    if (!transaction.docChanged) {
      return value
    }
    return new Set(scanTodos(transaction.newDoc.toString()).map(todo => todo.line))
  }
})

const todoGutterTheme = EditorView.baseTheme({
  '.cm-gutter.cm-todo-gutter': {
    width: '10px'
  },
  '.cm-todo-marker': {
    color: 'var(--system-accent-color, #253592)',
    fontSize: '8px',
    lineHeight: 'inherit',
    cursor: 'default'
  }
})

/**
 * A gutter that marks lines containing TODO annotations.
 *
 * @return  {Extension}  The extension
 */
export function writerTodoGutter (): Extension {
  return [
    todoLinesField,
    gutter({
      class: 'cm-todo-gutter',
      lineMarker (view, line) {
        const lineNumber = view.state.doc.lineAt(line.from).number
        return view.state.field(todoLinesField).has(lineNumber) ? todoMarker : null
      },
      lineMarkerChange (update) {
        return update.state.field(todoLinesField) !== update.startState.field(todoLinesField)
      }
    }),
    todoGutterTheme
  ]
}
