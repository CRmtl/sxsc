/**
 * 表单字段可访问性审计：找出没有 id / name 的表单控件。
 *
 * 用法： node scripts/audit-form-fields.mjs
 *
 * 背景：Chrome DevTools 的 Issues 面板会报
 *   "A form field element should have an id or name attribute"
 * 这是浏览器在提醒：该字段在表单提交与自动填充时无法被识别。
 *
 * 为什么用静态扫描而不是只看渲染后的 HTML：
 *   图层面板、时间滑块里的控件是**点击后才渲染**的，SSR HTML 里根本没有。
 *   静态扫描覆盖得到，而且你以后新增字段也能随时重跑。
 *
 * 注意：src/components/ui/ 下的是**基础组件**（Input/Textarea/Select），
 * 它们本来就靠 {…props} 把 id/name 透传出去，自身不该写死。
 * 所以审计时排除该目录，只检查真正的调用点。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = resolve(root, 'src')

/** 这些是透传 props 的基础组件，自身不含 id/name 是正常的 */
const SKIP_DIRS = [join('src', 'components', 'ui')]

const FORM_TAG =
  /<(Input|Textarea|Select|input|select|textarea|Checkbox)\b([\s\S]*?)(\/?)>/g

/**
 * 把注释替换成等长空白，**保留换行**，这样既能避免把注释里写的控件
 * 当成真实代码，又不会打乱行号。
 *
 * 必须做这一步：school-form.tsx 里就有一段解释 Checkbox 行为的注释写了
 * `<input type="checkbox">`，不剥注释会把它报成「缺 id/name 的控件」。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|\n)([^\S\n]*)\/\/[^\n]*/g, (m, lead, indent) =>
      lead + indent + ' '.repeat(Math.max(0, m.length - lead.length - indent.length)),
    )
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx$/.test(name)) out.push(full)
  }
  return out
}

const problems = []
let total = 0
let withId = 0
let withSpread = 0

for (const file of walk(SRC)) {
  const rel = relative(root, file)
  if (SKIP_DIRS.some((d) => rel.startsWith(d))) continue

  const raw = readFileSync(file, 'utf8')
  const src = stripComments(raw)

  for (const m of src.matchAll(FORM_TAG)) {
    const [full, tag, attrs] = m
    // 用剥离后的索引在**原文**上算行号（长度一致，所以行号一致）
    const lineNo = raw.slice(0, m.index).split('\n').length

    total++
    const hasId = /\bid\s*=/.test(attrs)
    const hasName = /\bname\s*=/.test(attrs)
    const hasSpread = /\{\.\.\./.test(attrs)

    if (hasSpread) {
      withSpread++
      continue
    }
    if (hasId || hasName) {
      withId++
      continue
    }

    problems.push({
      file: rel,
      line: lineNo,
      tag,
      snippet: full.replace(/\s+/g, ' ').slice(0, 120),
    })
  }
}

console.log(`\n表单控件审计：共 ${total} 个控件`)
console.log(`  已有 id 或 name      : ${withId}`)
console.log(`  通过 {…props} 透传   : ${withSpread}（基础组件，正常）`)
console.log(`  两者都缺             : ${problems.length}`)

if (problems.length === 0) {
  console.log('\n✅ 没有缺失 id/name 的表单控件')
} else {
  console.log('\n需要修复：')
  for (const p of problems) {
    console.log(`  ${p.file}:${p.line}  <${p.tag}>`)
    console.log(`     ${p.snippet}`)
  }
}

process.exit(problems.length === 0 ? 0 : 1)
