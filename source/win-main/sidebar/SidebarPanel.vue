<template>
  <section class="sidebar-panel" v-bind:class="{ collapsed }">
    <header class="sidebar-panel-header" v-on:click="emit('toggle')">
      <span class="sidebar-panel-chevron">{{ collapsed ? '▸' : '▾' }}</span>
      <span class="sidebar-panel-label">{{ label }}</span>
    </header>
    <div v-show="!collapsed" class="sidebar-panel-body">
      <slot></slot>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        SidebarPanel
 * CVM-Role:        View
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     One collapsible panel within the main sidebar. The sidebar
 *                  stacks several of these instead of showing a tab bar.
 *
 * END HEADER
 */

defineProps<{
  label: string
  collapsed: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
}>()
</script>

<style lang="less">
body {
  // Panels are stacked in a flex column: collapsed panels shrink to their
  // header, expanded panels share the remaining height and scroll internally.
  section.sidebar-panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 0 0 auto;

    &:not(.collapsed) {
      flex: 1 1 0;
    }

    // The whole header is one click target that toggles the panel
    header.sidebar-panel-header {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 6px 8px;
      margin-bottom: 4px;
      font-size: 12px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      cursor: pointer;
      user-select: none;
      background-color: rgba(128, 128, 128, 0.18);
      border-radius: 4px;

      &:hover {
        background-color: rgba(128, 128, 128, 0.3);
      }

      span.sidebar-panel-chevron {
        display: inline-block;
        width: 12px;
        color: var(--system-accent-color, --c-primary);
      }
    }

    div.sidebar-panel-body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 0 6px 10px 6px;
    }
  }
}
</style>
