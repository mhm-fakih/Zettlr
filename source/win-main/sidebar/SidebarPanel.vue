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
  section.sidebar-panel {
    margin-bottom: 5px;

    header.sidebar-panel-header {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 6px;
      font-size: 12px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      cursor: pointer;
      user-select: none;
      position: sticky;
      top: 0;
      background-color: rgb(230, 230, 230);
      z-index: 1;

      span.sidebar-panel-chevron {
        display: inline-block;
        width: 12px;
        color: var(--system-accent-color, --c-primary);
      }
    }

    div.sidebar-panel-body {
      padding: 0 6px 10px 6px;
    }
  }

  &.dark {
    section.sidebar-panel header.sidebar-panel-header {
      background-color: rgba(30, 30, 30, 1);
    }
  }
}
</style>
