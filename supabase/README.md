# Supabase 接入指南

按顺序执行下面三步即可从 **演示模式** 切到 **真实数据库**。不需要改任何页面代码 ——
`src/lib/data-source.ts` 会在检测到环境变量后自动切换实现。

## 文件清单与执行顺序

| 顺序 | 文件 | 作用 | 幂等 |
| --- | --- | --- | --- |
| 1 | `schema.sql` | 建表、索引、CHECK 约束、原子限流函数 | ✅ |
| 2 | `rls.sql` | 第一层防护：RLS 策略（anon 禁 DELETE） | ✅ |
| 3 | `seed.sql` | 节假日种子数据（可选） | ✅ |
| 4 | `migrations/20260919_remove_primary_and_add_status.sql` | 学段收敛为 初中/高中/其他 + `status` 字段 | ✅ |
| 5 | `migrations/20260919_college_calendar_wide.sql` | 校历改「一校一学年一行」宽表 | ✅ |
| 6 | `admin-cleanup.sql` | 管理员清理通道（归档 + 删除函数） | ✅ |

> **全新安装**：只跑 1 → 2 → 3 → 6 即可（第 4、5 步会检测到没有旧结构并跳过）。
> **已在用旧版**：跑完整的 1 → 2 → 4 → 5 → 2（**rls.sql 必须重跑一遍**：
> 第 5 步换了表，旧策略会随旧表一起消失）。

---

## 0. 为什么这样设计

`data-source.ts` 定义一个 `Store` 接口，有两份实现：

| 实现 | 触发条件 | 行为 |
| --- | --- | --- |
| `mockStore` | 未配置 `SUPABASE_URL` | 使用 `src/lib/mock-data.ts`，提交写入**进程内内存** |
| `supabaseStore` | 已配置 | 真实读写 Postgres |

这带来两个好处：

1. **开箱即跑**：clone 下来 `npm run dev` 就能看到完整功能，包括新增/修改/回滚。
2. **切换零成本**：接入数据库时页面、组件、API 路由一行都不用改。

另外，**浏览器不直接持有 Supabase 凭据**。所有读写都经过服务端 `/api/*` 路由，
服务端用的是 anon key，所以 **RLS 依然生效**，同时三层反滥用无法被绕过。

---

## 1. 建表

Supabase Dashboard → SQL Editor → 新建查询，粘贴并执行：

```
supabase/schema.sql
```

它会创建 5 张表（`schools` / `school_revisions` / `college_holidays` / `holidays` /
`submit_rate_limit`）、索引、`updated_at` 触发器，以及原子限流函数 `bump_rate_limit`。

> 也可以在本地用 Supabase CLI：`supabase db push`

## 2. 启用 RLS

再执行：

```
supabase/rls.sql
```

这一步是**三层防护的第一层**：

- `anon` 角色：允许 `SELECT` / `INSERT` / `UPDATE`
- `DELETE`：**不创建任何策略**（RLS 是白名单，无策略即拒绝），并额外 `REVOKE DELETE` 做双重保险
- 策略里的 `WITH CHECK` 复刻了列级 `CHECK` 约束，
  保证「绕过 API 直接打 PostgREST」也写不进脏数据
- `school_revisions` 额外禁止 `UPDATE`/`DELETE` —— 快照只增不改，否则就失去审计意义

### 验证 RLS 真的生效

在 SQL Editor 里执行：

```sql
set role anon;
delete from public.schools where true;   -- 期望：permission denied 或影响 0 行
reset role;
```

## 3. 灌入节假日（可选）

```
supabase/seed.sql
```

只写入节假日。**故意不灌示例学校** —— 演示数据只应存在于 `src/lib/mock-data.ts`，
真实数据应由访客提交或由你导入可信来源。

## 4. 配置环境变量

复制 `.env.example` 为 `.env.local`，填入：

```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
# 可选，但推荐：用于写版本快照 + 跨实例严格限流（绕过 RLS）
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

改完重启 `npm run dev`。顶栏的「演示数据」徽标会变成「已连接」。

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` **绝不能**加 `NEXT_PUBLIC_` 前缀。
> 它绕过 RLS，只应在服务端使用。

---

## 5. 可选加固：Edge Function 严格限流

主写入路径 `/api/schools` 已经实现了三层防护，但它有一个 Serverless 固有的弱点：

> Vercel 是多实例的，进程内的 IP 计数器各算各的，
> 所以「同一 IP 每小时 3 次」在极端情况下会被放大到 `3 × 实例数`。

`supabase/functions/submit-guard/index.ts` 用数据库里的原子计数器
（`bump_rate_limit()`，`INSERT ... ON CONFLICT DO UPDATE` 单语句完成读-判-增，
并发安全）来做**跨实例**的严格限流。

部署：

```bash
# 先把权威词表同步进函数目录（保持单一数据源）
npm run sync:words

supabase functions deploy submit-guard --no-verify-jwt
```

然后把前端的提交地址从 `/api/schools` 换成
`https://<project-ref>.functions.supabase.co/submit-guard` 即可。

环境变量由 Supabase 自动注入 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`；
`SUBMIT_RATE_LIMIT_PER_HOUR`、`SUBMIT_MIN_FILL_MS` 可选。

> 词表是**单一数据源**：永远只编辑 `data/sensitive-words.json`，
> 然后跑 `npm run sync:words`。函数目录里的那份是自动生成的，不要手改。

---

## 6. 版本快照写在 API 层，而不是数据库触发器

当前实现里，「修改前先存快照 + version+1」由 `src/lib/data-source.ts` 完成
（`scripts/smoke-test.mjs` 已覆盖「新增 → 修改 → 快照 → 回滚」全链路，
**学校与大学校历两条链路都测了**）。

- **好处**：逻辑集中，容易改；mock 模式和真实模式行为一致。
- **代价**：如果有人绕过 API 直接 `UPDATE`，不会留下快照。

如果你要求「无论如何都留痕」，`schema.sql` 末尾提供了触发器版本（已注释）。
**注意必须同时做两件事**，否则会产生重复快照：

1. 取消 `schema.sql` 末尾触发器的注释；
2. 删掉 `data-source.ts` 里对 `school_revisions` / `college_holiday_revisions` 的 `insert`。

---

## 7. 管理员清理通道（删除）

按需求，anon 对 `schools` / `college_holidays` **完全禁止 DELETE** ——
RLS 里没有任何 DELETE 策略，并且额外 `REVOKE` 了表级 DELETE 权限。
这是对的：匿名数据集最怕被人一键清空。

那垃圾数据怎么清？执行一次：

```
supabase/admin-cleanup.sql
```

它提供：

| 能力 | 说明 |
| --- | --- |
| `deleted_records` 归档表 | 删除前先整行归档，事后可还原；只有 `service_role` 能访问 |
| `admin_delete_school(uuid, text)` | 删一所学校，先归档；`REVOKE` 掉 anon / authenticated 的 EXECUTE |
| `admin_delete_college_calendar(uuid, text)` | 删一条大学校历，同上 |
| 软删除替代 | `schools.status='deprecated'` 只下架不销毁，**优先用它** |

直接用 SQL 也行 —— SQL Editor 以 postgres 身份运行，本来就绕过 RLS。
文件末尾给了五类日常语句：软删除、按 id 硬删、批量清理、从归档还原、审计查询。

**建议先用软删除**：它可逆、零风险，而且前端所有读路径都带 `status='active'`，
下架后立刻不再展示。

---

## 8. 常见问题

**Q：执行 `rls.sql` 报 `must be owner of table`？**
A：用 Supabase Dashboard 的 SQL Editor（它以 postgres 身份执行）。
用普通 anon key 连的客户端没有权限改策略。

**Q：`college_holidays` 插入报 `college_holidays_days_match` 约束失败？**
A：`days` 必须等于 `(end_date - start_date) + 1`。这是有意为之的约束，
防止出现 `days` 与日期区间互相矛盾的记录。应用的 `daysInclusive()` 已按此计算。

**Q：为什么 `schools.lat` 有 `between 3.0 and 54.0` 这种奇怪的约束？**
A：这是把「必须在中国境内」变成**数据库层不可绕过**的约束。
与 `src/lib/geo.ts` 的 `CHINA_BBOX` 保持一致；若你要支持境外学校，需同时改两处。
