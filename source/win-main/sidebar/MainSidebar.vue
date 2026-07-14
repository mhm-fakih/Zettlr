<template>
  <div id="sidebar">
    <!-- The sidebar stacks several collapsible panels (writer fork; replaces
    the upstream tab bar) -->
    <div id="sidebar-tab-container">
      <SidebarPanel
        v-bind:label="trans('Manuscript')"
        v-bind:collapsed="isCollapsed('manuscript')"
        v-on:toggle="togglePanel('manuscript')"
      >
        <ManuscriptTab v-on:jtl="emit('jtl', $event)"></ManuscriptTab>
      </SidebarPanel>
      <SidebarPanel
        v-bind:label="trans('TODO')"
        v-bind:collapsed="isCollapsed('todo')"
        v-on:toggle="togglePanel('todo')"
      >
        <TodoTab v-on:jtl="emit('jtl', $event)"></TodoTab>
      </SidebarPanel>
      <SidebarPanel
        v-bind:label="trans('Codes')"
        v-bind:collapsed="isCollapsed('codes')"
        v-on:toggle="togglePanel('codes')"
      >
        <CodesTab v-on:jtl="emit('jtl', $event)"></CodesTab>
      </SidebarPanel>
      <SidebarPanel
        v-bind:label="trans('Table of contents')"
        v-bind:collapsed="isCollapsed('toc')"
        v-on:toggle="togglePanel('toc')"
      >
        <ToCTab
          v-on:move-section="emit('move-section', $event)"
          v-on:jump-to-line="emit('jump-to-line', $event)"
        ></ToCTab>
      </SidebarPanel>
      <SidebarPanel
        v-bind:label="trans('References')"
        v-bind:collapsed="isCollapsed('references')"
        v-on:toggle="togglePanel('references')"
      >
        <ReferencesTab></ReferencesTab>
      </SidebarPanel>
      <SidebarPanel
        v-bind:label="trans('Related files')"
        v-bind:collapsed="isCollapsed('relatedFiles')"
        v-on:toggle="togglePanel('relatedFiles')"
      >
        <RelatedFilesTab></RelatedFilesTab>
      </SidebarPanel>
      <SidebarPanel
        v-bind:label="trans('Other files')"
        v-bind:collapsed="isCollapsed('attachments')"
        v-on:toggle="togglePanel('attachments')"
      >
        <OtherFilesTab></OtherFilesTab>
      </SidebarPanel>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Sidebar
 * CVM-Role:        View
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This component renders the sidebar.
 *
 * END HEADER
 */

import { trans } from '@common/i18n-renderer'
import { reactive } from 'vue'
import ToCTab from './ToCTab.vue'
import ReferencesTab from './ReferencesTab.vue'
import RelatedFilesTab from './RelatedFilesTab.vue'
import OtherFilesTab from './OtherFilesTab.vue'
import SidebarPanel from './SidebarPanel.vue'
import ManuscriptTab from './writer/ManuscriptTab.vue'
import TodoTab from './writer/TodoTab.vue'
import CodesTab from './writer/CodesTab.vue'

const COLLAPSED_PANELS_KEY = 'sidebar-collapsed-panels'

const emit = defineEmits<{
  (e: 'move-section', data: { from: number, to: number }): void
  (e: 'jump-to-line', line: number): void
  (e: 'jtl', data: { filePath: string, lineNumber: number }): void
}>()

// References, related and other files start collapsed unless the user has
// toggled them before; the state persists across restarts.
const collapsedPanels = reactive<Record<string, boolean>>(loadCollapsedPanels())

function loadCollapsedPanels (): Record<string, boolean> {
  const defaults = { references: true, relatedFiles: true, attachments: true }
  try {
    const stored = window.localStorage.getItem(COLLAPSED_PANELS_KEY)
    return stored !== null ? JSON.parse(stored) : defaults
  } catch (err) {
    return defaults
  }
}

function isCollapsed (panel: string): boolean {
  return collapsedPanels[panel] ?? false
}

function togglePanel (panel: string): void {
  collapsedPanels[panel] = !isCollapsed(panel)
  window.localStorage.setItem(COLLAPSED_PANELS_KEY, JSON.stringify(collapsedPanels))
}
</script>

<style lang="less">
body {
  @button-margin: 5px;
  @border-radius: 5px;
  @button-size: 5px;
  @button-icon-size: 5px;

  #sidebar {
    background-color: rgb(230, 230, 230);
    height: 100%;
    width: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;

    #sidebar-tab-container {
      padding: 10px;
      overflow-y: auto;
    }

    #open-dir-external {
      padding: @button-margin;
      border-radius: @border-radius;
      display: inline-block;
      width: @button-size;
      height: @button-size;

      clr-icon {
        width: @button-icon-size;
        height: @button-icon-size;
      }
    }

    h1 {
      font-size: 16px;
      margin: 10px 0;
    }

    // Table of Contents entries
    div.toc-entry-container {
      // Clever calculation based on the data-level property
      // margin-left: calc(attr(data-level) * 10px);
      display: flex;
      margin-bottom: 10px;

      div.toc-level {
        flex-shrink: 1;
        padding: 0px 5px;
        font-weight: bold;
        color: var(--system-accent-color, --c-primary);
      }

      div.toc-entry {
        flex-grow: 3;
        cursor: pointer;
        &:hover { text-decoration: underline; }
      }

      div.toc-entry-active {
        font-weight: bold;
        color: var(--system-accent-color);
      }
    }

    div.related-files-container {
      div.related-file {
        // NOTE: The margin + height equal 42, which was the automatic height
        // before we fixed it here. We have to fix it because the Recycle
        // scroller requires completely fixed heights.
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        padding: 5px 5px;
        height: 35px;
        overflow: hidden;

        &:hover { background-color: rgb(200, 200, 200); }

        span.filename {
          font-size: 11px;
          flex-grow: 8;
          // The next four properties together ensure that we show at most two
          // lines with a nice ellipsis (…) to indicate cut-off lines.
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        span.icons {
          display: inline-block;
          border-radius: 4px;
          padding: 2px;
          flex-grow: 2;
          flex-shrink: 0;
          text-align: right;
        }
      }
    }
  }

  &.dark {
    #sidebar {
      background-color: rgba(30, 30, 30, 1);
      color: rgb(230, 230, 230);

      div.related-files-container div.related-file:hover {
        background-color: rgb(80, 80, 80);
      }
    }
  }
}

body.darwin, body.linux {
  div#sidebar {
    background-color: transparent;

    div.related-files-container {
      div.related-file { border-radius: 4px; }
    }
  }

  &.dark {
    div#sidebar {
      background-color: transparent;
    }
  }
}
</style>
