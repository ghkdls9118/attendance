import { redirect } from 'next/navigation'
import { requireStaff } from '@/lib/supabase-server'
import Link from 'next/link'
import LogoutButton from './logout'
export const dynamic = 'force-dynamic'
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requireStaff()
  if (!me) redirect('/login')
  return (
    <div className="admin">
      <nav className="nav">
        <b>출결 관리</b>
        <Link href="/admin">대시보드</Link>
        <Link href="/admin/students">학생·시간표</Link>
        <Link href="/admin/audit">변경 이력</Link>
        {me.role === 'admin' && <Link href="/admin/settings">설정</Link>}
        <span className="sp" />
        <span className="who">{me.name} ({me.role === 'admin' ? '관리자' : '선생님'})</span>
        <LogoutButton />
      </nav>
      <div data-role={me.role} className="content">{children}</div>
    </div>
  )
}
