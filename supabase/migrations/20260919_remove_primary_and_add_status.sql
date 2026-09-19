-- ============================================================================
-- 迁移：移除小学相关数据，并新增 status 字段
--
-- 背景：项目决定不再收录小学数据，School.stage 只保留 初中 / 高中 / 其他。
-- 但数据库里可能已经有 stage='primary' 的历史记录。
--
-- 处理策略：**标记弃用而不是删除**。
--   1. 加 status 字段（默认 active）
--   2. 把 stage='primary' 的记录标为 deprecated
--   3. 收紧 stage 约束，但为「已弃用的旧记录」留一个例外
--      —— 否则第 3 步会直接失败，因为旧行仍然带着 'primary'
--   4. 前端所有读路径只查 status='active'，于是这些记录自然不再出现
--
-- 这样做的理由：数据是匿名访客贡献的，直接 DELETE 不可逆；
-- 而且这一层防护明确禁止 anon 角色 DELETE，用 UPDATE 打标记才是同一条路径。
--
-- 在 Supabase SQL Editor 中执行本文件。可重复执行（幂等）。
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. 新增 status
-- ---------------------------------------------------------------------------
alter table public.schools
  add column if not exists status text not null default 'active';

comment on column public.schools.status is
  '记录状态。deprecated = 停止收录但保留数据，前端不展示。';

-- ---------------------------------------------------------------------------
-- 2. 先标记，再收紧约束（顺序不能反）
-- ---------------------------------------------------------------------------

-- 小学
update public.schools
   set status = 'deprecated',
       updated_at = now(),
       remark = coalesce(remark || ' ', '') || '[已停止收录：本项目不再包含小学数据]'
 where stage = 'primary'
   and status <> 'deprecated';

-- 顺带把其他已移除的学段也一并弃用：
--   vocational 中职/技校、combined 一贯制 —— stage 只保留 初中/高中/其他。
-- 若你希望把它们改判为 'other' 而不是弃用，把下面这条 update 换成：
--   update public.schools set stage='other' where stage in ('vocational','combined');
update public.schools
   set status = 'deprecated',
       updated_at = now(),
       remark = coalesce(remark || ' ', '') || '[已停止收录：学段口径收敛为 初中/高中/其他]'
 where stage in ('vocational', 'combined')
   and status <> 'deprecated';

-- ---------------------------------------------------------------------------
-- 3. 收紧 stage 约束（为已弃用的旧记录保留例外）
-- ---------------------------------------------------------------------------
alter table public.schools drop constraint if exists schools_stage_check;
alter table public.schools drop constraint if exists schools_stage_valid;

alter table public.schools
  add constraint schools_stage_valid check (
    stage in ('junior','senior','other')
    or (status = 'deprecated' and stage = 'primary')
    -- 已弃用的 vocational / combined 也要能留存，否则上面的 update 会被约束挡住
    or (status = 'deprecated' and stage in ('vocational','combined'))
  );

-- ---------------------------------------------------------------------------
-- 4. 读路径加速：前端固定带 status='active'
-- ---------------------------------------------------------------------------
create index if not exists schools_status_idx on public.schools (status);

commit;

-- ============================================================================
-- 验证
-- ============================================================================
-- 应当返回 0 行：不再有「active 但学段非法」的记录
--   select id, name, stage, status from public.schools
--    where status = 'active' and stage not in ('junior','senior','other');
--
-- 看看被弃用了多少条：
--   select stage, count(*) from public.schools
--    where status = 'deprecated' group by stage order by 2 desc;
--
-- 确认前端口径（只会看到初中/高中/其他）：
--   select stage, count(*) from public.schools
--    where status = 'active' group by stage;
-- ============================================================================
