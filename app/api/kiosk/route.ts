import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { admin } from '@/lib/admin'
import { hashCode } from '@/lib/code'
export const dynamic = 'force-dynamic'
const out = (b: any, status = 200) => NextResponse.json(b, { status })

export async function POST(req: NextRequest) {
  let b: any
  try { b = await req.json() } catch { return out({ error: 'BAD_REQUEST' }, 400) }
  const { action, code } = b || {}
  if (!/^\d{2}$/.test(code || '') || !['lookup', 'checkin', 'checkout'].includes(action)) return out({ error: 'BAD_REQUEST' }, 400)

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'x'
  const dev = createHash('sha256').update(ip + '|' + (req.headers.get('user-agent') || '')).digest('hex').slice(0, 32)
  const db = admin()

  const { data: locked } = await db.rpc('kiosk_is_locked', { p_device: dev })
  if (locked) return out({ error: 'LOCKED' }, 429)

  const { data: st } = await db.from('students').select('id,name')
    .eq('attendance_code_hash', hashCode(code)).eq('active', true).maybeSingle()
  await db.rpc('kiosk_log_attempt', { p_device: dev, p_success: !!st })
  if (!st) return out({ error: 'INVALID' }, 401)  // 이름 등 어떤 정보도 반환하지 않음

  await db.rpc('close_expired')
    let notice: string | null = null
  let outAt: string | null = null

  if (action === 'checkin') {
    const r = await db.rpc('check_in', { p_student: st.id })

    if (r.error) {
      const k = [
        'ALREADY_CHECKED_IN',
        'NO_SCHEDULE',
        'STUDENT_INACTIVE',
        'NOT_CHECKED_IN'
      ].find((x) => r.error!.message.includes(x))

      if (!k) return out({ error: 'SERVER' }, 500)

      if (k === 'NO_SCHEDULE' || k === 'STUDENT_INACTIVE') {
        return out({ error: k }, 403)
      }

      notice = k
    }
  }

  if (action === 'checkout') {
    // 해당 학생의 진행 중인 출결 세션 찾기
    const { data: activeSession, error: sessionError } = await db
      .from('attendance_sessions')
      .select('id')
      .eq('student_id', st.id)
      .in('status', ['checked_in', 'checkout_requested'])
      .maybeSingle()

    if (sessionError) {
      return out({ error: 'SERVER' }, 500)
    }

    if (!activeSession) {
      notice = 'NOT_CHECKED_IN'
    } else {
      // 퇴실 요청만 하는 것이 아니라 실제 퇴실 완료 처리
      const r = await db.rpc('complete_checkout', {
        p_session: activeSession.id,
        p_actor: null
      })

            if (r.error) {
        console.error('[CHECKOUT ERROR]', r.error)
        return out({
          error: 'CHECKOUT_FAILED',
          message: r.error.message
        }, 500)
      }

      outAt = r.data?.actual_checkout_at ?? null

      if (!outAt) {
        console.error('[CHECKOUT ERROR] Missing actual_checkout_at', r.data)
        return out({
          error: 'CHECKOUT_TIME_MISSING'
        }, 500)
      }
    }
  }
