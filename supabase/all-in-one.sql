-- ============================================================================
-- zxssxsc Supabase 数据库初始化（合并版，一次粘贴执行）
--
-- 由 scripts/build-sql-bundle.mjs 生成，请勿手改。
-- 想改内容请改 supabase/ 下的源文件，再重新生成。
--
-- 执行顺序（已按此顺序合并，直接整体粘贴即可）：
--   1. schema.sql                                                 全新安装与升级都需要
--   2. migrations/20260919_remove_primary_and_add_status.sql      旧库：把 stage=primary 的历史记录标记为 deprecated
--   3. migrations/20260919_college_calendar_wide.sql              旧库：把寒假/暑假两行透视成一行
--   4. rls.sql                                                    必须放在两个 migration 之后
--   5. seed.sql                                                   可重复执行
--   6. admin-cleanup.sql                                          只有 service_role 可用
--
-- 幂等性：
--   全部语句都可以重复执行。全新项目与已在用旧版的项目都能跑同一个文件。
--   * 建表用 create table if not exists
--   * 策略用 drop policy if exists 再 create policy
--   * 两个 migration 会自行检测旧结构是否存在，不存在就跳过
--
-- 安全性说明（重要）：
--   anon 角色被明确禁止 DELETE —— rls.sql 里没有任何 DELETE 策略，
--   并且额外 revoke 了表级 DELETE 权限。清理垃圾数据请用文件末尾的
--   管理员通道（只授予 service_role）。
-- ============================================================================

-- ============================================================================
-- [1/6] schema.sql
-- 建表 / 索引 / CHECK 约束 / 原子限流函数
-- 全新安装与升级都需要
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.schools (
  id              uuid primary key default gen_random_uuid(),
  name            text not null
                    check (char_length(name) between 2 and 80)
                    check (name !~ '[<>]'),
  stage           text not null,
  status          text not null default 'active'
                    check (status in ('active','deprecated')),
  province        text not null check (char_length(province) between 1 and 30),
  city            text not null check (char_length(city)     between 1 and 30),
  district        text not null check (char_length(district) between 1 and 30),
  address         text check (address is null or char_length(address) <= 120),

  lat             double precision not null check (lat between 3.0  and 54.0),
  lng             double precision not null check (lng between 73.0 and 136.0),

  daily_hours     numeric(4,1) not null check (daily_hours between 0 and 24),
  weekly_days     numeric(3,1) not null check (weekly_days between 1 and 7),
  monthly_days    smallint     not null check (monthly_days between 1 and 31),
  boarding        boolean      not null default false,

  schedule_json   jsonb        not null default '{}'::jsonb
                    check (jsonb_typeof(schedule_json) = 'object'),

  remark          text check (remark is null or char_length(remark) <= 500),
  created_at      timestamptz  not null default now(),
  updated_at      timestamptz  not null default now(),
  version         integer      not null default 1 check (version >= 1),

  constraint schools_stage_valid check (
    stage in ('junior','senior','other')
    or (status = 'deprecated' and stage = 'primary')
  )
);

comment on table  public.schools is '中学上学时长数据，匿名访客可新增/修改，禁止删除';
comment on column public.schools.schedule_json is '作息 JSON：{arrive_time,leave_time,boarding_schedule,day_schedule}';
comment on column public.schools.version is '版本号，每次修改 +1；旧值见 school_revisions';

create index if not exists schools_area_idx   on public.schools (province, city, district);
create index if not exists schools_hours_idx  on public.schools (daily_hours);
create index if not exists schools_updated_idx on public.schools (updated_at desc);
create index if not exists schools_name_trgm_idx on public.schools using gin (name gin_trgm_ops);

create table if not exists public.school_revisions (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  version      integer not null check (version >= 1),
  snapshot     jsonb   not null,
  change_note  text check (change_note is null or char_length(change_note) <= 200),
  created_at   timestamptz not null default now()
);

comment on table public.school_revisions is '学校数据的修改前快照，支持回滚；同一 (school_id, version) 只应有一条';

create index if not exists school_revisions_school_idx
  on public.school_revisions (school_id, version desc);

create table if not exists public.college_holidays (
  id               uuid primary key default gen_random_uuid(),
  university_name  text not null
                     check (char_length(university_name) between 2 and 60)
                     check (university_name !~ '[<>]'),
  province         text not null check (char_length(province) between 1 and 30),
  city             text not null check (char_length(city)     between 1 and 30),

  lat              double precision not null check (lat between 3.0  and 54.0),
  lng              double precision not null check (lng between 73.0 and 136.0),

  academic_year    text not null check (academic_year ~ '^\d{4}-\d{4}$'),

  winter_start     date,
  winter_end       date,
  summer_start     date,
  summer_end       date,

  source_url       text check (source_url is null or char_length(source_url) <= 300),
  note             text check (note       is null or char_length(note)       <= 300),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1 check (version >= 1),

  constraint college_holidays_uni_year unique (university_name, academic_year),

  constraint college_holidays_winter_pair check (
    (winter_start is null) = (winter_end is null)
    and (winter_start is null or winter_end >= winter_start)
  ),
  constraint college_holidays_summer_pair check (
    (summer_start is null) = (summer_end is null)
    and (summer_start is null or summer_end >= summer_start)
  ),
  constraint college_holidays_has_window check (
    winter_start is not null or summer_start is not null
  )
);

comment on table public.college_holidays is
  '大学校历（一校一学年一行），匿名访客可新增/修改，禁止删除';
comment on column public.college_holidays.version is
  '版本号，每次修改 +1；旧值见 college_holiday_revisions';

create index if not exists college_holidays_uni_idx  on public.college_holidays (university_name);
create index if not exists college_holidays_year_idx on public.college_holidays (academic_year);
create index if not exists college_holidays_area_idx on public.college_holidays (province, city);
create index if not exists college_holidays_name_trgm_idx
  on public.college_holidays using gin (university_name gin_trgm_ops);

create table if not exists public.college_holiday_revisions (
  id           uuid primary key default gen_random_uuid(),
  holiday_id   uuid not null references public.college_holidays(id) on delete cascade,
  version      integer not null check (version >= 1),
  snapshot     jsonb   not null,
  change_note  text check (change_note is null or char_length(change_note) <= 200),
  created_at   timestamptz not null default now()
);

comment on table public.college_holiday_revisions is
  '大学校历的修改前快照，只增不改不删';

create index if not exists college_holiday_revisions_idx
  on public.college_holiday_revisions (holiday_id, version desc);

create table if not exists public.holidays (
  date  date primary key,
  name  text not null check (char_length(name) between 1 and 40),
  type  text not null check (type in ('statutory','traditional','school','international','other'))
);

comment on table public.holidays is '法定/传统节假日，用于在放假查询页标注当天是什么节';

create table if not exists public.submit_rate_limit (
  ip            text        not null,
  window_start  timestamptz not null,
  count         integer     not null default 0 check (count >= 0),
  primary key (ip, window_start)
);

comment on table public.submit_rate_limit is
  '按 IP + 小时窗口的滑动计数器。只允许 service_role 访问，访客无权读写。';

create index if not exists submit_rate_limit_window_idx
  on public.submit_rate_limit (window_start);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists schools_touch_updated_at on public.schools;
create trigger schools_touch_updated_at
  before update on public.schools
  for each row execute function public.touch_updated_at();

drop trigger if exists college_holidays_touch_updated_at on public.college_holidays;
create trigger college_holidays_touch_updated_at
  before update on public.college_holidays
  for each row execute function public.touch_updated_at();

create or replace function public.bump_rate_limit(
  p_ip    text,
  p_limit integer default 3
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := date_trunc('hour', now());
  v_count  integer;
begin
  insert into public.submit_rate_limit (ip, window_start, count)
  values (p_ip, v_window, 1)
  on conflict (ip, window_start)
    do update set count = public.submit_rate_limit.count + 1
  returning count into v_count;

  delete from public.submit_rate_limit where window_start < now() - interval '2 hours';

  return v_count <= p_limit;
end;
$$;

comment on function public.bump_rate_limit(text, integer) is
  'IP 小时窗口限流计数，返回 true 表示放行。仅 service_role 可执行。';

revoke all on function public.bump_rate_limit(text, integer) from public, anon, authenticated;
grant execute on function public.bump_rate_limit(text, integer) to service_role;


-- ============================================================================
-- [2/6] migrations/20260919_remove_primary_and_add_status.sql
-- 学段收敛为 初中/高中/其他，并新增 status 字段
-- 旧库：把 stage=primary 的历史记录标记为 deprecated
-- ============================================================================

begin;

alter table public.schools
  add column if not exists status text not null default 'active';

comment on column public.schools.status is
  '记录状态。deprecated = 停止收录但保留数据，前端不展示。';

update public.schools
   set status = 'deprecated',
       updated_at = now(),
       remark = coalesce(remark || ' ', '') || '[已停止收录：本项目不再包含小学数据]'
 where stage = 'primary'
   and status <> 'deprecated';

update public.schools
   set status = 'deprecated',
       updated_at = now(),
       remark = coalesce(remark || ' ', '') || '[已停止收录：学段口径收敛为 初中/高中/其他]'
 where stage in ('vocational', 'combined')
   and status <> 'deprecated';

alter table public.schools drop constraint if exists schools_stage_check;
alter table public.schools drop constraint if exists schools_stage_valid;

alter table public.schools
  add constraint schools_stage_valid check (
    stage in ('junior','senior','other')
    or (status = 'deprecated' and stage = 'primary')
    or (status = 'deprecated' and stage in ('vocational','combined'))
  );

create index if not exists schools_status_idx on public.schools (status);

commit;


-- ============================================================================
-- [3/6] migrations/20260919_college_calendar_wide.sql
-- 大学校历改「一校一学年一行」宽表
-- 旧库：把寒假/暑假两行透视成一行
-- ============================================================================

do $$
declare
  v_has_old boolean;
  v_has_new boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'college_holidays'
       and column_name  = 'holiday_type'
  ) into v_has_old;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'college_holidays'
       and column_name  = 'winter_start'
  ) into v_has_new;

  if v_has_old and v_has_new then
    raise notice 'college_holidays 同时存在新旧字段，请人工确认后再迁移，本次不执行任何操作。';
    return;
  end if;

  if v_has_new then
    raise notice 'college_holidays 已经是新结构，无需迁移。';
    return;
  end if;

  if not v_has_old then
    raise notice '未找到 college_holidays 旧表，跳过迁移。请直接执行 supabase/schema.sql。';
    return;
  end if;

  raise notice '开始迁移 college_holidays 到宽表结构…';

  create table public.college_holidays_new (
    id               uuid primary key default gen_random_uuid(),
    university_name  text not null
                       check (char_length(university_name) between 2 and 60)
                       check (university_name !~ '[<>]'),
    province         text not null check (char_length(province) between 1 and 30),
    city             text not null check (char_length(city)     between 1 and 30),
    lat              double precision not null check (lat between 3.0  and 54.0),
    lng              double precision not null check (lng between 73.0 and 136.0),
    academic_year    text not null check (academic_year ~ '^\d{4}-\d{4}$'),
    winter_start     date,
    winter_end       date,
    summer_start     date,
    summer_end       date,
    source_url       text check (source_url is null or char_length(source_url) <= 300),
    note             text check (note       is null or char_length(note)       <= 300),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    version          integer not null default 1 check (version >= 1),
    constraint college_holidays_uni_year unique (university_name, academic_year),
    constraint college_holidays_winter_pair check (
      (winter_start is null) = (winter_end is null)
      and (winter_start is null or winter_end >= winter_start)
    ),
    constraint college_holidays_summer_pair check (
      (summer_start is null) = (summer_end is null)
      and (summer_start is null or summer_end >= summer_start)
    ),
    constraint college_holidays_has_window check (
      winter_start is not null or summer_start is not null
    )
  );

  insert into public.college_holidays_new (
    university_name, province, city, lat, lng, academic_year,
    winter_start, winter_end, summer_start, summer_end,
    source_url, note, created_at, updated_at, version
  )
  select
    university_name,
    min(province),
    min(city),
    min(lat),
    min(lng),
    academic_year,
    min(start_date) filter (where holiday_type = 'winter'),
    max(end_date)   filter (where holiday_type = 'winter'),
    min(start_date) filter (where holiday_type = 'summer'),
    max(end_date)   filter (where holiday_type = 'summer'),
    min(source) filter (where source ~* '^https?://'),
    nullif(
      concat_ws(
        '；',
        min(note),
        min(source) filter (where source is not null and source !~* '^https?://')
      ),
      ''
    ),
    min(created_at),
    now(),
    1
  from public.college_holidays
  where holiday_type in ('winter', 'summer')
  group by university_name, academic_year
  having min(start_date) filter (where holiday_type in ('winter', 'summer')) is not null;

  drop table public.college_holidays;
  alter table public.college_holidays_new rename to college_holidays;

  create index if not exists college_holidays_uni_idx  on public.college_holidays (university_name);
  create index if not exists college_holidays_year_idx on public.college_holidays (academic_year);
  create index if not exists college_holidays_area_idx on public.college_holidays (province, city);
  create index if not exists college_holidays_name_trgm_idx
    on public.college_holidays using gin (university_name gin_trgm_ops);

  comment on table public.college_holidays is
    '大学校历（一校一学年一行），匿名访客可新增/修改，禁止删除';
  comment on column public.college_holidays.version is
    '版本号，每次修改 +1；旧值见 college_holiday_revisions';

  raise notice 'college_holidays 迁移完成。';
end $$;

create table if not exists public.college_holiday_revisions (
  id           uuid primary key default gen_random_uuid(),
  holiday_id   uuid not null references public.college_holidays(id) on delete cascade,
  version      integer not null check (version >= 1),
  snapshot     jsonb   not null,
  change_note  text check (change_note is null or char_length(change_note) <= 200),
  created_at   timestamptz not null default now()
);

comment on table public.college_holiday_revisions is
  '大学校历的修改前快照，只增不改不删';

create index if not exists college_holiday_revisions_idx
  on public.college_holiday_revisions (holiday_id, version desc);

drop trigger if exists college_holidays_touch_updated_at on public.college_holidays;
create trigger college_holidays_touch_updated_at
  before update on public.college_holidays
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- [4/6] rls.sql
-- 第一层防护：RLS 策略（anon 禁止 DELETE）
-- 必须放在两个 migration 之后
-- ============================================================================

alter table public.schools enable row level security;
alter table public.schools force row level security;

drop policy if exists schools_select_anon  on public.schools;
drop policy if exists schools_insert_anon  on public.schools;
drop policy if exists schools_update_anon  on public.schools;
drop policy if exists schools_delete_none  on public.schools;

create policy schools_select_anon
  on public.schools
  for select
  to anon, authenticated
  using (true);

create policy schools_insert_anon
  on public.schools
  for insert
  to anon, authenticated
  with check (
    char_length(name) between 2 and 80
    and name !~ '[<>]'
    and stage in ('junior','senior','other')
    and char_length(province) between 1 and 30
    and char_length(city)     between 1 and 30
    and char_length(district) between 1 and 30
    and (address is null or char_length(address) <= 120)
    and lat between 3.0 and 54.0
    and lng between 73.0 and 136.0
    and daily_hours between 0 and 24
    and weekly_days between 1 and 7
    and monthly_days between 1 and 31
    and (remark is null or char_length(remark) <= 500)
    and version >= 1
  );

create policy schools_update_anon
  on public.schools
  for update
  to anon, authenticated
  using (true)
  with check (
    char_length(name) between 2 and 80
    and name !~ '[<>]'
    and stage in ('junior','senior','other')
    and char_length(province) between 1 and 30
    and char_length(city)     between 1 and 30
    and char_length(district) between 1 and 30
    and (address is null or char_length(address) <= 120)
    and lat between 3.0 and 54.0
    and lng between 73.0 and 136.0
    and daily_hours between 0 and 24
    and weekly_days between 1 and 7
    and monthly_days between 1 and 31
    and (remark is null or char_length(remark) <= 500)
    and version >= 1
  );

revoke delete on public.schools from anon, authenticated;

alter table public.school_revisions enable row level security;
alter table public.school_revisions force row level security;

drop policy if exists school_revisions_select_anon on public.school_revisions;
drop policy if exists school_revisions_insert_anon on public.school_revisions;

create policy school_revisions_select_anon
  on public.school_revisions
  for select
  to anon, authenticated
  using (true);

create policy school_revisions_insert_anon
  on public.school_revisions
  for insert
  to anon, authenticated
  with check (
    version >= 1
    and jsonb_typeof(snapshot) = 'object'
    and (change_note is null or char_length(change_note) <= 200)
  );

revoke update, delete on public.school_revisions from anon, authenticated;

alter table public.college_holidays enable row level security;
alter table public.college_holidays force row level security;

drop policy if exists college_holidays_select_anon on public.college_holidays;
drop policy if exists college_holidays_insert_anon on public.college_holidays;
drop policy if exists college_holidays_update_anon on public.college_holidays;

create policy college_holidays_select_anon
  on public.college_holidays
  for select
  to anon, authenticated
  using (true);

create policy college_holidays_insert_anon
  on public.college_holidays
  for insert
  to anon, authenticated
  with check (
    char_length(university_name) between 2 and 60
    and university_name !~ '[<>]'
    and char_length(province) between 1 and 30
    and char_length(city)     between 1 and 30
    and lat between 3.0 and 54.0
    and lng between 73.0 and 136.0
    and academic_year ~ '^\d{4}-\d{4}$'
    and (winter_start is null) = (winter_end is null)
    and (winter_start is null or winter_end >= winter_start)
    and (summer_start is null) = (summer_end is null)
    and (summer_start is null or summer_end >= summer_start)
    and (winter_start is not null or summer_start is not null)
    and (source_url is null or char_length(source_url) <= 300)
    and (note       is null or char_length(note)       <= 300)
    and version >= 1
  );

create policy college_holidays_update_anon
  on public.college_holidays
  for update
  to anon, authenticated
  using (true)
  with check (
    char_length(university_name) between 2 and 60
    and university_name !~ '[<>]'
    and char_length(province) between 1 and 30
    and char_length(city)     between 1 and 30
    and lat between 3.0 and 54.0
    and lng between 73.0 and 136.0
    and academic_year ~ '^\d{4}-\d{4}$'
    and (winter_start is null) = (winter_end is null)
    and (winter_start is null or winter_end >= winter_start)
    and (summer_start is null) = (summer_end is null)
    and (summer_start is null or summer_end >= summer_start)
    and (winter_start is not null or summer_start is not null)
    and (source_url is null or char_length(source_url) <= 300)
    and (note       is null or char_length(note)       <= 300)
    and version >= 1
  );

revoke delete on public.college_holidays from anon, authenticated;

alter table public.college_holiday_revisions enable row level security;
alter table public.college_holiday_revisions force row level security;

drop policy if exists college_holiday_revisions_select_anon on public.college_holiday_revisions;
drop policy if exists college_holiday_revisions_insert_anon on public.college_holiday_revisions;

create policy college_holiday_revisions_select_anon
  on public.college_holiday_revisions
  for select
  to anon, authenticated
  using (true);

create policy college_holiday_revisions_insert_anon
  on public.college_holiday_revisions
  for insert
  to anon, authenticated
  with check (
    version >= 1
    and jsonb_typeof(snapshot) = 'object'
    and (change_note is null or char_length(change_note) <= 200)
  );

revoke update, delete on public.college_holiday_revisions from anon, authenticated;

alter table public.holidays enable row level security;
alter table public.holidays force row level security;

drop policy if exists holidays_select_anon on public.holidays;
create policy holidays_select_anon
  on public.holidays
  for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.holidays from anon, authenticated;

alter table public.submit_rate_limit enable row level security;
alter table public.submit_rate_limit force row level security;

drop policy if exists submit_rate_limit_service_only on public.submit_rate_limit;
create policy submit_rate_limit_service_only
  on public.submit_rate_limit
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.submit_rate_limit from anon, authenticated;


-- ============================================================================
-- [5/6] seed.sql
-- 节假日种子数据
-- 可重复执行
-- ============================================================================

insert into public.holidays (date, name, type) values
  ('2025-01-01', '元旦',       'statutory'),
  ('2025-01-28', '除夕',       'traditional'),
  ('2025-01-29', '春节',       'statutory'),
  ('2025-04-04', '清明节',     'statutory'),
  ('2025-05-01', '劳动节',     'statutory'),
  ('2025-05-31', '端午节',     'statutory'),
  ('2025-10-01', '国庆节',     'statutory'),
  ('2025-10-06', '中秋节',     'statutory'),
  ('2026-01-01', '元旦（参考）',   'statutory'),
  ('2026-02-16', '除夕（参考）',   'traditional'),
  ('2026-02-17', '春节（参考）',   'statutory'),
  ('2026-04-05', '清明节（参考）', 'statutory'),
  ('2026-05-01', '劳动节（参考）', 'statutory'),
  ('2026-06-19', '端午节（参考）', 'statutory'),
  ('2026-09-25', '中秋节（参考）', 'statutory'),
  ('2026-10-01', '国庆节（参考）', 'statutory')
on conflict (date) do update
  set name = excluded.name,
      type = excluded.type;


-- ============================================================================
-- [6/6] admin-cleanup.sql
-- 管理员清理通道（归档 + 删除函数）
-- 只有 service_role 可用
-- ============================================================================

begin;

create table if not exists public.deleted_records (
  id            uuid primary key default gen_random_uuid(),
  table_name    text not null,
  record_id     uuid not null,
  payload       jsonb not null,
  reason        text,
  deleted_at    timestamptz not null default now(),
  deleted_by    text not null default current_user
);

comment on table public.deleted_records is
  '管理员删除记录前的归档副本，用于事后还原；只有 service_role 可访问';

create index if not exists deleted_records_table_idx
  on public.deleted_records (table_name, deleted_at desc);
create index if not exists deleted_records_record_idx
  on public.deleted_records (record_id);

alter table public.deleted_records enable row level security;
alter table public.deleted_records force row level security;

drop policy if exists deleted_records_service_only on public.deleted_records;
create policy deleted_records_service_only
  on public.deleted_records
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.deleted_records from anon, authenticated;

commit;

create or replace function public.admin_delete_school(
  p_id     uuid,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.schools;
begin
  select * into v_row from public.schools where id = p_id;
  if not found then
    return 0;
  end if;

  insert into public.deleted_records (table_name, record_id, payload, reason)
  values ('schools', v_row.id, to_jsonb(v_row), p_reason);

  delete from public.schools where id = p_id;

  return 1;
end;
$$;

comment on function public.admin_delete_school(uuid, text) is
  '管理员删除一所学校（先归档到 deleted_records）。仅 service_role 可执行。';

create or replace function public.admin_delete_college_calendar(
  p_id     uuid,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.college_holidays;
begin
  select * into v_row from public.college_holidays where id = p_id;
  if not found then
    return 0;
  end if;

  insert into public.deleted_records (table_name, record_id, payload, reason)
  values ('college_holidays', v_row.id, to_jsonb(v_row), p_reason);

  delete from public.college_holidays where id = p_id;

  return 1;
end;
$$;

comment on function public.admin_delete_college_calendar(uuid, text) is
  '管理员删除一条大学校历（先归档到 deleted_records）。仅 service_role 可执行。';

revoke all on function public.admin_delete_school(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_delete_college_calendar(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_delete_school(uuid, text) to service_role;
grant execute on function public.admin_delete_college_calendar(uuid, text) to service_role;