import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = dirname(fileURLToPath(import.meta.url))
const amplifyOutputsPath = resolve(rootDir, 'amplify_outputs.json')
const virtualAmplifyOutputsId = '\0virtual:optional-amplify-outputs'

function optionalAmplifyOutputs() {
  return {
    name: 'optional-amplify-outputs',
    resolveId(source) {
      if (!source.endsWith('amplify_outputs.json')) {
        return null
      }

      return existsSync(amplifyOutputsPath)
        ? amplifyOutputsPath
        : virtualAmplifyOutputsId
    },
    load(id) {
      if (id !== virtualAmplifyOutputsId) {
        return null
      }

      return 'export default null'
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [optionalAmplifyOutputs(), react()],
})
