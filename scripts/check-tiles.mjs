/**
 * 底图镜像连通性自检。
 *
 * 用法： node scripts/check-tiles.mjs
 *
 * 为什么需要它：
 *   需求里最关键也最容易被忽略的一条是「底图必须国内可访问」。
 *   代码写对了不代表镜像真的活着。这个脚本会真实请求一张覆盖中国的瓦片
 *   （z=4, x=12, y=6 —— 大致覆盖华北/华中），确认：
 *     - URL 模板与子域名写法正确（不是 404）
 *     - 返回的确实是图片
 *     - 官方源在国内到底通不通（只作参考，不作为可用方案）
 *
 * 礼貌起见只请求 3~4 张瓦片，不做任何批量抓取。
 * 请注意：本机网络位置不等于你的用户位置。**中国境内的最终结论请在国内网络下重跑一次。**
 */

import {
  SPEED_TEST_CANDIDATES,
  TILE_PROVIDERS,
} from '../src/lib/tileProviders.ts'

/** 覆盖中国大部的一块瓦片（z=4 时北京/华北一带） */
const TILE = { z: 4, x: 12, y: 6 }

function buildUrl(provider, sub) {
  let url = provider.url
  if (provider.requiresKey === 'tianditu') {
    const key = process.env.NEXT_PUBLIC_TIANDITU_KEY
    if (!key) return null
    url = url.replace('{key}', key)
  }
  if (sub !== null) url = url.replace('{s}', sub)
  return url.replace('{z}', TILE.z).replace('{x}', TILE.x).replace('{y}', TILE.y)
}

async function probe(url) {
  const started = Date.now()
  try {
    const res = await fetch(url, {
      // 只取响应头，连图片正文都不需要下载完
      method: 'GET',
      headers: { 'User-Agent': 'zxssxsc-tile-check/0.1 (one-off connectivity check)' },
      signal: AbortSignal.timeout(12_000),
    })
    const type = res.headers.get('content-type') ?? ''
    // 读一点内容确认不是错误页
    const buf = await res.arrayBuffer()
    return {
      ok: res.ok && type.startsWith('image/') && buf.byteLength > 0,
      status: res.status,
      type: type.split(';')[0],
      bytes: buf.byteLength,
      ms: Date.now() - started,
    }
  } catch (err) {
    return { ok: false, status: 0, type: '-', bytes: 0, ms: Date.now() - started, error: err.message }
  }
}

console.log(`\n瓦片连通性自检（z=${TILE.z}, x=${TILE.x}, y=${TILE.y}）\n`)

const results = []

for (const id of [...SPEED_TEST_CANDIDATES, 'osm']) {
  const provider = TILE_PROVIDERS[id]
  // hot 有子域名 abc，各测一个；de/osm 无子域名
  const subs = provider.subdomains ? provider.subdomains.split('') : [null]

  for (const sub of subs) {
    const url = buildUrl(provider, sub)
    if (!url) {
      console.log(`  skip  ${id.padEnd(4)} 缺少 API Key`)
      continue
    }
    const r = await probe(url)
    results.push({ id, url, ...r })
    const tag = r.ok ? 'ok  ' : 'FAIL'
    console.log(
      `  ${tag}  ${id.padEnd(4)} ${String(r.status).padStart(3)}  ${String(r.bytes).padStart(6)}B  ${String(
        r.ms,
      ).padStart(5)}ms  ${url}`,
    )
    if (r.error) console.log(`          ↳ ${r.error}`)
  }
}

console.log('')
const usable = SPEED_TEST_CANDIDATES.filter(
  (id) => results.some((r) => r.id === id && r.ok),
)
const dead = SPEED_TEST_CANDIDATES.filter((id) => !usable.includes(id))
const osmOk = results.filter((r) => r.id === 'osm' && r.ok).length
const osmFail = results.filter((r) => r.id === 'osm' && !r.ok).length

if (usable.length === SPEED_TEST_CANDIDATES.length) {
  console.log(`✅ ${usable.length} 个测速候选镜像全部可用，自动选源成立。`)
} else if (usable.length > 0) {
  console.log(`⚠️  可用镜像 ${usable.length}/${SPEED_TEST_CANDIDATES.length}：${usable.join(', ')}`)
  console.log(`    不可用：${dead.join(', ')} —— 自动测速会自动跳过它们，无需改代码。`)
} else {
  console.log('❌ 所有 OSM 镜像都不可用。自动测速会失败并显示「地图加载失败」兜底。')
  console.log('   建议启用天地图（需申请免费 Key），并把 NEXT_PUBLIC_TILE_PROVIDER 设为 tian。')
}

// 顺便报一下谁最快，这就是自动选源在用户网络下会选中的那个。
// 同一镜像有多个子域时只保留最快的那次，否则排名里会出现三行 osmfr。
const bestPerProvider = new Map()
for (const r of results) {
  if (!r.ok || r.id === 'osm') continue
  const cur = bestPerProvider.get(r.id)
  if (!cur || r.ms < cur.ms) bestPerProvider.set(r.id, r)
}
const ranked = [...bestPerProvider.values()].sort((a, b) => a.ms - b.ms)
if (ranked.length > 1) {
  console.log(
    `\n   耗时排名（决定自动选源）：${ranked.map((r) => `${r.id}:${r.ms}ms`).join(' > ')}`,
  )
}

if (osmOk === 0 && osmFail > 0) {
  console.log('\nℹ️  官方 tile.openstreetmap.org 不可用 —— 这正是它被设为默认禁用、仅作调试的原因。')
}
console.log('')
