'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { browserClient } from '@/lib/supabase-browser'
import { STATUS, buildRows, hm, seoulDate } from '@/lib/status'
import { api } from './api'
import { roleOf } from './role'

const FILTERS: Record<string, string[] | null> = {
  all: null, in: ['present', 'late', 'soon', 'overdue', 'requested'], unarrived: ['unarrived'],
  leaving: ['soon', 'overdue', 'requested'], absent: ['absent']
}
const FLABEL: Record<string, string> = { all: '전체', in: '현재 입실', unarrived: '미도착', leaving: '퇴실 예정·미퇴실', absent: '결석' }

export default function Dashboard() {
  const sb = useMemo(() => browserClient(), [])
  const [date, setDate] = useState(seoulDate())
  const [data, setData] = useState<any>(null)
  const [now, setNow] = useState(new Date())
  const [q, setQ] = useState(''), [cls, setCls] = useState(''), [flt, setFlt] = useState('all')
  const [err, setErr] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => setIsAdmin(roleOf() === 'admin'), [])
  const load = useCallback(async () => {
    const [st, sc, se, ex, cfg] = await Promise.all([
      sb.from('students').select('id,name,grade,class_name,active'),
      sb.from('schedules').select('*').eq('active', true),
      sb.from('attendance_sessions').select('*').eq('attendance_date', date),
      sb.from('schedule_exceptions').select('*').eq('exception_date', date),
      sb.from('settings').select('*').eq('id', 1).single()
    ])
    const e = st.error || sc.error || se.error || ex.error || cfg.error
    if (e) { setErr('데이터를 불러오지 못했습니다: ' + e.message); return }
    setErr(''); setData({ st: st.data, sc: sc.data, se: se.data, ex: ex.data, cfg: cfg.data })
  }, [sb, date])

  useEffect(() => {
    load()
    const poll = setInterval(load, 15000)
    const ch = sb.channel('att').on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_sessions' }, load).subscribe()
    return () => { clearInterval(poll); sb.removeChannel(ch) }
  }, [load, sb])
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 20000); return () => clearInterval(t) }, [])

  const rows = useMemo(() => data ? buildRows(date, now, data.st, data.sc, data.se, data.ex, data.cfg) : [], [data, date, now])
  const classes = useMemo(() => Array.from(new Set((data?.st || []).map((s: any) => s.class_name).filter(Boolean))) as string[], [data])
  const count = (...s: string[]) => rows.filter((r) => s.includes(r.state)).length
  const shown = rows.filter((r) => (!FILTERS[flt] || FILTERS[flt]!.includes(r.state)) && (!q || r.name.includes(q)) && (!cls || r.class_name === cls))
  const alerts = rows.filter((r) => r.state === 'overdue' || r.state === 'requested' || (r.state === 'unarrived' && r.alert))

  useEffect(() => {
    document.title = (alerts.length ? `(${alerts.length}) ` : '') + '출결 대시보드'
    for (const r of alerts) {
      const k = r.key + r.state
      if (!seen.current.has(k)) {
        seen.current.add(k)
        if (seen.current.size > 1 && typeof Notification !== 'undefined' && Notification.permission === 'granted')
          new Notification(`${r.name}: ${STATUS[r.state].label}`)
      }
    }
  }, [alerts])

  async function act(body: any) { if (await api(body)) load() }
  const ask = (m: string) => (prompt(m) || '').trim()

  const Card = ({ t, n, c }: any) => <div className={'card2 ' + (c || '')}><span>{t}</span><b>{n}</b></div>
  return (
    <div>
      <div className="bar">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input placeholder="이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cls} onChange={(e) => setCls(e.target.value)}><option value="">전체 반</option>{classes.map((c) => <option key={c}>{c}</option>)}</select>
        {typeof Notification !== 'undefined' && Notification.permission === 'default' && <button onClick={() => Notification.requestPermission()}>알림 허용</button>}
        <button onClick={() => window.print()}>일일 보고서 인쇄</button>
      </div>
      {err && <p className="err">{err}</p>}
      {alerts.length > 0 && <div className="alertbox" role="alert">⚠ 확인 필요 {alerts.length}명: {alerts.map((a) => `${a.name}(${STATUS[a.state].label})`).join(', ')}</div>}
      <div className="cards">
        <Card t="오늘 수업 예정" n={rows.length} />
        <Card t="현재 입실" n={count('present', 'late', 'soon', 'overdue', 'requested')} />
        <Card t="아직 미도착" n={count('upcoming', 'unarrived')} c={count('unarrived') ? 'warn' : ''} />
        <Card t="퇴실 예정" n={count('soon', 'requested')} />
        <Card t="퇴실 확인 필요" n={count('overdue')} c={count('overdue') ? 'bad' : ''} />
        <Card t="결석" n={count('absent')} />
      </div>
      <div className="chips">{Object.keys(FLABEL).map((k) => <button key={k} className={flt === k ? 'on' : ''} onClick={() => setFlt(k)}>{FLABEL[k]}</button>)}</div>
      <div className="tablewrap"><table>
        <thead><tr><th>학생</th><th>반</th><th>예정 수업</th><th>입실</th><th>퇴실 예정</th><th>실제 퇴실</th><th>상태</th><th className="noprint">처리</th></tr></thead>
        <tbody>
          {shown.map((r) => {
            const s = r.session, active = s && (s.status === 'checked_in' || s.status === 'checkout_requested')
            return (
              <tr key={r.key} className={r.alert || r.state === 'overdue' ? 'rowalert' : ''}>
                <td>{r.name}{s?.absence_reason && <small> · {s.absence_reason}</small>}{s?.extension_minutes ? <small> · 연장 {s.extension_minutes}분</small> : null}</td>
                <td>{r.class_name || '-'}</td>
                <td>{r.expected ? r.expected.slice(0, 5) : '-'}</td>
                <td>{hm(s?.check_in_at)}</td><td>{hm(s?.scheduled_checkout_at)}</td><td>{hm(s?.actual_checkout_at)}</td>
                <td><span className={'badge ' + STATUS[r.state].cls}>{STATUS[r.state].label}</span>{r.alert && <small> (허용시간 초과)</small>}</td>
                <td className="noprint act">
                  {active && <button onClick={() => act({ action: 'complete_checkout', session_id: s.id })}>퇴실 완료</button>}
                  {active && isAdmin && <button onClick={() => { const m = ask('연장 분'); const re = ask('연장 사유'); if (m && re) act({ action: 'extend', session_id: s.id, minutes: m, reason: re }) }}>연장</button>}
                  {s?.check_in_at && isAdmin && <button onClick={() => { const a = ask('입실 시각 HH:MM'); if (!a) return; const c = ask('실제 퇴실 시각 HH:MM (없으면 비움)'); const re = ask('수정 사유'); if (re) act({ action: 'edit_times', session_id: s.id, check_in_hm: a, checkout_hm: c, reason: re }) }}>수정</button>}
                  {!s && <>
                    <button onClick={() => { const re = ask('결석 사유'); if (re) act({ action: 'absent', student_id: r.student_id, date, reason: re }) }}>결석 기록</button>
                    <button onClick={() => { const re = ask('휴강 사유'); if (re) act({ action: 'cancel_class', student_id: r.student_id, date, reason: re }) }}>휴강</button>
                    {date === seoulDate() && <button onClick={() => { const re = ask('수동 입실 사유 (예: 키오스크 오류)'); if (re) act({ action: 'manual_checkin', student_id: r.student_id, reason: re }) }}>수동 입실</button>}
                  </>}
                </td>
              </tr>
            )
          })}
          {!shown.length && <tr><td colSpan={8} className="empty">표시할 학생이 없습니다. 학생·시간표 메뉴에서 학생과 수업 요일을 등록하세요.</td></tr>}
        </tbody>
      </table></div>
    </div>
  )
}
