'use client'
import { useEffect, useMemo, useState } from 'react'
import { browserClient } from '@/lib/supabase-browser'
export default function Audit() {
  const sb = useMemo(() => browserClient(), [])
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => { sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200).then((r) => setRows(r.data || [])) }, [sb])
  return (
    <div className="tablewrap"><table>
      <thead><tr><th>시각</th><th>작업</th><th>대상</th><th>사유</th><th>변경 전 → 후</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id}><td>{new Date(r.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td><td>{r.action}{!r.actor_id && ' (시스템)'}</td><td>{r.target_type}</td><td>{r.reason || ''}</td>
          <td><small>{r.previous_values ? JSON.stringify(r.previous_values).slice(0, 140) : '-'} → {r.new_values ? JSON.stringify(r.new_values).slice(0, 140) : '-'}</small></td></tr>
      ))}</tbody>
    </table></div>
  )
}
