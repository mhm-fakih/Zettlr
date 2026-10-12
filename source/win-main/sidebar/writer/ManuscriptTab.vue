<template>
  <div role="tabpanel" class="manuscript-tab">
    <p v-if="roots.length === 0" class="manuscript-empty">
      {{ emptyMessage }}
    </p>
    <template v-else>
      <div class="manuscript-controls">
        <select
          v-if="roots.length > 1"
          v-model="selectedRoot"
          class="manuscript-root-select"
        >
          <option v-for="root in roots" v-bind:key="root.path" v-bind:value="root.path">
            {{ root.name }}
          </option>
        </select>
        <button
          ref="exportButton"
          type="button"
          class="manuscript-export-button"
          v-bind:disabled="isAssembling"
          v-bind:title="exportTitle"
          v-on:click="startExport"
        >{{ exportLabel }}</button>
      </div>
      <div v-if="rootActions.length > 0" class="manuscript-actions">
        <button
          v-for="action in rootActions"
          v-bind:key="action"
          type="button"
          v-bind:disabled="runningAction !== null"
          v-bind:title="ACTION_TITLES[action]"
          v-on:click="runAction(action)"
        >{{ runningAction === action ? workingLabel : ACTION_LABELS[action] }}</button>
      </div>
      <div
        v-if="actionStatus !== null"
        class="manuscript-action-status"
        v-bind:class="{ failed: !actionStatus.ok }"
        v-bind:title="actionStatus.output"
      >{{ actionStatus.summary }}</div>
      <template v-if="tree !== null">
        <!-- The manuscript renders as one note's ToC: headings only -->
        <div class="manuscript-total" dir="auto">
          {{ tree.label }} — {{ localiseNumber(tree.words) }} {{ wordsLabel }}
        </div>
        <ManuscriptNode
          v-for="(child, idx) in tree.children"
          v-bind:key="idx"
          v-bind:node="child"
          v-bind:depth="0"
          v-bind:parent-key="''"
          v-bind:collapsed-keys="collapsedKeys"
          v-on:toggle="toggleNode"
          v-on:jtl="emit('jtl', $event)"
        ></ManuscriptNode>
      </template>
    </template>

    <PopoverExport
      v-if="assembledPath !== '' && exportButton !== null"
      v-bind:target="exportButton"
      v-bind:file-path="assembledPath"
      v-on:close="assembledPath = ''"
    ></PopoverExport>
  </div>
</template>

<script setup lang="ts">
/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        ManuscriptTab
 * CVM-Role:        View
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     The manuscript sidebar panel (spec §3): shows master files
 *                  (files with structural includes) and their included notes
 *                  as one navigable tree of files and headings. Live-updates
 *                  via the writer index provider's broadcasts; collapse state
 *                  and root selection persist across restarts.
 *
 * END HEADER
 */

import { ref, computed, watch, onMounted } from 'vue'
import { trans } from '@common/i18n-renderer'
import localiseNumber from '@common/util/localise-number'
import type { ManuscriptTreeNode, WriterRoot } from '@dts/common/writer'
import type { WriterRootAction, WriterRootActionResult } from '@providers/writer'
import ManuscriptNode from './ManuscriptNode.vue'
import PopoverExport from '../../PopoverExport.vue'

const ipcRenderer = window.ipc

const SELECTED_ROOT_KEY = 'writer-manuscript-root'
const COLLAPSED_NODES_KEY = 'writer-manuscript-collapsed'

const emit = defineEmits<{
  (e: 'jtl', data: { filePath: string, lineNumber: number }): void
}>()

const roots = ref<WriterRoot[]>([])
const selectedRoot = ref<string>(window.localStorage.getItem(SELECTED_ROOT_KEY) ?? '')
const tree = ref<ManuscriptTreeNode|null>(null)
const collapsedKeys = ref<Set<string>>(loadCollapsedKeys())

const emptyMessage = computed(() => trans('No manuscript found. A file becomes a manuscript root once it embeds a note on its own line, e.g. ![](notes/chapter-1.md)'))

// Manuscript export (spec §5): assemble includes depth-first into a temp
// file, then hand it to Zettlr's regular export popover
const exportButton = ref<HTMLButtonElement|null>(null)
const isAssembling = ref<boolean>(false)
const assembledPath = ref<string>('')
const exportLabel = trans('Export…')
const exportTitle = trans('Assemble the manuscript and export it via Pandoc')
const wordsLabel = trans('words')

function startExport (): void {
  if (selectedRoot.value === '' || isAssembling.value) {
    return
  }

  isAssembling.value = true
  ipcRenderer.invoke('writer-provider', {
    command: 'assemble-manuscript',
    payload: { rootPath: selectedRoot.value }
  })
    .then((tempPath: string) => { assembledPath.value = tempPath })
    .catch(err => console.error(err))
    .finally(() => { isAssembling.value = false })
}

// Root actions: folder scripts next to the root (make-manuscript.py,
// make-site.py) that regenerate the manuscript or build its static site
const ACTION_LABELS: Record<WriterRootAction, string> = {
  'regenerate-manuscript': trans('Regenerate'),
  'build-site': trans('Build site')
}
const ACTION_TITLES: Record<WriterRootAction, string> = {
  'regenerate-manuscript': trans('Rebuild this manuscript from the notes in its folder (make-manuscript.py)'),
  'build-site': trans('Build the HTML site of this manuscript and open it (make-site.py)')
}
const workingLabel = trans('Working…')
const rootActions = ref<WriterRootAction[]>([])
const runningAction = ref<WriterRootAction|null>(null)
const actionStatus = ref<{ ok: boolean, summary: string, output: string }|null>(null)

function runAction (action: WriterRootAction): void {
  if (selectedRoot.value === '' || runningAction.value !== null) {
    return
  }

  runningAction.value = action
  actionStatus.value = null
  ipcRenderer.invoke('writer-provider', {
    command: 'run-root-action',
    payload: { rootPath: selectedRoot.value, action }
  })
    .then((result: WriterRootActionResult) => {
      const lines = result.output.split('\n').filter(line => line.trim() !== '')
      actionStatus.value = {
        ok: result.ok,
        // The scripts print their result first; failures end in the error
        summary: (result.ok ? lines[0] : lines[lines.length - 1]) ?? (result.ok ? trans('Done') : trans('Failed')),
        output: result.output
      }
    })
    .catch(err => {
      actionStatus.value = { ok: false, summary: String(err.message), output: String(err.message) }
    })
    .finally(() => { runningAction.value = null })
}

async function refreshRootActions (): Promise<void> {
  rootActions.value = selectedRoot.value === ''
    ? []
    : await ipcRenderer.invoke('writer-provider', {
      command: 'get-root-actions',
      payload: { rootPath: selectedRoot.value }
    })
}

onMounted(refresh)
ipcRenderer.on('writer-index', refresh)

watch(selectedRoot, () => {
  window.localStorage.setItem(SELECTED_ROOT_KEY, selectedRoot.value)
  actionStatus.value = null
  refreshTree().catch(err => console.error(err))
  refreshRootActions().catch(err => console.error(err))
})

function loadCollapsedKeys (): Set<string> {
  try {
    const stored = window.localStorage.getItem(COLLAPSED_NODES_KEY)
    return new Set(stored !== null ? JSON.parse(stored) as string[] : [])
  } catch (err) {
    return new Set()
  }
}

function toggleNode (key: string): void {
  const keys = new Set(collapsedKeys.value)
  if (keys.has(key)) {
    keys.delete(key)
  } else {
    keys.add(key)
  }
  collapsedKeys.value = keys
  window.localStorage.setItem(COLLAPSED_NODES_KEY, JSON.stringify([...keys]))
}

function refresh (): void {
  refreshRoots()
    .then(async () => await Promise.all([ refreshTree(), refreshRootActions() ]))
    .catch(err => console.error(err))
}

async function refreshRoots (): Promise<void> {
  roots.value = await ipcRenderer.invoke('writer-provider', { command: 'get-roots' })

  const stillValid = roots.value.some(root => root.path === selectedRoot.value)
  if (!stillValid) {
    selectedRoot.value = roots.value.length > 0 ? roots.value[0].path : ''
  }
}

async function refreshTree (): Promise<void> {
  if (selectedRoot.value === '') {
    tree.value = null
    return
  }

  const fullTree: ManuscriptTreeNode|null = await ipcRenderer.invoke('writer-provider', {
    command: 'get-tree',
    payload: { rootPath: selectedRoot.value }
  })

  tree.value = fullTree !== null ? inlineIncludedFiles(fullTree) : null
}

/**
 * Renders the manuscript as if it were a single note: included files don't
 * appear as nodes themselves — their headings are spliced in at the position
 * of the embed. Unresolvable includes (error nodes) remain visible.
 */
function inlineIncludedFiles (node: ManuscriptTreeNode): ManuscriptTreeNode {
  const children = node.children.flatMap(child => {
    if (child.type === 'file' && child.error === undefined) {
      return inlineIncludedFiles(child).children
    }
    return [inlineIncludedFiles(child)]
  })

  return { ...node, children }
}
</script>

<style lang="less">
body {
  div.manuscript-tab {
    p.manuscript-empty {
      font-size: 12px;
      opacity: 0.8;
    }

    div.manuscript-total {
      font-size: 10px;
      opacity: 0.7;
      margin-bottom: 6px;
      unicode-bidi: isolate;
    }

    div.manuscript-controls {
      display: flex;
      gap: 6px;
      margin-bottom: 8px;

      select.manuscript-root-select {
        flex: 1 1 auto;
        min-width: 0;
      }

      button.manuscript-export-button {
        flex: 0 0 auto;
      }
    }

    div.manuscript-actions {
      display: flex;
      gap: 6px;
      margin-bottom: 6px;

      button { flex: 1 1 0; }
    }

    div.manuscript-action-status {
      font-size: 10px;
      opacity: 0.75;
      margin-bottom: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;

      &.failed { color: #c33; opacity: 1; }
    }
  }
}
</style>
