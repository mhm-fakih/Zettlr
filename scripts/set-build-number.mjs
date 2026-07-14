/**
 * Sets the build number on the version in package.json (writer fork).
 *
 * The build number is the repository's commit count, appended as semver
 * build metadata: e.g. 4.6.1+9173. Build metadata does not affect version
 * precedence, so update checks and semver comparisons keep working.
 *
 * Usage: yarn version:build   (run before packaging a release)
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'

import { info, success } from './console-colour.mjs'

const __dirname = process.platform === 'win32'
  ? path.dirname(decodeURI(import.meta.url.substring(8)))
  : path.dirname(decodeURI(import.meta.url.substring(7)))

const packageJsonPath = path.join(__dirname, '../package.json')

const buildNumber = execSync('git rev-list --count HEAD', { cwd: __dirname }).toString().trim()

const packageJson = readFileSync(packageJsonPath, 'utf-8')
const parsed = JSON.parse(packageJson)

const baseVersion = parsed.version.split('+')[0]
const newVersion = `${baseVersion}+${buildNumber}`

if (parsed.version === newVersion) {
  info(`Version is already ${newVersion} -- nothing to do.`)
  process.exit(0)
}

info(`Setting version: ${parsed.version} -> ${newVersion}`)

// Replace only the version line to keep the rest of the file byte-identical
const replaced = packageJson.replace(
  `"version": "${parsed.version}"`,
  `"version": "${newVersion}"`
)

writeFileSync(packageJsonPath, replaced)
success(`package.json version is now ${newVersion}.`)
