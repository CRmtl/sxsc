-- ============================================================================
-- zxssxsc 第一层防护：Row Level Security
--
-- 需求：对 anon 角色允许 SELECT / INSERT / UPDATE，**禁止 DELETE**。
--
-- 这里有一个容易被忽略的要点：
--   RLS 是「白名单」机制 —— 没有策略就默认拒绝。
--   所以「禁止删除」根本不需要写任何策略，只要**不创建 DELETE 策略**即可。
--   下面额外补一句 REVOKE DELETE 作为第二重保险（表级权限 + 行级策略双层拦截）。
--
-- 另外：策略里的 WITH CHECK 并不是装饰。它会真正参与写入校验，
-- 与 schema.sql 的列 CHECK 约束一起，构成「绕过 API 也写不进脏数据」的保证。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 学校
-- ---------------------------------------------------------------------------
alter table public.schools enable row level security;
-- 强制所有者也受 RLS 约束，避免表所有者的隐式绕过
alter table public.schools force row level security;

drop policy if exists schools_select_anon  on public.schools;
drop policy if exists schools_insert_anon  on public.schools;
drop policy if exists schools_update_anon  on public.schools;
drop policy if exists schools_delete_none  on public.schools;

-- 读：任何人可读（这是公开数据集）
create policy schools_select_anon
  on public.schools
  for select
  to anon, authenticated
  using (true);

-- 增：匿名可增，但必须满足格式约束
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

-- 改：匿名可改（需求明确要求「任意访客可修改，直接生效」）
-- 注意 USING 与 WITH CHECK 都要给：
--   USING 决定「哪些行可以被改」，WITH CHECK 决定「改成什么样是合法的」。
-- 若只写 USING 不写 WITH CHECK，就可能把合法行改成非法行。
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

-- 删：**故意不创建 DELETE 策略** → 匿名删除一律被拒。
-- 下面这句是表级权限的第二重保险。
revoke delete on public.schools from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 版本快照
--
-- 快照本身是「只增不改不删」的审计数据：
--   - 允许读（详情页要展示历史）
--   - 允许写（API 层在修改前插入）
--   - 不允许 update（改了就不叫快照了）
--   - 不允许 delete（否则可以掩盖修改痕迹）
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 大学校历
-- ---------------------------------------------------------------------------
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
    -- 起止要么都填要么都留空，且顺序正确
    and (winter_start is null) = (winter_end is null)
    and (winter_start is null or winter_end >= winter_start)
    and (summer_start is null) = (summer_end is null)
    and (summer_start is null or summer_end >= summer_start)
    -- 至少要有一个完整假期
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

-- ---------------------------------------------------------------------------
-- 大学校历快照：与 school_revisions 同样的待遇 —— 只增不改不删
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 节假日：只读
-- ---------------------------------------------------------------------------
alter table public.holidays enable row level security;
alter table public.holidays force row level security;

drop policy if exists holidays_select_anon on public.holidays;
create policy holidays_select_anon
  on public.holidays
  for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.holidays from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 限流表：访客完全不可见
-- bump_rate_limit() 是 security definer 函数，以定义者身份访问该表，
-- 因此不需要给 anon 任何表权限。
-- ---------------------------------------------------------------------------
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
-- 显式表级授权（不要依赖 Supabase 的隐式默认权限）
--
-- 这一段是补上的，因为线上实测踩到了：新式项目里通过 SQL Editor 建表时，
-- anon 并不一定拿到预期的表级权限，表现为 REST 接口返回
--   401 {"code":"42501","hint":"Grant the required privileges to the current role"}
-- 注意区分：42501 是**表级权限**缺失；RLS 拒绝是 200 + 空数组。
-- 缺读权限会让「学校详情页 / 校历详情页」直接 500，因为那两个页面要读版本历史。
--
-- 所以这里把权限写死：读 / 写明确给，删除明确收回。
-- ============================================================================

-- 读：公开数据，任何人可读
grant select on table public.schools           to anon, authenticated;
grant select on table public.college_holidays  to anon, authenticated;
grant select on table public.holidays          to anon, authenticated;
-- 快照表也要能被读到，否则详情页的「版本历史」区块会 500
grant select on table public.school_revisions          to anon, authenticated;
grant select on table public.college_holiday_revisions to anon, authenticated;

-- 写：允许新增/修改（含写入快照），符合「匿名提交后直接生效」
grant insert, update on table public.schools          to anon, authenticated;
grant insert, update on table public.college_holidays to anon, authenticated;
grant insert         on table public.school_revisions          to anon, authenticated;
grant insert         on table public.college_holiday_revisions to anon, authenticated;

-- 快照只增不改不删
revoke update, delete on table public.school_revisions          from anon, authenticated;
revoke update, delete on table public.college_holiday_revisions from anon, authenticated;

-- 主体数据禁止删除
revoke delete on table public.schools          from anon, authenticated;
revoke delete on table public.college_holidays from anon, authenticated;

-- ============================================================================
-- 自检：确认匿名角色确实无法 DELETE
-- 在 SQL Editor 里执行下面几句应分别得到预期结果：
--
--   set role anon;
--   select count(*) from public.school_revisions;          -- 期望：成功（可能是 0）
--   select count(*) from public.submit_rate_limit;          -- 期望：permission denied
--   delete from public.schools where true;                  -- 期望：permission denied 或 0 行
--   reset role;
-- ============================================================================
