import { createHandler } from './handler.ts'

const readKeys = (name: string): Record<string, string> => {
  try { return JSON.parse(Deno.env.get(name) || '{}') } catch { return {} }
}
const secrets = readKeys('SUPABASE_SECRET_KEYS')
const publishable = readKeys('SUPABASE_PUBLISHABLE_KEYS')
Deno.serve(createHandler({
  url: Deno.env.get('SUPABASE_URL') || '',
  secretKey: secrets.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  publishableKeys: [...Object.values(publishable), Deno.env.get('SUPABASE_ANON_KEY') || ''].filter(Boolean),
}))
