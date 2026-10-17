'use client'
import { useEffect, useMemo, useState } from 'react'
import { browserClient } from '@/lib/supabase-browser'
import { api } from '../api'
const L: Record<string, string> = { class_minutes: '기본 수업 시간(분)', late_grace_minutes: '지각 허용 시간(분)', warn_before_minutes: '퇴실 예정 알림(종료 몇 분 전)', max_attempts: '번호 오입력 허용 횟수', lockout_minutes: '입력 잠금 시간(분)' }
export default function Settings() {
  const sb = useMemo(() => browserClient(), [])
  const [c, setC] = useState<any>(null)
  const [u, setU] = useState({ email: '', password: '', display_name: '', role: 'teacher' })
  useEffect(() => { sb.from('settings').select('*').eq('id', 1).single().then((r) => setC(r.data)) }, [sb])
  if (!c) return <p>불러오는 중…</p>
  return (
    <div>
      <div className="panel"><h3>운영 설정</h3>
        {Object.keys(L).map((k) => <label key={k} className="row">{L[k]}<input type="number" value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} /></label>)}
        <label className="row">시간표 없는 학생 입실
          <select value={c.no_schedule_policy} onChange={(e) => setC({ ...c, no_schedule_policy: e.target.value })}><option value="allow">허용 (입실부터 기본 시간 계산)</option><option value="block">차단 (선생님 수동 입실)</option></select></label>
        <button className="primary" onClick={async () => (await api({ action: 'settings_update', ...c })) && alert('저장되었습니다.')}>저장</button>
      </div>
      <div className="panel"><h3>선생님 계정 추가</h3><div className="form">
        <input placeholder="이메일" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} />
        <input placeholder="이름" value={u.display_name} onChange={(e) => setU({ ...u, display_name: e.target.value })} />
        <input placeholder="비밀번호(8자 이상)" type="password" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} />
        <select value={u.role} onChange={(e) => setU({ ...u, role: e.target.value })}><option value="teacher">선생님(조회·퇴실·결석)</option><option value="admin">관리자(전체)</option></select>
        <button className="primary" onClick={async () => (await api({ action: 'staff_add', ...u })) && (alert('추가되었습니다.'), setU({ email: '', password: '', display_name: '', role: 'teacher' }))}>추가</button>
      </div></div>
    </div>
  )
}
