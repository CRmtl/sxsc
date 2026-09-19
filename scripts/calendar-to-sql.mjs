/**
 * 大学校历 JSON → Supabase 导入 SQL / CSV。
 *
 * 用法：
 *   node scripts/calendar-to-sql.mjs                          # 读默认输入，写默认输出
 *   node scripts/calendar-to-sql.mjs data/xxx.json
 *   node scripts/calendar-to-sql.mjs --self-check             # 只跑自检
 *
 * 输入格式见 data/college-calendars.example.json。
 *
 * 这个脚本存在的理由：抓取 → JSON 是**每次都要人（或模型）介入**的一步，
 * 但 JSON → SQL/CSV 是纯机械转换，应该一次写好、永远复用。
 * 于是「再追加一所学校」只需要产出 JSON，剩下的不用再操心。
 *
 * 校验**直接复用应用自己的 validateCollegeHoliday**，
 * 而不是在这里再抄一遍规则 —— 否则前端能过、导入脚本也能过，
 * 但两者口径迟早会分叉。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateCollegeHoliday, daysInclusive } from '../src/lib/validation.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/* ------------------------------------------------------------------ */
/* SQL / CSV 转义                                                      */
/* ------------------------------------------------------------------ */

/** 字符串字面量：单引号翻倍。这是这个脚本唯一的安全关键点。 */
export function sqlStr(v) {
  if (v === null || v === undefined || v === '') return 'null'
  return `'${String(v).replace(/'/g, "''")}'`
}

/** 日期字面量，显式 ::date 以免依赖隐式转换 */
export function sqlDate(v) {
  return v ? `'${v}'::date` : 'null'
}

/** CSV 字段：含逗号/引号/换行时用双引号包裹，内部引号翻倍（RFC 4180） */
export function csvField(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const COLUMNS = [
  'university_name',
  'province',
  'city',
  'lat',
  'lng',
  'academic_year',
  'winter_start',
  'winter_end',
  'summer_start',
  'summer_end',
  'source_url',
  'note',
]

/* ------------------------------------------------------------------ */
/* 转换                                                                */
/* ------------------------------------------------------------------ */

function buildSql(rows) {
  const values = rows
    .map((r) => {
      const v = r.value
      return `  (${[
        sqlStr(v.university_name),
        sqlStr(v.province),
        sqlStr(v.city),
        v.lat,
        v.lng,
        sqlStr(v.academic_year),
        sqlDate(v.winter_start),
        sqlDate(v.winter_end),
        sqlDate(v.summer_start),
        sqlDate(v.summer_end),
        sqlStr(v.source_url),
        sqlStr(v.note),
      ].join(', ')})`
    })
    .join(',\n')

  const header = `-- 由 scripts/calendar-to-sql.mjs 自动生成，请勿手改。
-- 共 ${rows.length} 条校历记录。
-- 依赖 college_holidays 上的唯一约束 (university_name, academic_year)，
-- 因此重复执行本文件是**幂等**的：已存在的学校会被更新而不是插入第二行。
--
-- 天数速览：
${rows
  .map((r) => {
    const v = r.value
    const parts = []
    if (v.winter_start) parts.push(`寒假 ${daysInclusive(v.winter_start, v.winter_end)} 天`)
    if (v.summer_start) parts.push(`暑假 ${daysInclusive(v.summer_start, v.summer_end)} 天`)
    return `--   ${v.university_name} ${v.academic_year}：${parts.join('，')}`
  })
  .join('\n')}

insert into public.college_holidays (
  university_name, province, city, lat, lng, academic_year,
  winter_start, winter_end, summer_start, summer_end,
  source_url, note, version, created_at, updated_at
) values
${values}
on conflict (university_name, academic_year) do update set
  province     = excluded.province,
  city         = excluded.city,
  lat          = excluded.lat,
  lng          = excluded.lng,
  winter_start = excluded.winter_start,
  winter_end   = excluded.winter_end,
  summer_start = excluded.summer_start,
  summer_end   = excluded.summer_end,
  source_url   = excluded.source_url,
  note         = excluded.note,
  version      = public.college_holidays.version + 1,
  updated_at   = now();

-- 核对：
--   select university_name, academic_year, winter_start, winter_end,
--          summer_start, summer_end, version
--     from public.college_holidays order by university_name, academic_year;
`

  return header
}

function buildCsv(rows) {
  const lines = [COLUMNS.join(',')]
  for (const r of rows) {
    const v = r.value
    lines.push(
      [
        v.university_name,
        v.province,
        v.city,
        v.lat,
        v.lng,
        v.academic_year,
        v.winter_start,
        v.winter_end,
        v.summer_start,
        v.summer_end,
        v.source_url,
        v.note,
      ]
        .map(csvField)
        .join(','),
    )
  }
  return lines.join('\n') + '\n'
}

/**
 * 校验并整理输入。
 * @returns {{ rows: Array, errors: string[] }}
 */
export function prepare(input) {
  const list = Array.isArray(input) ? input : (input?.calendars ?? [])
  const rows = []
  const errors = []

  if (!Array.isArray(list) || list.length === 0) {
    return { rows, errors: ['输入里没有 calendars 数组，或数组为空'] }
  }

  const seen = new Set()
  list.forEach((raw, i) => {
    const result = validateCollegeHoliday(raw)
    if (!result.ok) {
      errors.push(`第 ${i + 1} 条（${raw?.university_name ?? '未命名'}）：${result.error}`)
      return
    }
    const v = result.value
    const key = `${v.university_name}||${v.academic_year}`
    if (seen.has(key)) {
      errors.push(`第 ${i + 1} 条：${v.university_name} ${v.academic_year} 在同一份输入里重复`)
      return
    }
    seen.add(key)
    rows.push({ value: v, days: { winter: null, summer: null } })
  })

  return { rows, errors }
}

/* ------------------------------------------------------------------ */
/* 自检                                                                */
/* ------------------------------------------------------------------ */

function selfCheck() {
  let failed = 0
  const ok = (cond, label, extra = '') => {
    if (cond) {
      console.log(`  ok    ${label}${extra ? '  ' + extra : ''}`)
    } else {
      failed++
      console.log(`  FAIL  ${label}${extra ? '  ' + extra : ''}`)
    }
  }

  console.log('\n=== SQL / CSV 转义 ===')
  ok(sqlStr("O'Brien中学") === "'O''Brien中学'", '单引号被翻倍（防注入）', sqlStr("a'b"))
  ok(sqlStr("x'); drop table schools; --") === "'x''); drop table schools; --'", '注入尝试被转义')
  ok(sqlStr(null) === 'null' && sqlStr('') === 'null', '空值输出 null')
  ok(sqlDate('2026-01-19') === "'2026-01-19'::date", '日期带 ::date')
  ok(sqlDate(null) === 'null', '空日期输出 null')
  ok(csvField('a,b') === '"a,b"', 'CSV 含逗号时加引号')
  ok(csvField('he said "hi"') === '"he said ""hi"""', 'CSV 引号翻倍')
  ok(csvField(null) === '', 'CSV 空值')

  console.log('\n=== 业务校验（复用应用的 validateCollegeHoliday） ===')
  const good = {
    university_name: '测试大学',
    province: '四川省',
    city: '成都市',
    lat: 30.95,
    lng: 103.97,
    academic_year: '2025-2026',
    winter_start: '2026-01-19',
    winter_end: '2026-02-27',
    summer_start: '2026-07-13',
    summer_end: '2026-08-30',
    source_url: 'https://example.edu.cn/calendar',
    note: null,
  }
  ok(validateCollegeHoliday(good).ok, '合法记录通过')

  const badCases = [
    ['学年格式错误', { ...good, academic_year: '2025' }],
    ['只填了寒假开始', { ...good, winter_end: null }],
    ['寒假结束早于开始', { ...good, winter_start: '2026-03-01', winter_end: '2026-02-01' }],
    ['两个假期都空', { ...good, winter_start: null, winter_end: null, summer_start: null, summer_end: null }],
    ['纬度不在中国', { ...good, lat: 51.5, lng: -0.1 }],
    ['来源不是 URL', { ...good, source_url: '教务处网站' }],
    ['大学名带尖括号', { ...good, university_name: '<script>x</script>' }],
  ]
  for (const [label, payload] of badCases) {
    ok(!validateCollegeHoliday(payload).ok, `拒绝：${label}`)
  }

  console.log('\n=== 天数计算 ===')
  ok(daysInclusive('2026-01-19', '2026-02-27') === 40, '含首尾 40 天', String(daysInclusive('2026-01-19', '2026-02-27')))

  console.log('\n=== 同批重复检测 ===')
  const dup = prepare({ calendars: [good, { ...good }] })
  ok(dup.errors.some((e) => e.includes('重复')), '同一份输入里的重复条目被拦下')

  console.log(failed === 0 ? '\n✅ 自检全部通过' : `\n❌ 自检失败 ${failed} 项`)
  return failed === 0
}

/* ------------------------------------------------------------------ */

const args = process.argv.slice(2)

if (args.includes('--self-check')) {
  process.exit(selfCheck() ? 0 : 1)
}

const inputPath = resolve(root, args.find((a) => !a.startsWith('--')) ?? 'data/college-calendars.json')
const outSqlPath = resolve(root, 'supabase/college-holidays-import.sql')
const outCsvPath = resolve(root, 'data/college-holidays.csv')

let input
try {
  input = JSON.parse(readFileSync(inputPath, 'utf8'))
} catch (err) {
  console.error(`读取失败：${inputPath}`)
  console.error(`  ${err.message}`)
  console.error('\n提示：先复制 data/college-calendars.example.json 为 data/college-calendars.json 再改。')
  process.exit(1)
}

const { rows, errors } = prepare(input)

if (errors.length > 0) {
  console.error(`\n❌ 有 ${errors.length} 条数据没通过校验，未生成任何文件：`)
  for (const e of errors) console.error('   - ' + e)
  process.exit(1)
}

mkdirSync(dirname(outSqlPath), { recursive: true })
mkdirSync(dirname(outCsvPath), { recursive: true })
writeFileSync(outSqlPath, buildSql(rows), 'utf8')
writeFileSync(outCsvPath, buildCsv(rows), 'utf8')

// 回读校验：确认真的按 UTF-8 落盘了。
// 中文在 Windows 上极易被按 GBK 写出去，生成时看着「成功」，
// 到 Supabase 里才变成乱码 —— 所以写完必须验一遍。
{
  const problems = []
  for (const [label, path] of [
    ['SQL', outSqlPath],
    ['CSV', outCsvPath],
  ]) {
    const buf = readFileSync(path)
    const txt = buf.toString('utf8')
    if (!Buffer.from(txt, 'utf8').equals(buf)) problems.push(`${label} 不是合法 UTF-8：${path}`)
    if (txt.includes('\uFFFD')) problems.push(`${label} 含替换字符（编码已损坏）：${path}`)
  }
  const csvLines = readFileSync(outCsvPath, 'utf8').trim().split('\n')
  if (csvLines.length !== rows.length + 1) {
    problems.push(`CSV 行数不对：期望 ${rows.length + 1}（含表头），实际 ${csvLines.length}`)
  }
  const headerCols = csvLines[0].split(',').length
  if (headerCols !== COLUMNS.length) {
    problems.push(`CSV 表头列数不对：期望 ${COLUMNS.length}，实际 ${headerCols}`)
  }
  if (!readFileSync(outSqlPath, 'utf8').includes('on conflict (university_name, academic_year)')) {
    problems.push('SQL 缺少 on conflict 子句，重复导入会报唯一约束冲突')
  }

  if (problems.length > 0) {
    console.error('\n❌ 生成结果自检未通过：')
    for (const p of problems) console.error('   - ' + p)
    process.exit(1)
  }
}

console.log(`✅ 已生成 ${rows.length} 条校历记录（UTF-8 与列数已回读校验）`)
console.log(`   SQL: ${outSqlPath.replace(root + '\\', '').replace(root + '/', '')}`)
console.log(`   CSV: ${outCsvPath.replace(root + '\\', '').replace(root + '/', '')}`)
console.log('\n   下一步：把 SQL 内容粘进 Supabase SQL Editor 执行（可重复执行，幂等）。')
console.log(`   输入文件：${basename(inputPath)}`)
