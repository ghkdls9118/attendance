export const STATUS: Record<string, { label: string; cls: string }> = {
  upcoming: { label: '수업 예정', cls: 's-upcoming' },
  unarrived: { label: '미도착', cls: 's-unarrived' },
  present: { label: '출석', cls: 's-present' },
  late: { label: '지각', cls: 's-late' },
  soon: { label: '퇴실 예정', cls: 's-soon' },
  requested: { label: '퇴실 요청', cls: 's-requested' },
  overdue: { label: '퇴실 확인 필요', cls: 's-overdue' },
  done: { label: '퇴실 완료', cls: 's-done' },
  absent: { label: '결석', cls: 's-absent' }
}
export const seoulDate = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d)
export const hm = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }) : '-'
export const isoWeekday = (date: string) => { const g = new Date(date + 'T00:00:00Z').getUTCDay(); return g === 0 ? 7 : g }
const minOfDay = (d: Date) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).split(':')
  return +p[0] * 60 + +p[1]
}
const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5)

export function sessionState(s: any, now: Date, warn: number) {
  if (s.status === 'absent') return 'absent'
  if (s.status === 'checked_out') return 'done'
  if (s.status === 'checkout_requested') return 'requested'
  const rem = (new Date(s.scheduled_checkout_at).getTime() - now.getTime()) / 60000
  if (rem <= 0) return 'overdue'
  if (rem <= warn) return 'soon'
  return s.is_late ? 'late' : 'present'
}

export function buildRows(date: string, now: Date, students: any[], schedules: any[], sessions: any[], exceptions: any[], cfg: any) {
  const byId = new Map(students.map((s) => [s.id, s]))
  const dow = isoWeekday(date)
  const today = seoulDate(now)
  const rows: any[] = []
  const withSession = new Set<string>()
  for (const s of sessions) {
    withSession.add(s.student_id)
    const st = byId.get(s.student_id)
    const sch = schedules.find((x) => x.student_id === s.student_id && x.weekday === dow)
    rows.push({ key: s.id, session: s, student_id: s.student_id, name: s.student_name, class_name: st?.class_name,
      expected: sch?.expected_start_time, state: sessionState(s, now, cfg.warn_before_minutes), alert: false })
  }
  for (const sch of schedules) {
    if (sch.weekday !== dow || withSession.has(sch.student_id)) continue
    const st = byId.get(sch.student_id)
    if (!st || !st.active) continue
    if (exceptions.some((e) => e.exception_date === date && (e.student_id === null || e.student_id === sch.student_id))) continue
    withSession.add(sch.student_id)
    let state = 'upcoming', alert = false
    if (date < today) { state = 'unarrived'; alert = true }
    else if (date === today) {
      const n = minOfDay(now), start = toMin(sch.expected_start_time)
      if (n >= start) { state = 'unarrived'; alert = n >= start + cfg.late_grace_minutes }
    }
    rows.push({ key: 'p' + sch.student_id, session: null, student_id: sch.student_id, name: st.name,
      class_name: st.class_name, expected: sch.expected_start_time, state, alert })
  }
  return rows.sort((a, b) => (a.expected || '99').localeCompare(b.expected || '99') || a.name.localeCompare(b.name, 'ko'))
}
