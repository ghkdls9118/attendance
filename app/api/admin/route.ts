import { NextRequest, NextResponse } from 'next/server'
import { admin } from '@/lib/admin'
import { hashCode, randomCode } from '@/lib/code'
import { requireStaff } from '@/lib/supabase-server'
export const dynamic = 'force-dynamic'
const out = (b: any, s = 200) => NextResponse.json(b, { status: s })
const str = (v: any, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const phoneOf = (v: any) => { const d = String(v ?? '').replace(/\D/g, ''); if (!d) return null; if (!/^\d{9,11}$/.test(d)) throw new Error('전화번호 형식이 올바르지 않습니다. 예: 010-1234-5678'); return d }
const UUID = /^[0-9a-f-]{36}$/i

export async function POST(req: NextRequest) {
  const me = await requireStaff()
  if (!me) return out({ error: '로그인이 필요합니다.' }, 401)
  let b: any; try { b = await req.json() } catch { return out({ error: '잘못된 요청' }, 400) }
  const db = admin(), uid = me.user.id, isAdm = me.role === 'admin'
  const log = (action: string, type: string, id: string | null, prev: any, next: any, reason?: string) =>
    db.from('audit_logs').insert({ actor_id: uid, action, target_type: type, target_id: id, previous_values: prev, new_values: next, reason: reason || null })
  const must = (r: any) => { if (r.error) throw new Error(r.error.message); return r.data }
  const adminOnly = () => { if (!isAdm) throw new Error('관리자 권한이 필요합니다.') }
  const needReason = () => { const r = str(b.reason, 300); if (!r) throw new Error('사유를 입력해야 합니다.'); return r }
  if (b.session_id && !UUID.test(b.session_id)) return out({ error: '잘못된 ID' }, 400)
  if (b.student_id && !UUID.test(b.student_id)) return out({ error: '잘못된 ID' }, 400)

  try {
    switch (b.action) {
      case 'sweep': {
        await db.rpc('close_expired')
        // 대시보드 표시용: 아직 번호가 저장되지 않은 기존 학생의 번호를 해시에서 복원 (00~99)
        const { data: missing } = await db.from('students').select('id,attendance_code_hash').is('attendance_code', null)
        if (missing && missing.length) {
          const map = new Map<string, string>()
          for (let i = 0; i < 100; i++) { const c = String(i).padStart(2, '0'); map.set(hashCode(c), c) }
          for (const s of missing) { const c = map.get(s.attendance_code_hash); if (c) await db.from('students').update({ attendance_code: c }).eq('id', s.id) }
        }
        return out({ ok: true })
      }

      case 'absent': {
        const reason = needReason(), date = str(b.date, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜 오류')
        const { data: st } = await db.from('students').select('id,name').eq('id', b.student_id).single()
        if (!st) throw new Error('학생 없음')
        const row = must(await db.from('attendance_sessions').insert({ student_id: st.id, student_name: st.name, attendance_date: date, status: 'absent', absence_reason: reason }).select().single())
        await log('mark_absent', 'attendance_session', row.id, null, row, reason); return out({ ok: true })
      }
      case 'cancel_class': {
        const reason = needReason(), date = str(b.date, 10)
        const row = must(await db.from('schedule_exceptions').insert({ student_id: b.student_id, exception_date: date, kind: 'cancelled', reason, created_by: uid }).select().single())
        await log('cancel_class', 'schedule_exception', row.id, null, row, reason); return out({ ok: true })
      }
      case 'manual_checkin': {
        const reason = needReason()
        const row = must(await db.rpc('check_in', { p_student: b.student_id }))
        await log('manual_checkin', 'attendance_session', row.id, null, row, reason); return out({ ok: true })
      }
      case 'edit_times': {
        adminOnly(); const reason = needReason()
        const old = must(await db.from('attendance_sessions').select('*').eq('id', b.session_id).single())
        if (!old.check_in_at) throw new Error('입실 기록이 없는 세션입니다.')
        const t = (v: string) => { if (!/^\d{2}:\d{2}$/.test(v)) throw new Error('시각은 HH:MM 형식입니다.'); return new Date(`${old.attendance_date}T${v}:00+09:00`) }
        const newIn = t(str(b.check_in_hm, 5))
        const dur = new Date(old.scheduled_checkout_at).getTime() - new Date(old.check_in_at).getTime()
        const patch: any = { check_in_at: newIn.toISOString(), scheduled_checkout_at: new Date(newIn.getTime() + dur).toISOString() }
        const co = str(b.checkout_hm, 5)
        if (co) { patch.actual_checkout_at = t(co).toISOString(); patch.status = 'checked_out' }
        else if (old.status === 'checked_out') { patch.actual_checkout_at = null; patch.status = 'checked_in' }
        const row = must(await db.from('attendance_sessions').update(patch).eq('id', old.id).select().single())
        await log('edit_times', 'attendance_session', old.id, old, row, reason); return out({ ok: true })
      }
      case 'student_create': {
        adminOnly()
        const name = str(b.name, 40); if (!name) throw new Error('이름을 입력하세요.')
        for (let i = 0; i < 400; i++) {
          const code = randomCode()
          const r = await db.from('students').insert({ name, grade: b.grade ? +b.grade : null, class_name: str(b.class_name, 40) || null, guardian_phone: phoneOf(b.guardian_phone), student_phone: phoneOf(b.student_phone), attendance_code_hash: hashCode(code), attendance_code: code }).select('id,name').single()
          if (r.error?.code === '23505') continue
          const row = must(r); await log('student_create', 'student', row.id, null, { name }); return out({ ok: true, code, name })
        }
        throw new Error('사용 가능한 번호가 없습니다. 2자리 번호는 최대 100명까지 가능합니다.')
      }
      case 'student_update': {
        adminOnly()
        const patch: any = {}
        if (b.name !== undefined) patch.name = str(b.name, 40)
        if (b.grade !== undefined) patch.grade = b.grade ? +b.grade : null
        if (b.class_name !== undefined) patch.class_name = str(b.class_name, 40) || null
        if (b.active !== undefined) patch.active = !!b.active
        if (b.guardian_phone !== undefined) patch.guardian_phone = phoneOf(b.guardian_phone)
        if (b.student_phone !== undefined) patch.student_phone = phoneOf(b.student_phone)
        const old = must(await db.from('students').select('name,grade,class_name,active').eq('id', b.student_id).single())
        must(await db.from('students').update(patch).eq('id', b.student_id))
        const { guardian_phone: gp, student_phone: sp, ...safe } = patch
        await log('student_update', 'student', b.student_id, old, { ...safe, ...(gp !== undefined || sp !== undefined ? { phone_changed: true } : {}) }); return out({ ok: true })
      }
      case 'reset_code': {
        adminOnly()
        for (let i = 0; i < 400; i++) {
          const code = randomCode()
          const r = await db.from('students').update({ attendance_code_hash: hashCode(code), attendance_code: code }).eq('id', b.student_id)
          if (r.error?.code === '23505') continue
          must(r); await log('reset_code', 'student', b.student_id, null, null); return out({ ok: true, code })
        }
        throw new Error('사용 가능한 번호가 없습니다. 2자리 번호는 최대 100명까지 가능합니다.')
      }
      case 'student_delete': {
        adminOnly()
        const r = await db.from('students').delete().eq('id', b.student_id)
        if (r.error) throw new Error('출결 기록이 있는 학생은 삭제할 수 없습니다. 비활성화를 사용하세요.')
        await log('student_delete', 'student', b.student_id, null, null); return out({ ok: true })
      }
      case 'schedule_set': {
        adminOnly()
        const items = (Array.isArray(b.items) ? b.items : []).slice(0, 14).map((x: any) => {
          if (!(x.weekday >= 1 && x.weekday <= 7) || !/^\d{2}:\d{2}$/.test(x.time)) throw new Error('시간표 형식 오류')
          return { student_id: b.student_id, weekday: +x.weekday, expected_start_time: x.time, duration_minutes: Math.min(240, Math.max(10, +x.minutes || 60)) }
        })
        must(await db.from('schedules').delete().eq('student_id', b.student_id))
        if (items.length) must(await db.from('schedules').insert(items))
        await log('schedule_set', 'student', b.student_id, null, items); return out({ ok: true })
      }
      case 'settings_update': {
        adminOnly()
        const keys = ['class_minutes', 'late_grace_minutes', 'warn_before_minutes', 'max_attempts', 'lockout_minutes']
        const patch: any = { updated_at: new Date().toISOString() }
        for (const k of keys) if (b[k] !== undefined) patch[k] = Math.floor(+b[k])
        if (['allow', 'block'].includes(b.no_schedule_policy)) patch.no_schedule_policy = b.no_schedule_policy
        const old = must(await db.from('settings').select('*').eq('id', 1).single())
        must(await db.from('settings').update(patch).eq('id', 1))
        await log('settings_update', 'settings', null, old, patch); return out({ ok: true })
      }
      case 'staff_add': {
        adminOnly()
        const email = str(b.email, 120), pw = str(b.password, 72), name = str(b.display_name, 40)
        if (!email || pw.length < 8 || !name) throw new Error('이메일, 이름, 8자 이상 비밀번호가 필요합니다.')
        const u = await db.auth.admin.createUser({ email, password: pw, email_confirm: true })
        if (u.error) throw new Error(u.error.message)
        must(await db.from('profiles').insert({ id: u.data.user.id, display_name: name, role: b.role === 'admin' ? 'admin' : 'teacher' }))
        await log('staff_add', 'profile', u.data.user.id, null, { email, name, role: b.role }); return out({ ok: true })
      }
      default: return out({ error: '알 수 없는 요청' }, 400)
    }
  } catch (e: any) {
    const m = String(e.message || '')
    const map: Record<string, string> = { NOT_CHECKED_IN: '진행 중인 입실 기록이 없습니다.', ALREADY_CHECKED_IN: '이미 입실 중입니다.', REASON_REQUIRED: '사유를 입력해야 합니다.', BAD_MINUTES: '연장 시간은 1~240분입니다.', STUDENT_INACTIVE: '비활성 학생입니다.', NO_SCHEDULE: '오늘 시간표가 없습니다.' }
    const k = Object.keys(map).find((x) => m.includes(x))
    return out({ error: k ? map[k] : m.includes('duplicate') ? '이미 기록이 있습니다.' : m }, 400)
  }
}
