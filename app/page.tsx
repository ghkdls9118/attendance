'use client'
import { useEffect, useRef, useState } from 'react'
import { hm } from '@/lib/status'

export default function Kiosk() {
  const [code, setCode] = useState('')
  const [info, setInfo] = useState<any>(null)
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)
  const offset = useRef(0)
  const timer = useRef<any>(null)

  const reset = () => { setCode(''); setInfo(null); setMsg(''); setDone('') }
  const arm = (ms = 15000) => { clearTimeout(timer.current); timer.current = setTimeout(reset, ms) }
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 10000); return () => clearInterval(i) }, [])

  async function call(action: string, c: string) {
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/kiosk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, code: c }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setCode('')
        setMsg(r.status === 401 ? '번호가 맞지 않아요. 다시 눌러 주세요.' : r.status === 429 ? '잠시 후에 다시 눌러 주세요.'
          : j.error === 'NO_SCHEDULE' ? '오늘은 수업이 없어요. 선생님께 말씀해 주세요.' : '문제가 생겼어요. 선생님께 말씀해 주세요.')
        arm(8000); return null
      }
      offset.current = new Date(j.serverNow).getTime() - Date.now()
      return j
    } catch {
      setCode(''); setMsg('인터넷이 연결되지 않았어요. 기록되지 않았으니 선생님께 말씀해 주세요.'); arm(10000); return null
    } finally { setBusy(false) }
  }
  async function press(d: string) {
    if (busy || code.length >= 4) return
    const n = code + d; setCode(n); arm()
    if (n.length === 4) { const j = await call('lookup', n); if (j) { setInfo(j); arm() } }
  }
  async function act(action: 'checkin' | 'checkout') {
    const j = await call(action, code)
    if (!j) { setInfo(null); return }
    setInfo(j)
    setDone(action === 'checkin' ? '입실이 완료되었습니다.' : '퇴실 요청을 선생님께 보냈어요. 선생님이 확인할 때까지 기다려 주세요.')
    arm(12000)
  }
  const remain = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - (Date.now() + offset.current)) / 60000))
  const s = info?.session

  return (
    <main className="kiosk">
      {!info ? (
        <>
          <h1>출석번호 4자리를 눌러요</h1>
          <div className="dots">{[0, 1, 2, 3].map((i) => <span key={i} className={i < code.length ? 'on' : ''}>{i < code.length ? '●' : '○'}</span>)}</div>
          <p className="err" role="alert">{msg || '\u00a0'}</p>
          <div className="pad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} onClick={() => press(d)}>{d}</button>)}
            <button className="sub" onClick={() => { setCode(''); setMsg('') }}>전체삭제</button>
            <button onClick={() => press('0')}>0</button>
            <button className="sub" onClick={() => setCode(code.slice(0, -1))}>지우기</button>
          </div>
        </>
      ) : (
        <div className="card">
          <h1>{info.name} 학생</h1>
          {done && <p className="ok">{done}</p>}
          {info.notice === 'ALREADY_CHECKED_IN' && <p className="ok">이미 입실했어요.</p>}
          {s ? (
            <>
              <p>입실 시각 <b>{hm(s.check_in_at)}</b></p>
              <p>퇴실 예정 <b>{hm(s.scheduled_checkout_at)}</b></p>
              <p>남은 수업 시간 <b>{remain(s.scheduled_checkout_at)}분</b></p>
              {s.status === 'checkout_requested' && !done && <p className="ok">퇴실 요청 중이에요.</p>}
              {s.status === 'checked_in' && !done && <button className="big warn" disabled={busy} onClick={() => act('checkout')}>퇴실 요청</button>}
            </>
          ) : !done ? <button className="big" disabled={busy} onClick={() => act('checkin')}>입실 등록</button> : null}
          <button className="big sub" onClick={reset}>처음으로</button>
        </div>
      )}
      <a className="staff" href="/login">선생님</a>
    </main>
  )
}
