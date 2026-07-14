<template>
  <div role="tabpanel" class="codes-tab">
    <p v-if="filteredGroups.length === 0" class="codes-empty">
      {{ emptyLabel }}
    </p>
    <template v-else>
      <div class="codes-code-filters">
        <button
          v-for="code in presentCodes"
          v-bind:key="code"
          type="button"
          class="codes-code-chip"
          v-bind:class="{ inactive: disabledCodes.has(code) }"
          v-on:click="toggleCode(code)"
        >{{ code }}</button>
      </div>
      <div v-for="group in filteredGroups" v-bind:key="group.path" class="codes-file-group">
        <div class="codes-file-name" dir="auto">{{ group.name }}</div>
        <div
          v-for="(entry, idx) in group.codes"
          v-bind:key="idx"
          class="codes-item"
          v-on:click="emit('jtl', { filePath: group.path, lineNumber: entry.line })"
        >
          <span class="codes-code">{{ entry.code }}</span>
          <span class="codes-line">{{ entry.line }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        CodesTab
 * CVM-Role:        View
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Sidebar panel listing all standalone letter-digit-letter
 *                  codes (e.g. T3Z) in the workspace, grouped by file — the
 *                  same extraction pattern as the TODO panel. Clicking an
 *                  entry opens the file at that line.
 *
 * END HEADER
 */

import { ref, computed, onMounted } from 'vue'
import { trans } from '@common/i18n-renderer'
import type { WriterFileEntry } from '@dts/common/writer'

type CodeGroup = Pick<WriterFileEntry, 'path'|'name'|'codes'>

const ipcRenderer = window.ipc

const emit = defineEmits<{
  (e: 'jtl', data: { filePath: string, lineNumber: number }): void
}>()

const emptyLabel = trans('No codes found')

const groups = ref<CodeGroup[]>([])
const disabledCodes = ref<Set<string>>(new Set())

const presentCodes = computed(() => {
  const codes = new Set<string>()
  for (const group of groups.value) {
    for (const entry of group.codes) {
      codes.add(entry.code)
    }
  }
  return [...codes].sort()
})

const filteredGroups = computed(() => {
  return groups.value
    .map(group => ({
      ...group,
      codes: group.codes.filter(entry => !disabledCodes.value.has(entry.code))
    }))
    .filter(group => group.codes.length > 0)
})

onMounted(refresh)
ipcRenderer.on('writer-index', refresh)

function toggleCode (code: string): void {
  const codes = new Set(disabledCodes.value)
  if (codes.has(code)) {
    codes.delete(code)
  } else {
    codes.add(code)
  }
  disabledCodes.value = codes
}

function refresh (): void {
  ipcRenderer.invoke('writer-provider', { command: 'get-codes' })
    .then((result: CodeGroup[]) => { groups.value = result })
    .catch(err => console.error(err))
}
</script>

<style lang="less">
body {
  div.codes-tab {
    p.codes-empty {
      font-size: 12px;
      opacity: 0.8;
    }

    div.codes-code-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;

      button.codes-code-chip {
        font-size: 10px;
        border: 1px solid rgb(45, 45, 55);
        background-color: rgb(45, 45, 55);
        color: white;
        border-radius: 8px;
        padding: 1px 8px;
        cursor: pointer;

        &.inactive {
          background-color: transparent;
          border-color: gray;
          color: gray;
          opacity: 0.6;
        }
      }
    }

    div.codes-file-group {
      margin-bottom: 10px;

      div.codes-file-name {
        font-weight: bold;
        font-size: 12px;
        margin-bottom: 2px;
        unicode-bidi: isolate;
      }

      div.codes-item {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 2px 4px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;

        &:hover { background-color: rgb(200, 200, 200); }

        span.codes-code {
          flex-grow: 1;
          font-size: 11px;
          font-weight: bold;
          font-variant-numeric: tabular-nums;
        }

        span.codes-line {
          flex-shrink: 0;
          font-size: 10px;
          opacity: 0.7;
          font-variant-numeric: tabular-nums;
        }
      }
    }
  }

  &.dark {
    div.codes-tab div.codes-file-group div.codes-item:hover {
      background-color: rgb(80, 80, 80);
    }
  }
}
</style>
