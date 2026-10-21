<template>
  <div class="recent-notes">
    <h4>{{ createdLabel }}</h4>
    <p v-if="recentlyCreated.length === 0" class="recent-notes-empty">
      {{ noneLabel }}
    </p>
    <div
      v-for="entry in recentlyCreated"
      v-bind:key="entry.path"
      class="recent-note"
      v-bind:class="{ active: entry.path === activeFilePath }"
      v-bind:title="entry.path"
      v-on:mousedown="requestFile($event, entry.path)"
    >
      <span class="recent-note-name">{{ entry.name }}</span>
      <span class="recent-note-time">{{ entry.timeLabel }}</span>
    </div>

    <h4>{{ updatedLabel }}</h4>
    <p v-if="recentlyUpdated.length === 0" class="recent-notes-empty">
      {{ noneLabel }}
    </p>
    <div
      v-for="entry in recentlyUpdated"
      v-bind:key="entry.path"
      class="recent-note"
      v-bind:class="{ active: entry.path === activeFilePath }"
      v-bind:title="entry.path"
      v-on:mousedown="requestFile($event, entry.path)"
    >
      <span class="recent-note-name">{{ entry.name }}</span>
      <span class="recent-note-time">{{ entry.timeLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        RecentNotes
 * CVM-Role:        View
 * Maintainer:      Writer fork
 * License:         GNU GPL v3
 *
 * Description:     Lists the notes created yesterday or today (according to
 *                  the `YYYY_MM_DD-HHMMSS` date their filename starts with),
 *                  then the notes modified yesterday or today. A note counts
 *                  as modified when the note itself or anything inside its
 *                  companion folder (`<note name>.d`) has an OS modification
 *                  time within that window. Notes listed as created are not
 *                  repeated under updated.
 *
 * END HEADER
 */

import { computed, onBeforeUnmount, ref } from 'vue'
import { trans } from '@common/i18n-renderer'
import { useConfigStore, useDocumentTreeStore, useWorkspaceStore } from 'source/pinia'
import { pathDirname, pathExtname } from '@common/util/renderer-path-polyfill'
import type { MDFileDescriptor } from '@dts/common/fsal'
import type { DocumentManagerIPCAPI } from 'source/app/service-providers/documents'

interface RecentEntry {
  path: string
  name: string
  time: number
  timeLabel: string
}

const ipcRenderer = window.ipc

const props = defineProps<{ windowId: string }>()

// Note filenames start with their creation date, e.g. 2026_10_21-101556~J~p3~D.md
const CREATED_RE = /^(\d{4})_(\d{2})_(\d{2})-(\d{2})(\d{2})(\d{2})/
// A note's companion folder is named like the note, with this extension
const COMPANION_EXT = '.d'

const createdLabel = trans('Recently created')
const updatedLabel = trans('Recently updated')
const noneLabel = trans('None')
const todayLabel = trans('Today')
const yesterdayLabel = trans('Yesterday')

const workspaceStore = useWorkspaceStore()
const configStore = useConfigStore()
const documentTreeStore = useDocumentTreeStore()

const activeFilePath = computed(() => documentTreeStore.lastLeafActiveFile?.path)
const useH1 = computed(() => configStore.config.fileNameDisplay.includes('heading'))
const useTitle = computed(() => configStore.config.fileNameDisplay.includes('title'))
const displayMdExtensions = computed(() => configStore.config.display.markdownFileExtensions)

// Re-evaluate the "yesterday and today" window once a minute so that the lists
// roll over at midnight even without any file changes.
const now = ref<number>(Date.now())
const clock = setInterval(() => { now.value = Date.now() }, 60_000)
onBeforeUnmount(() => clearInterval(clock))

const startOfToday = computed(() => {
  const date = new Date(now.value)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
})
const startOfYesterday = computed(() => {
  const date = new Date(startOfToday.value)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1).getTime()
})
const startOfTomorrow = computed(() => {
  const date = new Date(startOfToday.value)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
})

/**
 * All notes (Markdown files outside of companion folders), keyed by their path
 * without extension, which is also the path of their companion folder minus
 * its `.d` extension.
 */
const notesByBase = computed(() => {
  const notes = new Map<string, MDFileDescriptor>()
  for (const descriptor of workspaceStore.descriptorMap.values()) {
    if (descriptor.type === 'file') {
      notes.set(descriptor.path.slice(0, descriptor.path.length - descriptor.ext.length), descriptor)
    }
  }

  // Transcripts etc. inside companion folders are Markdown files themselves,
  // but they belong to their note and are no notes of their own.
  for (const [ base, descriptor ] of [...notes]) {
    if (findOwningNote(descriptor.path, notes) !== undefined) {
      notes.delete(base)
    }
  }

  return notes
})

/**
 * Returns the note whose companion folder contains absPath (or is absPath).
 */
function findOwningNote (absPath: string, notes: Map<string, MDFileDescriptor>): MDFileDescriptor|undefined {
  let current = absPath
  while (true) {
    if (pathExtname(current) === COMPANION_EXT) {
      const note = notes.get(current.slice(0, current.length - COMPANION_EXT.length))
      if (note !== undefined) {
        return note
      }
    }

    const parent = pathDirname(current)
    if (parent === current || parent === '') {
      return undefined
    }
    current = parent
  }
}

/**
 * Parses the creation date from a note's filename (local time), if present.
 */
function creationTimeFromName (name: string): number|undefined {
  const match = CREATED_RE.exec(name)
  if (match === null) {
    return undefined
  }

  const [ year, month, day, hours, minutes, seconds ] = match.slice(1).map(Number)
  return new Date(year, month - 1, day, hours, minutes, seconds).getTime()
}

function isRecent (time: number): boolean {
  return time >= startOfYesterday.value && time < startOfTomorrow.value
}

function makeEntry (descriptor: MDFileDescriptor, time: number): RecentEntry {
  const date = new Date(time)
  const day = time >= startOfToday.value ? todayLabel : yesterdayLabel
  const clockTime = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return { path: descriptor.path, name: getDisplayName(descriptor), time, timeLabel: `${day} ${clockTime}` }
}

const recentlyCreated = computed<RecentEntry[]>(() => {
  const entries: RecentEntry[] = []
  for (const descriptor of notesByBase.value.values()) {
    const created = creationTimeFromName(descriptor.name)
    if (created !== undefined && isRecent(created)) {
      entries.push(makeEntry(descriptor, created))
    }
  }
  return entries.sort((a, b) => b.time - a.time)
})

const recentlyUpdated = computed<RecentEntry[]>(() => {
  const notes = notesByBase.value
  const created = new Set(recentlyCreated.value.map(entry => entry.path))

  // Latest modification time per note, from the note and its companion folder
  const latest = new Map<string, { descriptor: MDFileDescriptor, time: number }>()
  const consider = (descriptor: MDFileDescriptor, time: number): void => {
    if (created.has(descriptor.path) || !isRecent(time)) {
      return
    }
    const previous = latest.get(descriptor.path)
    if (previous === undefined || previous.time < time) {
      latest.set(descriptor.path, { descriptor, time })
    }
  }

  for (const note of notes.values()) {
    consider(note, note.modtime)
  }

  for (const descriptor of workspaceStore.descriptorMap.values()) {
    const owner = findOwningNote(descriptor.path, notes)
    if (owner !== undefined) {
      consider(owner, descriptor.modtime)
    }
  }

  return [...latest.values()]
    .map(({ descriptor, time }) => makeEntry(descriptor, time))
    .sort((a, b) => b.time - a.time)
})

function getDisplayName (descriptor: MDFileDescriptor): string {
  if (useTitle.value && descriptor.frontmatter !== null && typeof descriptor.frontmatter.title === 'string') {
    return descriptor.frontmatter.title
  } else if (useH1.value && descriptor.firstHeading !== null) {
    return descriptor.firstHeading
  } else if (displayMdExtensions.value) {
    return descriptor.name
  } else {
    return descriptor.name.replace(descriptor.ext, '')
  }
}

function requestFile (event: MouseEvent, filePath: string): void {
  if (event.button !== 0 && event.button !== 1) {
    return
  }

  ipcRenderer.invoke('documents-provider', {
    command: 'open-file',
    payload: {
      path: filePath,
      windowId: props.windowId,
      leafId: documentTreeStore.lastLeafId,
      newTab: event.button === 1
    }
  } as DocumentManagerIPCAPI)
    .catch(e => console.error(e))
}
</script>

<style lang="less">
body div.recent-notes {
  font-size: 13px;

  h4 {
    font-size: 11px;
    font-weight: bold;
    text-transform: uppercase;
    opacity: 0.7;
    margin: 6px 0 2px 0;
  }

  p.recent-notes-empty {
    font-size: 12px;
    opacity: 0.6;
    padding: 2px 4px;
  }

  div.recent-note {
    display: flex;
    gap: 6px;
    align-items: baseline;
    padding: 2px 4px;
    border-radius: 4px;
    cursor: pointer;

    &:hover { background-color: rgba(128, 128, 128, 0.2); }
    &.active { background-color: rgba(128, 128, 128, 0.3); }

    span.recent-note-name {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      // Titles may be Arabic or English
      unicode-bidi: plaintext;
    }

    span.recent-note-time {
      flex: 0 0 auto;
      font-size: 11px;
      opacity: 0.6;
    }
  }
}
</style>
