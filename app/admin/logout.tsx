'use client'
import { browserClient } from '@/lib/supabase-browser'
export default function LogoutButton() {
  return <button onClick={async () => { await browserClient().auth.signOut(); location.href = '/login' }}>로그아웃</button>
}
