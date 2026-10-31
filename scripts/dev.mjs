import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const python = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const vite = join(root, 'node_modules/vite/bin/vite.js')
if (!existsSync(python) || !existsSync(vite)) {
  console.error('Install the local Python environment and npm dependencies first. See README.md.')
  process.exit(1)
}

console.log('Starting KaggleJo. Open http://127.0.0.1:5173. Press Ctrl+C to stop both services.')
const children = []
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  process.exitCode = code
}
for (const [command, args] of [[python, ['-m', 'backend.app']], [process.execPath, [vite, '--host', '127.0.0.1', '--strictPort']]]) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true })
  children.push(child)
  child.on('error', error => { console.error(error.message); stop(1) })
  child.on('exit', code => { if (!stopping) stop(code ?? 1) })
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
