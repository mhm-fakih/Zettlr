<template>
  <div role="tabpanel" class="manuscript-tab">
    <p v-if="roots.length === 0" class="manuscript-empty">
      {{ emptyMessage }}
    </p>
    <template v-else>
      <select
        v-if="roots.length > 1"
        v-model="selectedRoot"
        class="manuscript-root-select"
      >
        <option v-for="root in roots" v-bind:key="root.path" v-bind:value="root.path">
          {{ root.name }}
        </option>
      </select>
      <ManuscriptNode
        v-if="tree !== null"
        v-bind:node="tree"
        v-bind:depth="0"
        v-bind:parent-key="''"
        v-bind:collapsed-keys="collapsedKeys"
        v-on:toggle="toggleNode"
        v-on:jtl="emit('jtl', $event)"
      ></ManuscriptNode>
    </template>
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
import type { ManuscriptTreeNode, WriterRoot } from '@dts/common/writer'
import ManuscriptNode from './ManuscriptNode.vue'

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

onMounted(refresh)
ipcRenderer.on('writer-index', refresh)

watch(selectedRoot, () => {
  window.localStorage.setItem(SELECTED_ROOT_KEY, selectedRoot.value)
  refreshTree().catch(err => console.error(err))
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
    .then(async () => await refreshTree())
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

  tree.value = await ipcRenderer.invoke('writer-provider', {
    command: 'get-tree',
    payload: { rootPath: selectedRoot.value }
  })
}
</script>

<style lang="less">
body {
  div.manuscript-tab {
    p.manuscript-empty {
      font-size: 12px;
      opacity: 0.8;
    }

    select.manuscript-root-select {
      width: 100%;
      margin-bottom: 8px;
    }
  }
}
</style>
