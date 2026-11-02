import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const url = env.VITE_SUPABASE_URL || '', key = env.VITE_SUPABASE_PUBLISHABLE_KEY || ''
  if (Boolean(url) !== Boolean(key)) throw new Error('Set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, or neither.')
  let communityOrigin = ''
  if (url) {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !['', '/'].includes(parsed.pathname) || parsed.search || parsed.hash)
      throw new Error('VITE_SUPABASE_URL must be an HTTPS project origin.')
    if (!key.startsWith('sb_publishable_')) throw new Error('Only a Supabase publishable key may be used in VITE_SUPABASE_PUBLISHABLE_KEY. Never use a secret key.')
    communityOrigin = parsed.origin
  }
  return {
  base: mode === 'pages' ? './' : '/',
  define: mode === 'pages' ? { 'import.meta.env.VITE_DATA_MODE': JSON.stringify('static') } : {},
  plugins: [react(), tailwindcss(), ...(mode === 'pages' ? [{
    name: 'static-site-security',
    transformIndexHtml(html: string) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${communityOrigin ? ` ${communityOrigin}` : ''}; object-src 'none'; base-uri 'self'; form-action 'none'">\n    <meta name="referrer" content="strict-origin-when-cross-origin">`)
    },
  }] : [])],
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  }
})
