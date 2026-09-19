-- ============================================================================
-- 迁移：把 college_holidays 从「一条假期一行」改成「一校一学年一行」
--
-- 旧结构：holiday_type / start_date / end_date / days
--         同一所学校同一学年会有 2 行（寒假一行、暑假一行）
-- 新结构：winter_start / winter_end / summer_start / summer_end / source_url / version
--         同一所学校同一学年只有 1 行，(university_name, academic_year) 唯一
--
-- 为什么改：现实中抓到的校历就是「某某大学 2025-2026 学年校历」一份文档，
-- 里面同时写着寒假和暑假。宽表与数据来源同构，(校名, 学年) 也成了天然唯一键，
-- 于是「重复导入同一所学校」可以直接 upsert 而不会堆重复行。
--
-- 本脚本是**幂等**的：
--   - 如果旧结构不存在（全新安装），什么都不做
--   - 如果已经是新结构，什么都不做
--
-- 注意：旧结构里的 holiday_type='other' 记录无法映射到新结构（新结构只有寒/暑假），
-- 会在迁移中被丢弃。执行前请先跑一下文末的检查语句确认数量。
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

  -- ------------------------------------------------------------------
  -- 1. 建新表
  -- ------------------------------------------------------------------
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

  -- ------------------------------------------------------------------
  -- 2. 透视：寒假/暑假各一行 → 合并成一行
  -- ------------------------------------------------------------------
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
    -- 旧结构的 source 是自由文本，新结构要求 URL；不是 URL 的就不迁移过去，
    -- 而是并进备注，避免把「某某教务网」这种文字塞进 source_url 字段
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
  -- 至少要有一个完整假期，否则会被新表的 has_window 约束挡住
  having min(start_date) filter (where holiday_type in ('winter', 'summer')) is not null;

  -- ------------------------------------------------------------------
  -- 3. 换表
  -- ------------------------------------------------------------------
  drop table public.college_holidays;
  alter table public.college_holidays_new rename to college_holidays;

  -- ------------------------------------------------------------------
  -- 4. 索引与注释
  -- ------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 新增：大学校历快照表
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
-- updated_at 触发器
-- ---------------------------------------------------------------------------
drop trigger if exists college_holidays_touch_updated_at on public.college_holidays;
create trigger college_holidays_touch_updated_at
  before update on public.college_holidays
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- 重要：迁移结束后必须重新执行 supabase/rls.sql
-- 因为换表之后旧策略随旧表一起消失了。
--
-- 检查旧数据里有多少 other 类型会被丢弃（迁移前跑）：
--   select holiday_type, count(*) from public.college_holidays group by 1;
-- ============================================================================
