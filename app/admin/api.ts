export async function api(body: any) {
  try {
    const r = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { alert(j.error || '오류가 발생했습니다.'); return null }
    return j
  } catch { alert('네트워크 오류: 처리되지 않았을 수 있습니다. 새로고침 후 확인하세요.'); return null }
}
