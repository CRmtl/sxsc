-- ============================================================================
-- 管理员清理通道（SQL 删除）
--
-- 背景：按需求，anon 角色对 schools / college_holidays **完全禁止 DELETE**
--      （RLS 里没有任何 DELETE 策略，且额外 REVOKE 了表级 DELETE 权限）。
--       这是对的：匿名数据集最怕的就是被人一键清空。
--
-- 但垃圾/恶意数据总得能清掉。所以留这条**只给管理员**的通道：
--   * 所有函数都是 SECURITY DEFINER，且 EXECUTE 权限只授予 service_role；
--   * 直接执行 SQL 也行 —— Supabase SQL Editor 以 postgres 身份运行，绕过 RLS。
--
-- 三条安全设计（这是删除路径，不能图省事）：
--   1. **先归档再删除**：被删的行会先整行写进 deleted_records，事后可还原；
--   2. **限定 service_role**：anon / authenticated 连函数都调不到；
--   3. **提供软删除替代**：schools.status='deprecated' 只下架不销毁，优先用它。
--
-- 在 Supabase SQL Editor 中执行本文件。可重复执行（幂等）。
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 归档表：删除前先把整行副本留下来
-- ---------------------------------------------------------------------------
create table if not exists public.deleted_records (
  id            uuid primary key default gen_random_uuid(),
  table_name    text not null,
  record_id     uuid not null,
  payload       jsonb not null,
  reason        text,
  deleted_at    timestamptz not null default now(),
  -- 谁删的：SQL Editor 直接执行时通常是 postgres / service_role
  deleted_by    text not null default current_user
);

comment on table public.deleted_records is
  '管理员删除记录前的归档副本，用于事后还原；只有 service_role 可访问';

create index if not exists deleted_records_table_idx
  on public.deleted_records (table_name, deleted_at desc);
create index if not exists deleted_records_record_idx
  on public.deleted_records (record_id);

-- 归档表本身也不允许改：它是一条只能追加的审计流水
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

-- ---------------------------------------------------------------------------
-- 删除函数（先归档，再删；返回被删行数）
-- ---------------------------------------------------------------------------

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

  -- school_revisions.school_id 是 on delete cascade，会随主行一起删掉。
  -- 这是有意的：某所学校的版本历史与它同源，主行被判定为垃圾时历史也一并清掉。
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

  -- college_holiday_revisions.holiday_id 同样是 on delete cascade
  delete from public.college_holidays where id = p_id;

  return 1;
end;
$$;

comment on function public.admin_delete_college_calendar(uuid, text) is
  '管理员删除一条大学校历（先归档到 deleted_records）。仅 service_role 可执行。';


-- 只给 service_role —— anon / authenticated 连调用权限都没有
revoke all on function public.admin_delete_school(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_delete_college_calendar(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_delete_school(uuid, text) to service_role;
grant execute on function public.admin_delete_college_calendar(uuid, text) to service_role;


-- ============================================================================
-- 日常怎么用
-- ============================================================================
--
-- 【1】软删除（推荐先用这个）：只下架，不销毁数据
--      update public.schools
--         set status = 'deprecated',
--             remark = coalesce(remark || ' ', '') || '[管理员下架：疑似垃圾数据]'
--       where name ilike '%广告%';
--      前端所有读路径都带 status='active'，所以下架后立刻不再展示。
--      想恢复：update public.schools set status='active' where id = '...';
--
-- 【2】按 id 硬删除（会先归档）
--      select public.admin_delete_school('00000000-0000-0000-0000-000000000000', '垃圾数据');
--      select public.admin_delete_college_calendar('00000000-0000-0000-0000-000000000000', '垃圾数据');
--
-- 【3】批量硬删除（SQL Editor 以 postgres 身份运行，绕过 RLS）
--      -- 先把要删的行看一遍，务必确认无误
--      select id, name, province, city, updated_at from public.schools
--       where remark ilike '%加微信%' or name ilike '%测试%';
--
--      -- 归档
--      insert into public.deleted_records (table_name, record_id, payload, reason)
--      select 'schools', id, to_jsonb(s), '批量清理'
--        from public.schools s
--       where remark ilike '%加微信%';
--
--      -- 再删
--      delete from public.schools where remark ilike '%加微信%';
--
-- 【4】还原（从归档表回灌；注意列已变更时需显式列出字段）
--      select payload from public.deleted_records
--       where record_id = '00000000-0000-0000-0000-000000000000';
--
--      insert into public.schools
--      select * from jsonb_populate_record(null::public.schools, (
--        select payload from public.deleted_records
--         where record_id = '00000000-0000-0000-0000-000000000000'
--         order by deleted_at desc limit 1
--      ));
--
-- 【5】查最近删了什么
--      select deleted_at, table_name, record_id, reason, deleted_by,
--             payload->>'name' as name
--        from public.deleted_records
--       order by deleted_at desc limit 50;
--
-- ============================================================================
-- 验证 anon 确实删不掉（在 SQL Editor 里执行，只有 set role 会生效）
-- ============================================================================
--   set role anon;
--   delete from public.schools where true;          -- 期望：permission denied 或 0 行
--   select public.admin_delete_school(gen_random_uuid());  -- 期望：permission denied
--   reset role;
-- ============================================================================
