<template>
  <div role="tabpanel" class="todo-tab">
    <div class="todo-filters">
      <select v-model="scope" class="todo-scope-select">
        <option value="workspace">{{ workspaceLabel }}</option>
        <option value="manuscript">{{ manuscriptLabel }}</option>
      </select>
      <div class="todo-tag-filters">
        <button
          v-for="tag in presentTags"
          v-bind:key="tag"
          type="button"
          class="todo-tag-chip"
          v-bind:class="{ inactive: disabledTags.has(tag) }"
          v-on:click="toggleTag(tag)"
        >{{ tag }}</button>
      </div>
    </div>

    <p v-if="filteredGroups.length === 0" class="todo-empty">
      {{ emptyLabel }}
    </p>

    <div v-for="group in filteredGroups" v-bind:key="group.path" class="todo-file-group">
      <div class="todo-file-name" dir="auto">{{ group.name }}</div>
      <div
        v-for="(todo, idx) in group.todos"
        v-bind:key="idx"
        class="todo-item"
        v-on:click="emit('jtl', { filePath: group.path, lineNumber: todo.line })"
      >
        <span class="todo-tag" v-bind:data-tag="todo.tag">{{ todo.tag }}</span>
        <span class="todo-message" dir="auto">{{ todo.message }}</span>
        <span class="todo-line">{{ todo.line }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        TodoTab
 * CVM-Role:        View
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     The TODO sidebar panel (spec §4): a flat list of TODO
 *                  annotations grouped by file, filterable by tag and by
 *                  scope (whole workspace vs. the current manuscript tree).
 *                  Clicking an entry opens the file at that line.
 *
 * END HEADER
 */

import { ref, computed, onMounted } from 'vue'
import { trans } from '@common/i18n-renderer'
import type { ManuscriptTreeNode, WriterFileEntry } from '@dts/common/writer'

type TodoGroup = Pick<WriterFileEntry, 'path'|'name'|'todos'>

const ipcRenderer = window.ipc

// Shared with ManuscriptTab: which manuscript root is selected
const SELECTED_ROOT_KEY = 'writer-manuscript-root'
const SCOPE_KEY = 'writer-todo-scope'

const emit = defineEmits<{
  (e: 'jtl', data: { filePath: string, lineNumber: number }): void
}>()

const workspaceLabel = trans('Whole workspace')
const manuscriptLabel = trans('Current manuscript')
const emptyLabel = trans('No TODOs found')

const groups = ref<TodoGroup[]>([])
const manuscriptFiles = ref<Set<string>>(new Set())
const scope = ref<string>(window.localStorage.getItem(SCOPE_KEY) ?? 'workspace')
const disabledTags = ref<Set<string>>(new Set())

const presentTags = computed(() => {
  const tags = new Set<string>()
  for (const group of groups.value) {
    for (const todo of group.todos) {
      tags.add(todo.tag)
    }
  }
  return [...tags].sort()
})

const filteredGroups = computed(() => {
  return groups.value
    .filter(group => scope.value === 'workspace' || manuscriptFiles.value.has(group.path))
    .map(group => ({
      ...group,
      todos: group.todos.filter(todo => !disabledTags.value.has(todo.tag))
    }))
    .filter(group => group.todos.length > 0)
})

onMounted(refresh)
ipcRenderer.on('writer-index', refresh)

function toggleTag (tag: string): void {
  const tags = new Set(disabledTags.value)
  if (tags.has(tag)) {
    tags.delete(tag)
  } else {
    tags.add(tag)
  }
  disabledTags.value = tags
}

function refresh (): void {
  window.localStorage.setItem(SCOPE_KEY, scope.value)
  ipcRenderer.invoke('writer-provider', { command: 'get-todos' })
    .then((result: TodoGroup[]) => { groups.value = result })
    .catch(err => console.error(err))

  refreshManuscriptFiles().catch(err => console.error(err))
}

/**
 * Collects the file paths of the currently selected manuscript tree (for the
 * "current manuscript" scope filter).
 */
async function refreshManuscriptFiles (): Promise<void> {
  const rootPath = window.localStorage.getItem(SELECTED_ROOT_KEY)
  if (rootPath === null || rootPath === '') {
    manuscriptFiles.value = new Set()
    return
  }

  const tree: ManuscriptTreeNode|null = await ipcRenderer.invoke('writer-provider', {
    command: 'get-tree',
    payload: { rootPath }
  })

  const files = new Set<string>()
  const walk = (node: ManuscriptTreeNode): void => {
    if (node.type === 'file' && node.path !== '') {
      files.add(node.path)
    }
    node.children.forEach(walk)
  }
  if (tree !== null) {
    walk(tree)
  }
  manuscriptFiles.value = files
}
</script>

<style lang="less">
body {
  div.todo-tab {
    div.todo-filters {
      margin-bottom: 8px;

      select.todo-scope-select {
        width: 100%;
        margin-bottom: 6px;
      }

      div.todo-tag-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;

        button.todo-tag-chip {
          font-size: 10px;
          border: 1px solid var(--system-accent-color, --c-primary);
          color: var(--system-accent-color, --c-primary);
          background: transparent;
          border-radius: 8px;
          padding: 1px 8px;
          cursor: pointer;

          &.inactive {
            border-color: gray;
            color: gray;
            opacity: 0.6;
          }
        }
      }
    }

    p.todo-empty {
      font-size: 12px;
      opacity: 0.8;
    }

    div.todo-file-group {
      margin-bottom: 10px;

      div.todo-file-name {
        font-weight: bold;
        font-size: 12px;
        margin-bottom: 2px;
        unicode-bidi: isolate;
      }

      div.todo-item {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 2px 4px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;

        &:hover { background-color: rgb(200, 200, 200); }

        span.todo-tag {
          flex-shrink: 0;
          font-size: 9px;
          font-weight: bold;
          border-radius: 4px;
          padding: 0 4px;
          color: white;
          background-color: var(--system-accent-color, --c-primary);
        }

        span.todo-message {
          flex-grow: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          unicode-bidi: isolate;
        }

        span.todo-line {
          flex-shrink: 0;
          font-size: 10px;
          opacity: 0.7;
          font-variant-numeric: tabular-nums;
        }
      }
    }
  }

  &.dark {
    div.todo-tab div.todo-file-group div.todo-item:hover {
      background-color: rgb(80, 80, 80);
    }
  }
}
</style>
