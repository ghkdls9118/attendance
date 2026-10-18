'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { browserClient } from '@/lib/supabase-browser'
import { STATUS, buildRows, hm, seoulDate, fmtPhone, isoWeekday } from '@/lib/status'
import { api } from './api'
import { roleOf } from './role'

const FILTERS: Record<string, string[] | null> = { all: null, in: ['present', 'late', 'soon'], unarrived: ['unarrived'], leaving: ['soon'], absent: ['absent'] }
const FLABEL: Record<string, string> = { all: '전체', in: '현재 입실', unarrived: '미도착', leaving: '퇴실 예정', absent: '결석' }

const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const DAYN = ['월', '화', '수', '목', '금', '토', '일']

export default function Dashboard() {
  const sb = useMemo(() => browserClient(), [])
  const [date, setDate] = useState(seoulDate())
  const [data, setData] = useState<any>(null)
  const [now, setNow] = useState(new Date())
  const [q, setQ] = useState(''), [school, setSchool] = useState(''), [flt, setFlt] = useState('all')
  const [err, setErr] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => setIsAdmin(roleOf() === 'admin'), [])
  const load = useCallback(async () => {
    const [st, sc, se, ex, cfg] = await Promise.all([
      sb.from('students').select('id,name,grade,class_name,active,guardian_phone,student_phone'),
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
  // 수업 시간이 끝난 학생을 서버에서도 자동 퇴실 처리 (대시보드가 열려 있는 동안 매분)
  useEffect(() => {
    const sweep = () => fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sweep' }) }).then(load).catch(() => {})
    sweep(); const t = setInterval(sweep, 60000); return () => clearInterval(t)
  }, [load])

  const rows = useMemo(() => data ? buildRows(date, now, data.st, data.sc, data.se, data.ex, data.cfg) : [], [data, date, now])
  const schools = useMemo(() => Array.from(new Set((data?.st || []).map((s: any) => s.class_name).filter(Boolean))) as string[], [data])
  const count = (...s: string[]) => rows.filter((r) => s.includes(r.state)).length
  const shown = rows.filter((r) => (!FILTERS[flt] || FILTERS[flt]!.includes(r.state)) && (!q || r.name.includes(q)) && (!school || r.school === school))
  const waiting = rows.filter((r) => r.state === 'unarrived')
  const today = seoulDate(now)
  const monday = addDays(date, -(isoWeekday(date) - 1))
  const perDay = useMemo(() => {
    const m: Record<number, Set<string>> = {}
    const act = new Set((data?.st || []).filter((x: any) => x.active).map((x: any) => x.id))
    for (const x of data?.sc || []) if (act.has(x.student_id)) (m[x.weekday] = m[x.weekday] || new Set()).add(x.student_id)
    return m
  }, [data])
  const days = [0, 1, 2, 3, 4, 5, 6].filter((i) => i < 5 || (perDay[i + 1] && perDay[i + 1].size) || addDays(monday, i) === date || addDays(monday, i) === today)

  useEffect(() => {
    document.title = (waiting.length ? `(${waiting.length}) ` : '') + '출결 대시보드'
    for (const r of waiting) {
      if (!seen.current.has(r.key)) {
        seen.current.add(r.key)
        if (seen.current.size > 1 && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(`${r.name}: 아직 도착하지 않았습니다`)
      }
    }
  }, [waiting])

  async function act(body: any) { if (await api(body)) load() }
  const ask = (m: string) => (prompt(m) || '').trim()
  const Card = ({ t, n, c }: any) => <div className={'card2 ' + (c || '')}><span>{t}</span><b>{n}</b></div>

  return (
    <div>
      <div className="bar">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input placeholder="이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={school} onChange={(e) => setSchool(e.target.value)}><option value="">전체 학교</option>{schools.map((c) => <option key={c}>{c}</option>)}</select>
        {typeof Notification !== 'undefined' && Notification.permission === 'default' && <button onClick={() => Notification.requestPermission()}>알림 허용</button>}
        <button onClick={() => window.print()}>일일 보고서 인쇄</button>
      </div>
      <div className="daytabs">
        <button onClick={() => setDate(addDays(date, -7))}>◀ 이전 주</button>
        {days.map((i) => {
          const d = addDays(monday, i)
          return (
            <button key={d} className={'daytab' + (d === date ? ' on' : '') + (d === today ? ' today' : '')} onClick={() => setDate(d)}>
              <b>{DAYN[i]}</b><small>{+d.slice(5, 7)}/{+d.slice(8)}{d === today ? ' 오늘' : ''}</small><span>{(perDay[i + 1] && perDay[i + 1].size) || 0}명</span>
            </button>
          )
        })}
        <button onClick={() => setDate(addDays(date, 7))}>다음 주 ▶</button>
        <button onClick={() => setDate(today)}>오늘로</button>
      </div>
      <h3 className="daytitle">{DAYN[isoWeekday(date) - 1]}요일 · {date}</h3>
      {err && <p className="err">{err}</p>}
      {waiting.length > 0 && <div className="alertbox" role="alert">⚠ 입실 시간이 지났는데 아직 오지 않은 학생 {waiting.length}명: {waiting.map((a) => a.name).join(', ')}</div>}
      <div className="cards">
        <Card t="오늘 수업 예정" n={rows.length} />
        <Card t="현재 입실" n={count('present', 'late', 'soon')} />
        <Card t="아직 미도착" n={count('upcoming', 'unarrived')} c={count('unarrived') ? 'bad' : ''} />
        <Card t="퇴실 예정" n={count('soon')} />
        <Card t="결석" n={count('absent')} />
      </div>
      <div className="chips">{Object.keys(FLABEL).map((k) => <button key={k} className={flt === k ? 'on' : ''} onClick={() => setFlt(k)}>{FLABEL[k]}</button>)}</div>
      <div className="tablewrap"><table>
        <thead><tr><th>학생</th><th>학교</th><th>학년</th><th>상태</th><th>예정 수업</th><th>입실</th><th>퇴실 예정</th><th>퇴실</th><th>학부모 전화번호</th><th>학생 전화번호</th><th className="noprint">처리</th></tr></thead>
        <tbody>
          {shown.map((r) => {
            const s = r.session
            return (
              <tr key={r.key} className={r.state === 'unarrived' ? (r.alert ? 'row-late' : 'row-wait') : ''}>
                <td>{r.name}{s?.absence_reason && <small> · {s.absence_reason}</small>}</td>
                <td>{r.school || '-'}</td>
                <td>{r.grade ? r.grade + '학년' : '-'}</td>
                <td><span className={'badge ' + STATUS[r.state].cls}>{STATUS[r.state].label}</span>{r.alert && <small> (허용시간 초과)</small>}</td>
                <td>{r.expected ? r.expected.slice(0, 5) : '-'}</td>
                <td>{hm(s?.check_in_at)}</td><td>{hm(s?.scheduled_checkout_at)}</td><td>{hm(r.outAt)}</td>
                <td>{fmtPhone(r.gphone)}</td><td>{fmtPhone(r.sphone)}</td>
                <td className="noprint act">
                  {s?.check_in_at && isAdmin && <button onClick={() => { const a = ask('입실 시각 HH:MM'); if (!a) return; const c = ask('퇴실 시각 HH:MM (없으면 비움)'); const re = ask('수정 사유'); if (re) act({ action: 'edit_times', session_id: s.id, check_in_hm: a, checkout_hm: c, reason: re }) }}>수정</button>}
                  {!s && <>
                    <button onClick={() => { const re = ask('결석 사유'); if (re) act({ action: 'absent', student_id: r.student_id, date, reason: re }) }}>결석 기록</button>
                    <button onClick={() => { const re = ask('휴강 사유'); if (re) act({ action: 'cancel_class', student_id: r.student_id, date, reason: re }) }}>휴강</button>
                    {date === seoulDate() && <button onClick={() => { const re = ask('수동 입실 사유 (예: 키오스크 오류)'); if (re) act({ action: 'manual_checkin', student_id: r.student_id, reason: re }) }}>수동 입실</button>}
                  </>}
                </td>
              </tr>
            )
          })}
          {!shown.length && <tr><td colSpan={11} className="empty">표시할 학생이 없습니다. 학생·시간표 메뉴에서 학생과 수업 요일을 등록하세요.</td></tr>}
        </tbody>
      </table></div>
    </div>
  )
}
