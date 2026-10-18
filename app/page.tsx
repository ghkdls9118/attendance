'use client'
import { useEffect, useRef, useState } from 'react'
import { hm } from '@/lib/status'

const CHEER = ["오늘도 와줘서 고마워! 네가 있어서 우리 교실이 더 환해져요.", "실수해도 괜찮아. 다시 해 보면 점점 더 잘할 수 있어요.", "오늘 하루, 네가 할 수 있는 만큼만 천천히 해 봐요.", "너는 생각보다 훨씬 멋지고 대단한 친구예요!", "모르는 건 부끄러운 게 아니에요. 물어보면 더 크게 자라요.", "오늘 배운 것 하나가 내일의 너를 더 튼튼하게 만들어요.", "힘들 땐 크게 숨 한 번 쉬고, 다시 웃어 보자!", "네가 열심히 하는 모습, 선생님은 다 보고 있어요.", "작은 한 걸음도 큰 용기예요. 오늘도 한 걸음 가 보자!", "친구에게 먼저 인사해 봐요. 오늘이 더 즐거워질 거예요.", "틀려도 괜찮아요. 도전하는 네가 정말 멋져요!", "오늘도 반짝반짝 빛나는 하루가 될 거예요.", "포기하지 않는 마음이 제일 큰 힘이에요.", "너의 노력은 절대 사라지지 않아요. 차곡차곡 쌓이고 있어요.", "웃는 네 얼굴을 보면 모두가 기분이 좋아져요.", "어제보다 조금만 더! 오늘도 잘할 수 있어요.", "궁금한 게 많은 건 좋은 거예요. 오늘도 많이 물어봐요.", "너는 소중한 사람이에요. 오늘도 힘내요!", "천천히 해도 괜찮아요. 끝까지 하는 게 멋져요.", "오늘 하루도 네 편이 되어 줄게요. 파이팅!"]

export default function Kiosk() {
  const [code, setCode] = useState('')
  const [info, setInfo] = useState<any>(null)
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)
  const [popup, setPopup] = useState<string | null>(null)
  const [, tick] = useState(0)
  const offset = useRef(0)
  const timer = useRef<any>(null)

  const reset = () => { setCode(''); setInfo(null); setMsg(''); setDone(''); setPopup(null) }
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
    if (busy || code.length >= 2) return
    const n = code + d; setCode(n); arm()
    if (n.length === 2) { const j = await call('lookup', n); if (j) { setInfo(j); arm() } }
  }
  async function act(action: 'checkin' | 'checkout') {
    const j = await call(action, code)
    if (!j) { setInfo(null); return }
    setInfo(j)
    setDone(action === 'checkin' ? '입실이 완료되었습니다.' : '퇴실이 완료되었습니다. 안녕히 가세요!')
    if (action === 'checkin' && !j.notice) { setPopup(CHEER[Math.floor(Math.random() * CHEER.length)]); arm(30000) } else arm(12000)
  }
  const remain = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - (Date.now() + offset.current)) / 60000))
  const s = info?.session

  return (
    <main className="kiosk">
      {!info ? (
        <>
          <h1>출석번호 2자리를 눌러요</h1>
          <div className="dots">{[0, 1].map((i) => <span key={i} className={i < code.length ? 'on' : ''}>{i < code.length ? '●' : '○'}</span>)}</div>
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
              {!done && <button className="big warn" disabled={busy} onClick={() => act('checkout')}>퇴실하기</button>}
            </>
          ) : !done ? <button className="big" disabled={busy} onClick={() => act('checkin')}>입실 등록</button> : null}
          {done && !s && info.out_at && <p>퇴실 시각 <b>{hm(info.out_at)}</b></p>}
          <button className="big sub" onClick={reset}>처음으로</button>
        </div>
      )}
      {popup && info && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="popup">
            <div className="hearts">💗</div>
            <p className="pname">{info.name} 학생</p>
            <p className="pmsg">{popup}</p>
            <button className="big" onClick={() => { setPopup(null); arm(12000) }}>닫기</button>
          </div>
        </div>
      )}
      <a className="staff" href="/login">선생님</a>
    </main>
  )
}
