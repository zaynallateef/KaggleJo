import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? './' : '/',
  define: mode === 'pages' ? { 'import.meta.env.VITE_DATA_MODE': JSON.stringify('static') } : {},
  plugins: [react(), tailwindcss(), ...(mode === 'pages' ? [{
    name: 'static-site-security',
    transformIndexHtml(html: string) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'">\n    <meta name="referrer" content="strict-origin-when-cross-origin">`)
    },
  }] : [])],
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
}))
