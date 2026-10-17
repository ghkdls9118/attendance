# 학원 스마트 출결 관리

Next.js 15 + TypeScript + Supabase. 
## 설정 순서
1. supabase.com 프로젝트 생성(서울 리전)
2. SQL Editor에서 `supabase/migrations/001_init.sql` 전체 실행
3. Database → Extensions → `pg_cron` 활성화 후 실행:
   `select cron.schedule('attendance-tick','* * * * *',$$select public.tick()$$);`
4. Authentication → Users → Add user (이메일/비밀번호) → 아래 SQL로 관리자 지정
   `insert into profiles(id,display_name,role) select id,'원장','admin' from auth.users where email='you@example.com';`
5. `.env.local` 작성 (`.env.example` 참고). `CODE_PEPPER`는 `openssl rand -hex 32`. 한 번 정하면 바꾸지 마세요(바꾸면 모든 출결번호 재발급 필요).
6. 로컬: `npm install && npm run dev`  → `/` 학생 화면, `/login` 선생님
7. 배포: GitHub 업로드 → Vercel Import → 환경변수 4개 입력 → Deploy (HTTPS 자동)
8. 백업: Supabase 유료 플랜 일일 백업/PITR 사용, 무료면 주 1회 `pg_dump`

## 구조 메모
- 학생 키오스크는 DB에 직접 접근하지 않고 `/api/kiosk` (service role, 서버 전용)만 사용
- 출결번호는 HMAC-SHA256(+CODE_PEPPER)로 저장, 원문은 발급 시 한 번만 표시
- 퇴실 예정/퇴실 확인 필요는 시각 비교로 도출, 자동 퇴실 처리 없음
- 대시보드: Realtime + 15초 재조회. 브라우저 알림은 대시보드가 열려 있을 때만 동작(서버 알림 이벤트는 매분 pg_cron이 생성)
- 문자/카카오 알림은 미구현(notification_events 테이블 연결 지점만 있음)
