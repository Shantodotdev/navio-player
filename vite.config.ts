import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

// Custom Vite plugin to duplicate TanStack Start's SPA shell as index.html for Tauri
function tauriSpaPlugin() {
  return {
    name: 'tauri-spa-copier',
    closeBundle() {
      const shellPath = path.resolve('dist/client/_shell.html')
      const indexPath = path.resolve('dist/client/index.html')
      if (fs.existsSync(shellPath)) {
        fs.copyFileSync(shellPath, indexPath)
        console.log('Successfully copied _shell.html to index.html for Tauri entrypoint')
      }
    }
  }
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
      },
    }),
    viteReact(),
    tauriSpaPlugin(),
  ],
})

export default config
