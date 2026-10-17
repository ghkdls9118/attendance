-- 학원 스마트 출결 관리: 초기 스키마 (PostgreSQL / Supabase)
-- 시간대 기준: Asia/Seoul. 모든 시각은 timestamptz(서버 now())로 기록.

create extension if not exists pgcrypto;

-- ───────── 설정 (1행 고정) ─────────
create table settings (
  id int primary key default 1 check (id = 1),
  class_minutes int not null default 60 check (class_minutes between 10 and 240),
  late_grace_minutes int not null default 10 check (late_grace_minutes between 0 and 120),
  warn_before_minutes int not null default 5 check (warn_before_minutes between 1 and 30),
  no_schedule_policy text not null default 'allow' check (no_schedule_policy in ('allow','block')),
  max_attempts int not null default 5 check (max_attempts between 3 and 20),
  lockout_minutes int not null default 5 check (lockout_minutes between 1 and 120),
  updated_at timestamptz not null default now()
);
insert into settings default values;

-- ───────── 관리자 프로필 (auth.users 연결) ─────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'teacher' check (role in ('admin','teacher')),
  created_at timestamptz not null default now()
);

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid());
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- ───────── 학생 ─────────
create table students (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  grade smallint check (grade between 1 and 12),
  class_name text,
  attendance_code_hash text not null unique,  -- HMAC-SHA256(code, CODE_PEPPER), 서버에서 계산
  active boolean not null default true,
  guardian_phone text,                         -- 선택. admin만 조회(뷰/정책 참고)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────── 시간표 ─────────
create table schedules (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 월=1 … 일=7
  expected_start_time time not null,
  duration_minutes int not null default 60 check (duration_minutes between 10 and 240),
  active boolean not null default true,
  unique (student_id, weekday, expected_start_time)
);

-- 휴강/사전 결석 예정 (미도착 목록에서 제외)
create table schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade, -- null이면 전체 휴원
  exception_date date not null,
  kind text not null check (kind in ('holiday','cancelled','planned_absence')),
  reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (student_id, exception_date)
);

-- ───────── 출결 세션 ─────────
create table attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete restrict,
  student_name text not null,                 -- 입실 당시 이름 스냅샷
  attendance_date date not null default ((now() at time zone 'Asia/Seoul')::date),
  check_in_at timestamptz,                    -- 결석 기록은 null
  scheduled_checkout_at timestamptz,
  checkout_requested_at timestamptz,
  actual_checkout_at timestamptz,
  status text not null check (status in ('checked_in','checkout_requested','checked_out','absent')),
  is_late boolean not null default false,
  absence_reason text,
  extension_minutes int not null default 0 check (extension_minutes between 0 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_checked_in_has_times check (
    status = 'absent' or (check_in_at is not null and scheduled_checkout_at is not null)
  ),
  constraint chk_checkout_after_checkin check (
    actual_checkout_at is null or actual_checkout_at >= check_in_at
  ),
  constraint chk_checked_out_has_time check (
    (status = 'checked_out') = (actual_checkout_at is not null)
  )
);

-- 중복 입실 방지: 학생당 진행 중 세션은 최대 1개
create unique index uq_one_active_session
  on attendance_sessions (student_id)
  where status in ('checked_in','checkout_requested');

-- 학생당 하루 결석 기록은 1개
create unique index uq_one_absence_per_day
  on attendance_sessions (student_id, attendance_date)
  where status = 'absent';

create index idx_sessions_date on attendance_sessions (attendance_date);

-- ───────── 감사 로그 ─────────
create table audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,                              -- null = 키오스크/시스템
  action text not null,
  target_type text not null,
  target_id uuid,
  previous_values jsonb,
  new_values jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index idx_audit_target on audit_logs (target_type, target_id);

-- ───────── 알림 이벤트 ─────────
create table notification_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  attendance_session_id uuid not null references attendance_sessions(id) on delete cascade,
  event_type text not null check (event_type in ('warn_before_end','time_up','checkout_overdue','checkout_requested')),
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  status text not null default 'pending' check (status in ('pending','sent','acknowledged')),
  unique (attendance_session_id, event_type)  -- 멱등: 같은 알림은 한 번만 생성
);

-- ───────── 키오스크 시도 기록 (무작위 대입 방지) ─────────
create table kiosk_attempts (
  id bigint generated always as identity primary key,
  device_key text not null,                   -- 서버가 IP+기기 토큰으로 만든 해시
  success boolean not null,
  created_at timestamptz not null default now()
);
create index idx_attempts_recent on kiosk_attempts (device_key, created_at desc);

-- ───────── updated_at 자동 갱신 ─────────
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger trg_students_touch before update on students for each row execute function touch_updated_at();
create trigger trg_sessions_touch before update on attendance_sessions for each row execute function touch_updated_at();

-- ───────── 서버 함수 (service_role 전용) ─────────

-- 잠금 여부: 기기별 + 전체 합산 제한
create or replace function kiosk_is_locked(p_device text) returns boolean
language plpgsql security definer set search_path = public as $$
declare s settings; dev_fail int; all_fail int;
begin
  select * into s from settings where id = 1;
  select count(*) into dev_fail from kiosk_attempts
   where device_key = p_device and not success
     and created_at > now() - make_interval(mins => s.lockout_minutes)
     and created_at > coalesce((select max(created_at) from kiosk_attempts
                                where device_key = p_device and success), '-infinity');
  select count(*) into all_fail from kiosk_attempts
   where not success and created_at > now() - make_interval(mins => s.lockout_minutes);
  return dev_fail >= s.max_attempts or all_fail >= s.max_attempts * 6;
end $$;

create or replace function kiosk_log_attempt(p_device text, p_success boolean) returns void
language sql security definer set search_path = public as $$
  insert into kiosk_attempts (device_key, success) values (p_device, p_success);
$$;

-- 입실: 서버 시각 기준, 원자적 처리
create or replace function check_in(p_student uuid) returns attendance_sessions
language plpgsql security definer set search_path = public as $$
declare
  s settings; st students; sch schedules; sess attendance_sessions;
  v_now timestamptz := now();
  v_today date := (v_now at time zone 'Asia/Seoul')::date;
  v_dow int := extract(isodow from (v_now at time zone 'Asia/Seoul'))::int;
  v_late boolean := false; v_minutes int;
begin
  select * into s from settings where id = 1;
  select * into st from students where id = p_student for update;  -- 동시 요청 직렬화
  if not found or not st.active then raise exception 'STUDENT_INACTIVE'; end if;

  if exists (select 1 from attendance_sessions
              where student_id = p_student and status in ('checked_in','checkout_requested')) then
    raise exception 'ALREADY_CHECKED_IN';
  end if;

  select * into sch from schedules
   where student_id = p_student and weekday = v_dow and active
   order by expected_start_time limit 1;

  if not found and s.no_schedule_policy = 'block' then raise exception 'NO_SCHEDULE'; end if;

  v_minutes := coalesce(sch.duration_minutes, s.class_minutes);
  if found then
    v_late := ((v_now at time zone 'Asia/Seoul')::time) >
              (sch.expected_start_time + make_interval(mins => s.late_grace_minutes));
  end if;

  -- 오늘 결석으로 기록돼 있었다면 입실 기록으로 전환(이력 남김)
  select * into sess from attendance_sessions
   where student_id = p_student and attendance_date = v_today and status = 'absent' for update;
  if found then
    update attendance_sessions set status = 'checked_in', check_in_at = v_now,
           scheduled_checkout_at = v_now + make_interval(mins => v_minutes),
           is_late = v_late
     where id = sess.id returning * into sess;
    insert into audit_logs (action, target_type, target_id, previous_values, new_values, reason)
    values ('absent_to_checkin','attendance_session',sess.id,
            jsonb_build_object('status','absent'), to_jsonb(sess), '결석 기록 후 입실');
  else
    insert into attendance_sessions
      (student_id, student_name, attendance_date, check_in_at, scheduled_checkout_at, status, is_late)
    values (p_student, st.name, v_today, v_now, v_now + make_interval(mins => v_minutes), 'checked_in', v_late)
    returning * into sess;
    insert into audit_logs (action, target_type, target_id, new_values)
    values ('check_in','attendance_session',sess.id,to_jsonb(sess));
  end if;
  return sess;
end $$;

-- 퇴실 요청 (학생). 퇴실 완료는 아님.
create or replace function request_checkout(p_student uuid) returns attendance_sessions
language plpgsql security definer set search_path = public as $$
declare sess attendance_sessions;
begin
  update attendance_sessions
     set status = 'checkout_requested', checkout_requested_at = coalesce(checkout_requested_at, now())
   where student_id = p_student and status in ('checked_in','checkout_requested')
   returning * into sess;
  if not found then raise exception 'NOT_CHECKED_IN'; end if;
  insert into notification_events (student_id, attendance_session_id, event_type, scheduled_at)
  values (p_student, sess.id, 'checkout_requested', now())
  on conflict do nothing;
  insert into audit_logs (action, target_type, target_id, new_values)
  values ('checkout_requested','attendance_session',sess.id,to_jsonb(sess));
  return sess;
end $$;

-- 퇴실 완료 (교사). 실제 퇴실 시각은 서버 now()
create or replace function complete_checkout(p_session uuid, p_actor uuid) returns attendance_sessions
language plpgsql security definer set search_path = public as $$
declare old attendance_sessions; sess attendance_sessions;
begin
  select * into old from attendance_sessions where id = p_session for update;
  if not found or old.status not in ('checked_in','checkout_requested') then
    raise exception 'NOT_CHECKED_IN';
  end if;
  update attendance_sessions set status = 'checked_out', actual_checkout_at = now()
   where id = p_session returning * into sess;
  update notification_events set status = 'acknowledged', acknowledged_at = now()
   where attendance_session_id = p_session and status <> 'acknowledged';
  insert into audit_logs (actor_id, action, target_type, target_id, previous_values, new_values)
  values (p_actor,'checkout_completed','attendance_session',p_session,
          jsonb_build_object('status',old.status), to_jsonb(sess));
  return sess;
end $$;

-- 연장 수업 (admin). 사유 필수.
create or replace function extend_session(p_session uuid, p_minutes int, p_reason text, p_actor uuid)
returns attendance_sessions
language plpgsql security definer set search_path = public as $$
declare old attendance_sessions; sess attendance_sessions;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_minutes < 1 or p_minutes > 240 then raise exception 'BAD_MINUTES'; end if;
  select * into old from attendance_sessions where id = p_session for update;
  if not found or old.status not in ('checked_in','checkout_requested') then
    raise exception 'NOT_CHECKED_IN';
  end if;
  update attendance_sessions
     set scheduled_checkout_at = scheduled_checkout_at + make_interval(mins => p_minutes),
         extension_minutes = extension_minutes + p_minutes,
         status = 'checked_in'
   where id = p_session returning * into sess;
  delete from notification_events where attendance_session_id = p_session and sent_at is null
        and event_type in ('warn_before_end','time_up','checkout_overdue');
  insert into audit_logs (actor_id, action, target_type, target_id, previous_values, new_values, reason)
  values (p_actor,'extend_session','attendance_session',p_session,
          to_jsonb(old), to_jsonb(sess), p_reason);
  return sess;
end $$;

-- 스케줄러: 1분마다 실행. 시간 경과에 따른 알림 이벤트를 서버에서 생성.
-- (상태 '퇴실 예정/퇴실 확인 필요'는 저장하지 않고 시각 비교로 도출 → 항상 정확)
create or replace function tick() returns void
language plpgsql security definer set search_path = public as $$
declare s settings;
begin
  select * into s from settings where id = 1;

  insert into notification_events (student_id, attendance_session_id, event_type, scheduled_at)
  select student_id, id, 'warn_before_end', scheduled_checkout_at - make_interval(mins => s.warn_before_minutes)
    from attendance_sessions
   where status in ('checked_in','checkout_requested')
     and now() >= scheduled_checkout_at - make_interval(mins => s.warn_before_minutes)
  on conflict do nothing;

  insert into notification_events (student_id, attendance_session_id, event_type, scheduled_at)
  select student_id, id, 'time_up', scheduled_checkout_at
    from attendance_sessions
   where status in ('checked_in','checkout_requested') and now() >= scheduled_checkout_at
  on conflict do nothing;

  insert into notification_events (student_id, attendance_session_id, event_type, scheduled_at)
  select student_id, id, 'checkout_overdue', scheduled_checkout_at + interval '5 minutes'
    from attendance_sessions
   where status in ('checked_in','checkout_requested')
     and now() >= scheduled_checkout_at + interval '5 minutes'
  on conflict do nothing;

  update notification_events set status = 'sent', sent_at = now() where status = 'pending';

  -- 오래된 시도 기록 정리
  delete from kiosk_attempts where created_at < now() - interval '2 days';
end $$;

-- ───────── 권한: 함수는 service_role만 실행 ─────────
revoke all on function kiosk_is_locked(text), kiosk_log_attempt(text,boolean), check_in(uuid),
  request_checkout(uuid), complete_checkout(uuid,uuid), extend_session(uuid,int,text,uuid), tick()
  from public, anon, authenticated;
grant execute on function kiosk_is_locked(text), kiosk_log_attempt(text,boolean), check_in(uuid),
  request_checkout(uuid), complete_checkout(uuid,uuid), extend_session(uuid,int,text,uuid), tick()
  to service_role;

-- ───────── RLS: 익명(키오스크)은 어떤 테이블도 직접 접근 불가 ─────────
alter table settings enable row level security;
alter table profiles enable row level security;
alter table students enable row level security;
alter table schedules enable row level security;
alter table schedule_exceptions enable row level security;
alter table attendance_sessions enable row level security;
alter table audit_logs enable row level security;
alter table notification_events enable row level security;
alter table kiosk_attempts enable row level security;  -- 정책 없음 = 서버(service_role)만 접근

create policy settings_read on settings for select using (is_staff());
create policy settings_write on settings for update using (is_admin()) with check (is_admin());

create policy profiles_self on profiles for select using (id = auth.uid() or is_admin());
create policy profiles_admin on profiles for all using (is_admin()) with check (is_admin());

create policy students_read on students for select using (is_staff());
create policy students_write on students for all using (is_admin()) with check (is_admin());

create policy schedules_read on schedules for select using (is_staff());
create policy schedules_write on schedules for all using (is_admin()) with check (is_admin());

create policy exceptions_read on schedule_exceptions for select using (is_staff());
create policy exceptions_write on schedule_exceptions for all using (is_staff()) with check (is_staff());

-- 출결 기록: 직원은 조회, 수정은 서버 함수/관리자 API 경유(감사 로그 보장)
create policy sessions_read on attendance_sessions for select using (is_staff());
create policy audit_read on audit_logs for select using (is_staff());
create policy notif_read on notification_events for select using (is_staff());
create policy notif_ack on notification_events for update using (is_staff()) with check (is_staff());

-- 보호자 연락처는 admin만 (컬럼 단위 권한)
revoke select (guardian_phone) on students from authenticated;
grant select (guardian_phone) on students to service_role;

-- Realtime 대상
alter publication supabase_realtime add table attendance_sessions, notification_events;

-- ───────── 예약 작업: 매분 tick() (Database → Extensions에서 pg_cron 활성화 후 실행) ─────────
-- select cron.schedule('attendance-tick', '* * * * *', $$select public.tick()$$);

-- ───────── 첫 관리자 지정 (Authentication → Users에서 계정 생성 후 이메일 교체해 실행) ─────────
-- insert into profiles (id, display_name, role)
-- select id, '원장', 'admin' from auth.users where email = 'you@example.com';
