<template>
  <div class="manuscript-node">
    <div
      class="manuscript-node-row"
      v-bind:class="{
        'is-file': node.type === 'file',
        'is-error': node.error !== undefined
      }"
      v-bind:style="{ paddingLeft: `${depth * 12}px` }"
      v-bind:title="rowTitle"
      v-on:click="activate"
    >
      <span
        class="manuscript-node-chevron"
        v-on:click.stop="hasChildren ? emit('toggle', nodeKey) : undefined"
      >{{ hasChildren ? (isCollapsed ? '▸' : '▾') : '' }}</span>
      <span v-if="node.type === 'file'" class="manuscript-node-icon">
        <cds-icon shape="file"></cds-icon>
      </span>
      <span class="manuscript-node-label" dir="auto">{{ node.label }}</span>
      <span v-if="node.error !== undefined" class="manuscript-node-error">{{ errorLabel }}</span>
      <span v-else class="manuscript-node-words">{{ localiseNumber(node.words) }}</span>
    </div>
    <template v-if="!isCollapsed">
      <ManuscriptNode
        v-for="(child, idx) in node.children"
        v-bind:key="idx"
        v-bind:node="child"
        v-bind:depth="depth + 1"
        v-bind:parent-key="nodeKey"
        v-bind:collapsed-keys="collapsedKeys"
        v-on:toggle="emit('toggle', $event)"
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
 * Contains:        ManuscriptNode
 * CVM-Role:        View
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Recursively renders one node of the manuscript tree: an
 *                  included file or a heading. Shows a word-count badge, and
 *                  jumps to the node's file/line on click.
 *
 * END HEADER
 */

import { computed } from 'vue'
import { trans } from '@common/i18n-renderer'
import localiseNumber from '@common/util/localise-number'
import type { ManuscriptTreeNode } from '@dts/common/writer'

const props = defineProps<{
  node: ManuscriptTreeNode
  depth: number
  parentKey: string
  collapsedKeys: Set<string>
}>()

const emit = defineEmits<{
  (e: 'toggle', key: string): void
  (e: 'jtl', data: { filePath: string, lineNumber: number }): void
}>()

// A stable-ish identifier for persisting collapse state: the chain of node
// labels/positions from the root
const nodeKey = computed(() => `${props.parentKey}/${props.node.type}:${props.node.label}:${props.node.line}`)

const hasChildren = computed(() => props.node.children.length > 0)
const isCollapsed = computed(() => props.collapsedKeys.has(nodeKey.value))

const errorLabel = computed(() => {
  switch (props.node.error) {
    case 'missing': return trans('Not found')
    case 'ambiguous': return trans('Ambiguous')
    case 'cycle': return trans('Circular include')
    case 'depth': return trans('Too deeply nested')
    default: return ''
  }
})

const rowTitle = computed(() => {
  if (props.node.error !== undefined) {
    return `${props.node.label} — ${errorLabel.value}`
  }
  return `${props.node.label} (${localiseNumber(props.node.words)} ${trans('words')})`
})

function activate (): void {
  if (props.node.error !== undefined || props.node.path === '') {
    return
  }

  emit('jtl', { filePath: props.node.path, lineNumber: props.node.line })
}
</script>

<style lang="less">
body {
  div.manuscript-node {
    div.manuscript-node-row {
      display: flex;
      align-items: baseline;
      gap: 4px;
      padding: 2px 4px;
      cursor: pointer;
      border-radius: 4px;
      font-size: 13px;

      &:hover { background-color: rgb(200, 200, 200); }

      &.is-file span.manuscript-node-label {
        font-weight: bold;
      }

      &.is-error {
        cursor: default;
        span.manuscript-node-label { opacity: 0.6; }
      }

      span.manuscript-node-chevron {
        flex-shrink: 0;
        display: inline-block;
        width: 12px;
        color: var(--system-accent-color, --c-primary);
      }

      span.manuscript-node-icon { flex-shrink: 0; }

      span.manuscript-node-label {
        flex-grow: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        // Unicode-isolate the label so mixed-direction labels render sanely
        unicode-bidi: isolate;
      }

      span.manuscript-node-words {
        flex-shrink: 0;
        font-size: 10px;
        opacity: 0.7;
        font-variant-numeric: tabular-nums;
      }

      span.manuscript-node-error {
        flex-shrink: 0;
        font-size: 10px;
        color: rgb(200, 80, 80);
        border: 1px solid rgb(200, 80, 80);
        border-radius: 4px;
        padding: 0 4px;
      }
    }
  }

  &.dark {
    div.manuscript-node div.manuscript-node-row:hover {
      background-color: rgb(80, 80, 80);
    }
  }
}
</style>
