-- ============================================================================
-- 清理冒烟测试写入的测试数据
--
-- 背景：scripts/smoke-test.mjs 会真的新增/修改数据。它只应该在
-- **演示（mock）模式**下运行。有一次 dev server 因为 .env.local 被改动而
-- 热切换到了 Supabase 模式，冒烟测试随即把测试数据写进了真实库。
-- 这个文件用来把那些数据清掉。
--
-- 安全设计：
--   1. 删除前先归档到 deleted_records，可还原；
--   2. **只匹配测试专用的名字前缀**（真实学校不可能叫「冒烟测试中学」）；
--   3. 全程在一个事务里，出错整体回滚；
--   4. 先给你一条 SELECT 让你核对，再执行删除。
--
-- 在 Supabase SQL Editor 中执行（它以 postgres 身份运行，绕过 RLS）。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 第 1 步：先核对（把这两条 SELECT 单独跑一遍，确认结果都是测试数据）
-- ---------------------------------------------------------------------------
-- select id, name, province, city, created_at
--   from public.schools
--  where name in ('冒烟测试中学', '版本链路测试中学')
--     or name like '限流测试中学 %'
--  order by created_at;
--
-- select id, university_name, academic_year, created_at
--   from public.college_holidays
--  where university_name like '冒烟测试大学-%'
--  order by created_at;

begin;

-- ---------------------------------------------------------------------------
-- 第 2 步：归档（保证可还原）
-- ---------------------------------------------------------------------------
create table if not exists public.deleted_records (
  id          uuid primary key default gen_random_uuid(),
  table_name  text not null,
  record_id   uuid not null,
  payload     jsonb not null,
  reason      text,
  deleted_at  timestamptz not null default now(),
  deleted_by  text not null default current_user
);

insert into public.deleted_records (table_name, record_id, payload, reason)
select 'schools', s.id, to_jsonb(s), '清理冒烟测试数据'
  from public.schools s
 where s.name in ('冒烟测试中学', '版本链路测试中学')
    or s.name like '限流测试中学 %';

insert into public.deleted_records (table_name, record_id, payload, reason)
select 'college_holidays', c.id, to_jsonb(c), '清理冒烟测试数据'
  from public.college_holidays c
 where c.university_name like '冒烟测试大学-%';

-- ---------------------------------------------------------------------------
-- 第 3 步：删除（快照表通过外键 on delete cascade 一并清除）
-- ---------------------------------------------------------------------------
delete from public.schools
 where name in ('冒烟测试中学', '版本链路测试中学')
    or name like '限流测试中学 %';

delete from public.college_holidays
 where university_name like '冒烟测试大学-%';

commit;

-- ---------------------------------------------------------------------------
-- 第 4 步：核对结果
-- ---------------------------------------------------------------------------
-- 期望：schools 剩 0 行（除非你自己导入过数据）
--   select count(*) from public.schools;
--
-- 期望：college_holidays 只剩你自己的那条（西华大学）
--   select university_name, academic_year, version from public.college_holidays order by university_name;
--
-- 归档留痕：
--   select deleted_at, table_name, payload->>'name' as name, payload->>'university_name' as uni
--     from public.deleted_records order by deleted_at desc;

-- ---------------------------------------------------------------------------
-- 如果想还原（把某条归档记录插回去）
-- ---------------------------------------------------------------------------
-- insert into public.schools
-- select * from jsonb_populate_record(null::public.schools, (
--   select payload from public.deleted_records
--    where table_name = 'schools' and record_id = '<上面查到的 record_id>'
--    order by deleted_at desc limit 1
-- ));
-- ============================================================================
