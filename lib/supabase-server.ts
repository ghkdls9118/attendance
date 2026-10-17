import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
export async function serverClient() {
  const store = await cookies()
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) { try { list.forEach(({ name, value, options }) => store.set(name, value, options)) } catch {} }
    }
  })
}
export async function requireStaff() {
  const sb = await serverClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const { data: p } = await sb.from('profiles').select('role,display_name').eq('id', user.id).maybeSingle()
  if (!p) return null
  return { user, role: p.role as string, name: p.display_name as string }
}
