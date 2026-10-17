'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { browserClient } from '@/lib/supabase-browser'
import { api } from '../api'
import { roleOf } from '../role'
const DAYS = ['', '월', '화', '수', '목', '금', '토', '일']

function Student({ s, sch, isAdmin, reload, showCode }: any) {
  const [f, setF] = useState({ name: s.name, grade: s.grade ?? '', class_name: s.class_name ?? '' })
  const [items, setItems] = useState<any[]>(sch.map((x: any) => ({ weekday: x.weekday, time: x.expected_start_time.slice(0, 5), minutes: x.duration_minutes })))
  const done = async (body: any) => { const j = await api({ student_id: s.id, ...body }); if (j) { if (j.code) showCode(s.name, j.code); reload() } }
  return (
    <details className="stu">
      <summary>{s.name} <small>{s.grade ? s.grade + '학년' : ''} {s.class_name || ''}</small> {!s.active && <span className="badge s-done">비활성</span>}</summary>
      <div className="form">
        <input value={f.name} disabled={!isAdmin} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="이름" />
        <input value={f.grade} disabled={!isAdmin} onChange={(e) => setF({ ...f, grade: e.target.value })} placeholder="학년" type="number" />
        <input value={f.class_name} disabled={!isAdmin} onChange={(e) => setF({ ...f, class_name: e.target.value })} placeholder="반" />
        {isAdmin && <button onClick={() => done({ action: 'student_update', ...f })}>정보 저장</button>}
      </div>
      <h4>수업 시간표</h4>
      {items.map((it, i) => (
        <div className="form" key={i}>
          <select disabled={!isAdmin} value={it.weekday} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, weekday: +e.target.value } : x))}>{[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DAYS[d]}요일</option>)}</select>
          <input disabled={!isAdmin} type="time" value={it.time} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, time: e.target.value } : x))} />
          <input disabled={!isAdmin} type="number" value={it.minutes} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, minutes: e.target.value } : x))} /><span>분</span>
          {isAdmin && <button onClick={() => setItems(items.filter((_, j) => j !== i))}>삭제</button>}
        </div>
      ))}
      {isAdmin && <div className="form">
        <button onClick={() => setItems([...items, { weekday: 1, time: '16:00', minutes: 60 }])}>+ 요일 추가</button>
        <button className="primary" onClick={() => done({ action: 'schedule_set', items })}>시간표 저장</button>
      </div>}
      {isAdmin && <div className="form">
        <button onClick={() => done({ action: 'student_update', active: !s.active })}>{s.active ? '비활성화' : '활성화'}</button>
        <button onClick={() => confirm('출결번호를 새로 발급할까요? 기존 번호는 사용할 수 없게 됩니다.') && done({ action: 'reset_code' })}>출결번호 재설정</button>
        <button className="danger" onClick={() => confirm(s.name + ' 학생을 삭제할까요?') && done({ action: 'student_delete' })}>삭제</button>
      </div>}
    </details>
  )
}

export default function Students() {
  const sb = useMemo(() => browserClient(), [])
  const [list, setList] = useState<any[]>([]), [sch, setSch] = useState<any[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [code, setCode] = useState<{ n: string; c: string } | null>(null)
  const [f, setF] = useState({ name: '', grade: '', class_name: '', guardian_phone: '' })
  useEffect(() => setIsAdmin(roleOf() === 'admin'), [])
  const reload = useCallback(async () => {
    const a = await sb.from('students').select('id,name,grade,class_name,active').order('name')
    const b = await sb.from('schedules').select('*').order('weekday')
    setList(a.data || []); setSch(b.data || [])
  }, [sb])
  useEffect(() => { reload() }, [reload])
  async function add() {
    const j = await api({ action: 'student_create', ...f })
    if (j) { setCode({ n: j.name, c: j.code }); setF({ name: '', grade: '', class_name: '', guardian_phone: '' }); reload() }
  }
  return (
    <div>
      {code && <div className="alertbox big">{code.n} 학생의 출결번호: <b className="codebig">{code.c}</b><br />보안상 이 화면에서만 볼 수 있습니다. 학생에게 전달하고 닫으세요. <button onClick={() => setCode(null)}>닫기</button></div>}
      {isAdmin && <div className="panel"><h3>학생 등록</h3><div className="form">
        <input placeholder="이름" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input placeholder="학년" type="number" value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })} />
        <input placeholder="반" value={f.class_name} onChange={(e) => setF({ ...f, class_name: e.target.value })} />
        <input placeholder="보호자 연락처(선택)" value={f.guardian_phone} onChange={(e) => setF({ ...f, guardian_phone: e.target.value })} />
        <button className="primary" onClick={add}>등록 · 번호 발급</button>
      </div></div>}
      {list.map((s) => <Student key={s.id + s.active + JSON.stringify(sch.filter((x) => x.student_id === s.id))} s={s} sch={sch.filter((x) => x.student_id === s.id)} isAdmin={isAdmin} reload={reload} showCode={(n: string, c: string) => setCode({ n, c })} />)}
      {!list.length && <p className="empty">등록된 학생이 없습니다.</p>}
    </div>
  )
}
