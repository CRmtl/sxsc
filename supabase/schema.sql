-- ============================================================================
-- zxssxsc 数据库结构
-- 在 Supabase SQL Editor 中执行本文件（或 supabase db push）。
--
-- 设计要点：
--   1. 所有「格式合法性」都由 CHECK 约束在数据库层兜底 ——
--      即使有人绕过我们的 API 直接打 PostgREST，也写不进脏数据。
--   2. lat/lng 直接按中国范围做 CHECK，等于把「必须在中国境内」变成不可绕过的约束。
--   3. college_holidays.days 与起止日期的一致性也用 CHECK 锁死，
--      避免出现 days 和日期区间互相矛盾的记录。
--   4. 版本历史用独立的 school_revisions 表存快照（jsonb），
--      因为要求「支持回滚」，必须保留完整的旧值而不是只存 diff。
-- ============================================================================

create extension if not exists pgcrypto;
-- 用于学校名的模糊/相似搜索索引
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- 中学
-- ---------------------------------------------------------------------------
create table if not exists public.schools (
  id              uuid primary key default gen_random_uuid(),
  name            text not null
                    check (char_length(name) between 2 and 80)
                    -- 禁止尖括号，挡住最基础的 HTML 注入尝试
                    check (name !~ '[<>]'),
  stage           text not null,
  -- 记录状态：历史遗留数据（已不收录的学段）标为 deprecated，前端只展示 active
  status          text not null default 'active'
                    check (status in ('active','deprecated')),
  province        text not null check (char_length(province) between 1 and 30),
  city            text not null check (char_length(city)     between 1 and 30),
  district        text not null check (char_length(district) between 1 and 30),
  address         text check (address is null or char_length(address) <= 120),

  -- 中国经纬度范围（含港澳台），与前端 geo.ts 的 CHINA_BBOX 保持一致
  lat             double precision not null check (lat between 3.0  and 54.0),
  lng             double precision not null check (lng between 73.0 and 136.0),

  daily_hours     numeric(4,1) not null check (daily_hours between 0 and 24),
  weekly_days     numeric(3,1) not null check (weekly_days between 1 and 7),
  monthly_days    smallint     not null check (monthly_days between 1 and 31),
  boarding        boolean      not null default false,

  -- { arrive_time, leave_time, boarding_schedule, day_schedule }
  schedule_json   jsonb        not null default '{}'::jsonb
                    check (jsonb_typeof(schedule_json) = 'object'),

  remark          text check (remark is null or char_length(remark) <= 500),
  created_at      timestamptz  not null default now(),
  updated_at      timestamptz  not null default now(),
  version         integer      not null default 1 check (version >= 1),

  -- 学段合法性：只允许 初中 / 高中 / 其他。
  -- 兼容迁移前的历史数据：已标记为 deprecated 的旧记录允许保留原学段值，
  -- 否则「先标记弃用再收紧约束」这个迁移顺序会直接失败。
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
-- 按名称模糊搜索（ILIKE '%xx%'）走 trigram 索引，避免全表扫描
create index if not exists schools_name_trgm_idx on public.schools using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 修改前快照（用于回滚）
-- ---------------------------------------------------------------------------
create table if not exists public.school_revisions (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  -- 该快照对应的版本号（即「被这次修改覆盖掉的那一版」）
  version      integer not null check (version >= 1),
  snapshot     jsonb   not null,
  change_note  text check (change_note is null or char_length(change_note) <= 200),
  created_at   timestamptz not null default now()
);

comment on table public.school_revisions is '学校数据的修改前快照，支持回滚；同一 (school_id, version) 只应有一条';

create index if not exists school_revisions_school_idx
  on public.school_revisions (school_id, version desc);

-- ---------------------------------------------------------------------------
-- 大学校历（一校一学年一行）
--
-- 为什么是宽表而不是「一条假期一行」：现实中抓到的校历就是
-- 「某某大学 2025-2026 学年校历」一份文档，里面同时写着寒假和暑假的起止。
-- 于是 (university_name, academic_year) 成了天然唯一键，
-- 重复导入同一所学校可以直接 upsert，不会堆出重复行。
-- ---------------------------------------------------------------------------
create table if not exists public.college_holidays (
  id               uuid primary key default gen_random_uuid(),
  university_name  text not null
                     check (char_length(university_name) between 2 and 60)
                     check (university_name !~ '[<>]'),
  province         text not null check (char_length(province) between 1 and 30),
  city             text not null check (char_length(city)     between 1 and 30),

  -- 需求里的数据模型没有要求大学坐标，但地图着色必须有位置，
  -- 因此这里补上 lat/lng（见 README「我做的假设」）
  lat              double precision not null check (lat between 3.0  and 54.0),
  lng              double precision not null check (lng between 73.0 and 136.0),

  academic_year    text not null check (academic_year ~ '^\d{4}-\d{4}$'),

  -- 未抓取到的假期留 null，前端显示「未公布」
  winter_start     date,
  winter_end       date,
  summer_start     date,
  summer_end       date,

  source_url       text check (source_url is null or char_length(source_url) <= 300),
  note             text check (note       is null or char_length(note)       <= 300),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1 check (version >= 1),

  -- 一个学校一个学年只应有一行
  constraint college_holidays_uni_year unique (university_name, academic_year),

  -- 起止要么都填要么都留空，且顺序正确
  constraint college_holidays_winter_pair check (
    (winter_start is null) = (winter_end is null)
    and (winter_start is null or winter_end >= winter_start)
  ),
  constraint college_holidays_summer_pair check (
    (summer_start is null) = (summer_end is null)
    and (summer_start is null or summer_end >= summer_start)
  ),
  -- 至少要有一个完整假期，否则这行没有任何可展示的信息
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

-- ---------------------------------------------------------------------------
-- 大学校历的修改前快照（用于回滚）
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 节假日（用于「备注节日」）
-- ---------------------------------------------------------------------------
create table if not exists public.holidays (
  date  date primary key,
  name  text not null check (char_length(name) between 1 and 40),
  type  text not null check (type in ('statutory','traditional','school','international','other'))
);

comment on table public.holidays is '法定/传统节假日，用于在放假查询页标注当天是什么节';

-- ---------------------------------------------------------------------------
-- 限流计数（仅 service_role 可访问，用于 Edge Function 的跨实例严格限流）
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- updated_at 自动维护
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 原子限流计数器
--
-- 用 INSERT ... ON CONFLICT DO UPDATE 在一条语句里完成「读-判-增」，
-- 天然并发安全，不会像「先 select 再 update」那样在并发下漏计。
-- 返回 true 表示本次放行。
-- ---------------------------------------------------------------------------
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

  -- 顺手清理 2 小时前的旧窗口，避免表无限增长
  delete from public.submit_rate_limit where window_start < now() - interval '2 hours';

  return v_count <= p_limit;
end;
$$;

comment on function public.bump_rate_limit(text, integer) is
  'IP 小时窗口限流计数，返回 true 表示放行。仅 service_role 可执行。';

revoke all on function public.bump_rate_limit(text, integer) from public, anon, authenticated;
grant execute on function public.bump_rate_limit(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 可选加固：把版本快照改成数据库触发器
--
-- 当前实现是在 API 层写快照（已在 scripts/smoke-test.mjs 中验证过
-- 「修改 → 快照 → 回滚」全链路）。API 层的好处是逻辑集中、容易改；
-- 代价是如果有人绕过 API 直接 UPDATE，就不会留下快照。
--
-- 如果你希望「无论如何都留痕」，请**同时**做两件事，否则会出现重复快照：
--   1. 取消下面的注释；
--   2. 删掉 src/lib/data-source.ts 里对 school_revisions 的两次 insert。
-- ---------------------------------------------------------------------------
-- create or replace function public.snapshot_school_before_update()
-- returns trigger language plpgsql as $$
-- begin
--   insert into public.school_revisions (school_id, version, snapshot)
--   values (old.id, old.version, to_jsonb(old));
--   new.version := old.version + 1;
--   return new;
-- end; $$;
--
-- drop trigger if exists schools_snapshot on public.schools;
-- create trigger schools_snapshot
--   before update on public.schools
--   for each row execute function public.snapshot_school_before_update();
