-- ============================================================================
-- 修复：两张快照表缺少 anon 的 SELECT 授权
--
-- 症状（用 anon key 访问 REST 接口时实测）：
--   GET /rest/v1/school_revisions              → 401 {"code":"42501",
--     "hint":"Grant the required privileges to the current role with: GRANT SELECT ON ..."}
--   GET /rest/v1/college_holiday_revisions     → 同样 42501
--
-- 影响：学校详情页与校历详情页都要读版本历史，授权缺失会让这两个页面 500。
--      （地图页不受影响，因为它只读 schools / college_holidays。）
--
-- 原因：42501 是**表级权限**缺失，不是 RLS 拒绝 ——
--      RLS 拒绝表现为 200 + 空数组，而不是 401。
--      不要依赖「Supabase 会自动给 anon 授权」这个假设：
--      通过 SQL Editor 建表时，默认权限不一定按预期生效。
--      显式 GRANT 才是确定的。
--
-- 本文件幂等，可重复执行。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 补齐读权限
-- ---------------------------------------------------------------------------

-- 这两张快照表要被匿名访客读到（详情页展示版本历史）
grant select on table public.school_revisions           to anon, authenticated;
grant select on table public.college_holiday_revisions  to anon, authenticated;

-- 主表本来就能读，这里一并显式声明，避免再依赖默认权限
grant select on table public.schools           to anon, authenticated;
grant select on table public.college_holidays  to anon, authenticated;
grant select on table public.holidays          to anon, authenticated;

-- 写权限：匿名访客可以新增/修改（含写快照），这是需求要求的
grant insert, update on table public.schools           to anon, authenticated;
grant insert, update on table public.college_holidays  to anon, authenticated;
grant insert         on table public.school_revisions           to anon, authenticated;
grant insert         on table public.college_holiday_revisions  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. 明确收回不该有的权限（保持「anon 禁止 DELETE」这条硬约束）
-- ---------------------------------------------------------------------------

-- 快照只增不改不删
revoke update, delete on table public.school_revisions          from anon, authenticated;
revoke update, delete on table public.college_holiday_revisions from anon, authenticated;

-- 主体数据禁止删除（RLS 里也没有 DELETE 策略，这是双保险）
revoke delete on table public.schools          from anon, authenticated;
revoke delete on table public.college_holidays from anon, authenticated;

-- 这两张表对访客完全不可见：
--   submit_rate_limit 由 bump_rate_limit()（security definer）自己访问；
--   deleted_records 是管理员删除归档，只给 service_role。
revoke all on table public.submit_rate_limit from anon, authenticated;
revoke all on table public.deleted_records   from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. 自检：下面这几条查询的预期结果
-- ---------------------------------------------------------------------------
-- 用 anon key 调 REST 接口验证（或直接在 SQL Editor 里 set role anon）：
--
--   set role anon;
--   select count(*) from public.school_revisions;            -- 期望：成功（可能是 0）
--   select count(*) from public.college_holiday_revisions;   -- 期望：成功（可能是 0）
--   select count(*) from public.submit_rate_limit;           -- 期望：permission denied
--   select count(*) from public.deleted_records;             -- 期望：permission denied
--   delete from public.schools where true;                   -- 期望：permission denied
--   reset role;
-- ============================================================================
