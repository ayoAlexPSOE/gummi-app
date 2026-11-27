import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// La versión de la app sale de package.json (se muestra abajo en la entrada y en el perfil)
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// base './' hace que la web funcione en GitHub Pages (usuario.github.io/repositorio/)
export default defineConfig({ base: './', plugins: [react()], define: { __VERSION__: JSON.stringify(version) } })
