'use client'
import { useState } from 'react'
import { browserClient } from '@/lib/supabase-browser'
export default function Login() {
  const [email, setEmail] = useState(''), [pw, setPw] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true); setErr('')
    const { error } = await browserClient().auth.signInWithPassword({ email, password: pw })
    if (error) { setErr('이메일 또는 비밀번호가 맞지 않습니다.'); setBusy(false) } else location.href = '/admin'
  }
  return (
    <main className="login"><div className="panel">
      <h1>선생님 로그인</h1>
      <input type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" placeholder="비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      {err && <p className="err">{err}</p>}
      <button className="primary" disabled={busy} onClick={go}>로그인</button>
      <a href="/">← 학생 화면</a>
    </div></main>
  )
}
