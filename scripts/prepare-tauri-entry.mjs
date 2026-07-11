import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const clientDirectory = resolve(projectRoot, 'dist', 'client')
const shellPath = resolve(clientDirectory, '_shell.html')
const indexPath = resolve(clientDirectory, 'index.html')

if (!existsSync(shellPath)) {
  throw new Error(`TanStack Start shell was not generated: ${shellPath}`)
}

copyFileSync(shellPath, indexPath)
console.log(`Prepared Tauri entrypoint: ${indexPath}`)
