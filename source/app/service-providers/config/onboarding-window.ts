/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        OnboardingWindow
 * CVM-Role:        Utility Function
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This file contains the code to display the onboarding
 *                  window. This window is controlled by the config provider,
 *                  because of three reasons:
 *
 *                  (1) The onboarding window is only shown on a first install
 *                      and on updates, which is determined upon config boot.
 *                  (2) The window's contents only interact with the
 *                      configuration.
 *                  (3) The window should be shown before anything else, and
 *                      only once it's closed should the boot commence. The
 *                      benefit of this is that every provider that loads after
 *                      the config (which is all except the logger) will
 *                      immediately have access to the user-wanted config.
 *
 * END HEADER
 */

import type LogProvider from '@providers/log'
import { BrowserWindow, type BrowserWindowConstructorOptions, ipcMain } from 'electron'
import type ConfigProvider from '.'
import { loadData } from '@common/i18n-main'
import setWindowChrome from '../windows/set-window-chrome'
import attachLogger from '../windows/attach-logger'

/**
 * How long the onboarding window stays on screen before dismissing itself
 * (writer fork: it is used as a splash screen)
 */
const SPLASH_DURATION_MS = 5000

export interface OnboardingIPCCancelSplashMessage {
  command: 'cancel-splash'
}

export interface OnboardingIPCCloseMessage {
  command: 'close'
}

export interface OnboardingIPCSetAppLangMessage {
  command: 'set-app-lang'
  language: string
}

export type OnboardingIPCMessage = OnboardingIPCCloseMessage |
  OnboardingIPCSetAppLangMessage |
  OnboardingIPCCancelSplashMessage

/**
 * Shows the onboarding window for Zettlr. This function will block until the
 * window is closed.
 *
 * @param   {LogProvider}  logger  The logger for potential error messages.
 */
export async function showOnboardingWindow (config: ConfigProvider, logger: LogProvider, mode: 'first-start'|'update'|'splash'): Promise<void> {
  const conf: BrowserWindowConstructorOptions = {
    width: 800,
    height: 600,
    center: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: false,
    alwaysOnTop: false,
    fullscreenable: false,
    skipTaskbar: true,
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    webPreferences: {
      // contextIsolation and sandbox mean: Preload scripts have access to
      // Node modules, the renderers not
      contextIsolation: true,
      sandbox: false,
      preload: ONBOARDING_PRELOAD_WEBPACK_ENTRY
    }
  }
  setWindowChrome(config, conf, false)
  const onboardingWindow = new BrowserWindow(conf)
  attachLogger(logger, onboardingWindow, 'Onboarding Window')

  const effectiveUrl = new URL(ONBOARDING_WEBPACK_ENTRY)
  effectiveUrl.searchParams.append('mode', mode)

  onboardingWindow.loadURL(effectiveUrl.toString())
    .catch(e => {
      logger.error(`Could not load URL ${ONBOARDING_WEBPACK_ENTRY}: ${e.message as string}`, e)
    })

  // Writer fork: the onboarding window acts as a splash screen -- it is shown
  // briefly and then dismisses itself, which is exactly what the "Get started"
  // button does (destroying the window lets the boot process continue).
  let splashTimeout: NodeJS.Timeout|undefined

  onboardingWindow.once('ready-to-show', () => {
    onboardingWindow.show()
    splashTimeout = setTimeout(() => {
      if (!onboardingWindow.isDestroyed()) {
        onboardingWindow.destroy()
      }
    }, SPLASH_DURATION_MS)
  })

  return await new Promise((resolve, reject) => {
    // Synchronous messages
    ipcMain.on('onboarding', (event, payload: OnboardingIPCMessage) => {
      if (payload.command === 'close') {
        onboardingWindow.destroy()
      } else if (payload.command === 'cancel-splash') {
        // The user interacted with the window, so keep it open and let them
        // walk through the pages at their own pace.
        if (splashTimeout !== undefined) {
          clearTimeout(splashTimeout)
          splashTimeout = undefined
        }
      }
    })

    // Asynchronous messages
    ipcMain.handle('onboarding', async (event, payload: OnboardingIPCMessage) => {
      if (payload.command === 'set-app-lang') {
        // The user has changed the language. This unfortunately cannot be done
        // with the default config setters, since this will require a singular
        // reload of the translation strings, which is only possible here
        // because we are able to control this process entirely.
        const { language } = payload
        // We enforce a skip-check here to prevent a "restart required" modal.
        config.set('appLang', language, true)
        await loadData(language)
      }
    })

    onboardingWindow.on('unresponsive', () => {
      onboardingWindow.destroy()
      reject()
    })

    onboardingWindow.on('closed', () => {
      if (splashTimeout !== undefined) {
        clearTimeout(splashTimeout)
      }
      // NOTE: We must "destroy" the window, because otherwise 'closable: false'
      // will prevent programmatic closing.
      onboardingWindow.destroy()
      resolve()
    })
  })
}
