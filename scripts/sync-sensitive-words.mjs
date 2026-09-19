/**
 * 把 data/sensitive-words.json（唯一可编辑的权威词表）同步一份到
 * supabase/functions/submit-guard/ 下，供 Deno Edge Function 打包使用。
 *
 * Supabase Edge Function 只能打包自己目录内的文件，无法向上引用仓库里的 JSON，
 * 所以需要这个同步步骤 —— 目的是保持**单一数据源**，避免两处词表各改各的。
 *
 * 用法：npm run sync:words
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root, 'data/sensitive-words.json')
const destDir = resolve(root, 'supabase/functions/submit-guard')
const dest = resolve(destDir, 'sensitive-words.json')

const raw = readFileSync(src, 'utf8')
// 校验一下确实是合法 JSON，避免把坏文件同步过去
const parsed = JSON.parse(raw)
if (!Array.isArray(parsed?.categories)) {
  console.error('data/sensitive-words.json 结构异常：缺少 categories 数组')
  process.exit(1)
}
const totalWords = parsed.categories.reduce((n, c) => n + (c.words?.length ?? 0), 0)

mkdirSync(destDir, { recursive: true })

const banner = {
  $comment:
    '⚠️ 本文件由 scripts/sync-sensitive-words.mjs 自动生成，请勿直接编辑。' +
    '要增删词条请改 data/sensitive-words.json，然后执行 npm run sync:words。',
  ...parsed,
}

writeFileSync(dest, JSON.stringify(banner, null, 2), 'utf8')
console.log(`✅ 已同步敏感词表 -> ${dest}`)
console.log(`   ${parsed.categories.length} 个分类，共 ${totalWords} 个词条`)
