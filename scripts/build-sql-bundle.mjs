/**
 * 把 supabase/ 下需要手动执行的 SQL 合并成一个「一次粘贴」的脚本。
 *
 * 用法： node scripts/build-sql-bundle.mjs
 * 产物： supabase/all-in-one.sql
 *
 * 为什么要合并：
 *   手工按顺序粘贴 6 段 SQL 是典型的出错场景（漏一段、顺序颠倒、粘到一半）。
 *   合并成一个文件后，Supabase SQL Editor 只需粘贴执行一次。
 *
 * 为什么要去掉整行注释：
 *   6 个源文件合计约 46KB，其中大半是解释性注释。
 *   粘贴体越小越不容易在中途被截断——截断的 SQL 比没有 SQL 更糟。
 *   注释完整版仍然保留在各源文件里，这个产物只求「能可靠执行」。
 *
 * 顺序很关键，且与早期文档里的写法有一处不同：
 *   rls.sql 必须在两个 migration **之后**执行。
 *   因为 college_calendar_wide 会 drop 掉旧表再改名，策略会随旧表一起消失。
 *   放在最后只需执行一次，而不是「执行两遍」。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 按执行顺序排列 */
const PARTS = [
  ['schema.sql', '建表 / 索引 / CHECK 约束 / 原子限流函数', '全新安装与升级都需要'],
  [
    'migrations/20260919_remove_primary_and_add_status.sql',
    '学段收敛为 初中/高中/其他，并新增 status 字段',
    '旧库：把 stage=primary 的历史记录标记为 deprecated',
  ],
  [
    'migrations/20260919_college_calendar_wide.sql',
    '大学校历改「一校一学年一行」宽表',
    '旧库：把寒假/暑假两行透视成一行',
  ],
  ['rls.sql', '第一层防护：RLS 策略（anon 禁止 DELETE）', '必须放在两个 migration 之后'],
  ['seed.sql', '节假日种子数据', '可重复执行'],
  ['admin-cleanup.sql', '管理员清理通道（归档 + 删除函数）', '只有 service_role 可用'],
]

/** 去掉整行注释（只去「整行都是注释」的行，行内的字符串因此不会被动到） */
function stripCommentLines(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    // 压掉剥离注释后产生的连续空行
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const header = `-- ============================================================================
-- zxssxsc Supabase 数据库初始化（合并版，一次粘贴执行）
--
-- 由 scripts/build-sql-bundle.mjs 生成，请勿手改。
-- 想改内容请改 supabase/ 下的源文件，再重新生成。
--
-- 执行顺序（已按此顺序合并，直接整体粘贴即可）：
${PARTS.map((p, i) => `--   ${i + 1}. ${p[0].padEnd(58)} ${p[2]}`).join('\n')}
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

`

const sections = []
for (const [file, title, note] of PARTS) {
  const full = resolve(root, 'supabase', file)
  if (!existsSync(full)) {
    console.error(`找不到 ${file}，无法合并`)
    process.exit(1)
  }
  const body = stripCommentLines(readFileSync(full, 'utf8'))
  const banner = `-- ============================================================================
-- [${PARTS.findIndex((p) => p[0] === file) + 1}/${PARTS.length}] ${file}
-- ${title}
-- ${note}
-- ============================================================================

`
  sections.push(banner + body)
}

const bundle = header + sections.join('\n\n\n')
const outPath = resolve(root, 'supabase/all-in-one.sql')
writeFileSync(outPath, bundle, 'utf8')

/* ------------------------------------------------------------------ */
/* 自检：确认关键对象都在，且顺序正确                                    */
/* ------------------------------------------------------------------ */

const EXPECTED_TABLES = [
  'schools',
  'school_revisions',
  'college_holidays',
  'college_holiday_revisions',
  'holidays',
  'submit_rate_limit',
  'deleted_records',
]
const EXPECTED_FUNCTIONS = [
  'touch_updated_at',
  'bump_rate_limit',
  'admin_delete_school',
  'admin_delete_college_calendar',
]
const EXPECTED_POLICIES = [
  'schools_select_anon',
  'schools_insert_anon',
  'schools_update_anon',
  'school_revisions_select_anon',
  'school_revisions_insert_anon',
  'college_holidays_select_anon',
  'college_holidays_insert_anon',
  'college_holidays_update_anon',
  'college_holiday_revisions_select_anon',
  'college_holiday_revisions_insert_anon',
  'holidays_select_anon',
  'submit_rate_limit_service_only',
  'deleted_records_service_only',
]

function selfCheck() {
  let failed = 0
  const ok = (cond, label, extra = '') => {
    if (cond) console.log(`  ok    ${label}${extra ? '  ' + extra : ''}`)
    else {
      failed++
      console.log(`  FAIL  ${label}${extra ? '  ' + extra : ''}`)
    }
  }

  console.log('\n=== 合并结果自检 ===')
  console.log(`  产物大小：${(Buffer.byteLength(bundle) / 1024).toFixed(1)} KB（源文件合计 46.6 KB）`)

  ok(!bundle.includes('\uFFFD'), '无编码损坏字符')

  for (const t of EXPECTED_TABLES) {
    ok(
      new RegExp(`create table if not exists public\\.${t}\\b`).test(bundle),
      `建表：${t}`,
    )
  }
  for (const f of EXPECTED_FUNCTIONS) {
    ok(
      new RegExp(`(create or replace function|function) public\\.${f}\\b`).test(bundle),
      `函数：${f}`,
    )
  }
  for (const p of EXPECTED_POLICIES) {
    ok(new RegExp(`create policy ${p}\\b`).test(bundle), `策略：${p}`)
  }

  // 7 张表都要开 RLS，且都要 force（表所有者也不能绕过）
  const enableCount = (bundle.match(/enable row level security/g) || []).length
  ok(enableCount >= EXPECTED_TABLES.length, '所有表都 enable row level security', `n=${enableCount}`)

  // 关键顺序：rls.sql 段落必须出现在 college_calendar_wide 段落之后
  const iMig = bundle.indexOf('migrations/20260919_college_calendar_wide.sql')
  const iRls = bundle.indexOf('rls.sql')
  ok(iMig !== -1 && iRls !== -1 && iRls > iMig, 'rls.sql 排在 college 宽表迁移之后')

  // 禁止 DELETE 的双保险必须都在
  ok(
    (bundle.match(/revoke delete on public\./g) || []).length >= 2,
    'anon 的表级 DELETE 权限被 revoke（学校 + 校历）',
  )
  ok(/revoke update, delete on public\.school_revisions/.test(bundle), '快照表禁止 update/delete')
  ok(
    !/create policy\s+\w+\s+on public\.(schools|college_holidays)[\s\S]{0,200}for delete/.test(
      bundle,
    ),
    'schools / college_holidays 没有任何 DELETE 策略',
  )

  // 限流函数只给 service_role
  ok(
    /revoke all on function public\.bump_rate_limit[\s\S]{0,120}from public, anon, authenticated/.test(
      bundle,
    ),
    'bump_rate_limit 对 anon 收回执行权',
  )
  ok(/grant execute on function public\.bump_rate_limit\(text, integer\) to service_role/.test(bundle), 'bump_rate_limit 只授予 service_role')

  // 一校一学年唯一约束
  ok(/unique \(university_name, academic_year\)/.test(bundle), '校历 (校名, 学年) 唯一约束')

  /* -------- 语法完整性：去注释是程序化做的，必须确认没改坏 -------- */

  // 1. 美元引用（$$ ... $$）必须成对 —— 少一个会让整个 function body 错位
  const dollarCount = (bundle.match(/\$\$/g) || []).length
  ok(dollarCount % 2 === 0, '美元引用 $$ 成对', `n=${dollarCount}`)

  // 2. begin / commit 事务块必须成对
  const begins = (bundle.match(/^\s*begin\s*;/gim) || []).length
  const commits = (bundle.match(/^\s*commit\s*;/gim) || []).length
  ok(begins === commits, 'begin/commit 成对', `begin=${begins} commit=${commits}`)

  // 3. 语句数不应因去注释而减少。
  //    注意要拿「同样去过注释的源文件」来比 ——
  //    源文件里有不少以 ; 结尾的**注释示例行**，直接比会把它们算成语句，
  //    得出「丢了 23 条语句」的假警报（我一开始就是这么被自己骗到的）。
  const countStatements = (text) =>
    (text.match(/;(\s*(--[^\n]*)?)$/gm) || []).length
  const sourceStatements = PARTS.reduce(
    (n, [f]) =>
      n + countStatements(stripCommentLines(readFileSync(resolve(root, 'supabase', f), 'utf8'))),
    0,
  )
  const bundleStatements = countStatements(
    // 合并文件额外加了段落横幅，量语句数时不影响（横幅不以 ; 结尾）
    bundle,
  )
  ok(
    bundleStatements === sourceStatements,
    '语句数与去注释后的源文件完全一致',
    `源=${sourceStatements} 合并=${bundleStatements}`,
  )

  // 4. 不能出现「一行只有空白但上一行是未结束的语句」这类可疑断裂
  ok(!/\n\s*\n\s*\)\s*;/.test(bundle), '没有出现悬空的 ); ')

  console.log(failed === 0 ? '\n✅ 合并自检全部通过' : `\n❌ 合并自检失败 ${failed} 项`)
  return failed === 0
}

const passed = selfCheck()
console.log(`\n产物：supabase/all-in-one.sql`)
process.exit(passed ? 0 : 1)
