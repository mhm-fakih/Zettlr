<template>
  <!-- Barebones window that only includes limited things -->
  <div id="splash-screen-wrapper">
    <div id="logo">
      <img src="../../resources/icons/png/128x128.png">
    </div>
    <div id="info">
      <h1>Zettlr</h1>
      <!-- Writer fork: tell this build apart from stock Zettlr at a glance -->
      <p id="version">
        <span v-if="version !== ''">{{ version }}</span>
        <span class="fork-label">fork</span>
      </p>
      <p>Your One-Stop Publication Workbench</p>
      <p>&copy; 2017&ndash;{{ year }} Hendrik Erz</p>
    </div>
    <div id="progress">
      <ProgressControl
        v-bind:max="100"
        v-bind:min="0"
        v-bind:value="stepPercentage"
        v-bind:indeterminate="stepPercentage === 0"
        v-bind:interruptible="false"
      ></ProgressControl>
      <p>
        {{ stepLabel }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Splash Screen entry
 * CVM-Role:        View
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This component displays the splash screen
 *
 * END HEADER
 */

import { ref } from 'vue'
import ProgressControl from '@common/vue/form/elements/ProgressControl.vue'
import { trans } from '@common/i18n-renderer'

const ipcRenderer = window.ipc

const stepLabel = ref(trans('Loading…'))
const stepPercentage = ref(0)
const year = (new Date()).getFullYear()
const version = ref('')

ipcRenderer.on('app-version', (event, appVersion: string) => {
  version.value = appVersion
})

ipcRenderer.on('step-update', (event, { currentStepMessage, currentStepPercentage }) => {
  stepLabel.value = currentStepMessage
  // Account for potential ratios instead of percentages
  stepPercentage.value = currentStepPercentage > 1 ? currentStepPercentage : Math.round(currentStepPercentage * 100)
})
</script>

<style lang="less">

#version {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;

  .fork-label {
    font-size: 11px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 1px 6px;
    border-radius: 4px;
    color: white;
    background-color: #c0392b;
  }
}

body {
  font-family: system-ui, sans-serif;
  color: #333;
  // The entire window should be draggable so that users can move it to the side
  // if booting the app takes an excruciating amount of time
  -webkit-app-region: drag;

  &.dark {
    background-color: #333;
    color: white;
  }
}

#splash-screen-wrapper {
  text-align: center;
  width: 100vw;
  height: 100vh;
  display: grid;
  padding: 40px;
  grid-template-areas:
    "logo info"
    "progress progress";
  grid-template-columns: 150px calc(100vw - 80px - 150px);
  grid-template-rows: 150px auto;
  align-content: center;
  align-items: center;
  justify-content: center;

  #logo { grid-area: logo; }
  #info {
    grid-area: info;
    text-align: left;

    h1 {
      font-size: 48px;
      font-weight: 500;
      margin-bottom: 10px;
    }

    p {
      margin-bottom: 10px;
    }
  }

  #progress {
    grid-area: progress;
    overflow: hidden;

    p {
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
}
</style>
