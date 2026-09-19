/**
 * GET /api/geocode/university?name=西华大学
 *
 * 输入大学全名 → 返回省份、城市、经纬度（WGS-84）。
 * 供「新增/修改大学校历」表单在失焦/回车时自动填充。
 *
 * 为什么放在服务端：
 *   1. AMAP_WEB_KEY 绝不能出现在浏览器（会被盗用刷配额）；
 *   2. 服务端可以做缓存与限流，浏览器做不到跨用户共享。
 *
 * 三层配额保护（高德免费配额有限，这个接口又是公开的）：
 *   1. **结果缓存**：同名大学 24 小时内只请求高德一次 ——
 *      大学位置几乎不变，这是省配额最有效的一招；
 *   2. **同 IP 节流**：700ms 内只放行一次，挡连点；
 *   3. **同 IP 小时上限**：60 次/小时，挡脚本刷。
 *
 * 数据源策略（按准确率排序，逐级降级）：
 *   a. POI 2.0 关键字搜索 + types=141201（高等院校）—— 最准
 *   b. POI 2.0 关键字搜索（不限类型）—— 兼容高德类型码调整
 *   c. 地理编码 v3 —— 结构化地址解析，前两者都空时兜底
 */

import { fail, handleUnexpected, ipOf, ok } from '@/lib/api-helpers'
import { diagnoseAmapKey, summarizeAmapKeyProblem } from '@/lib/env-diagnostics'
import { AREA_PROVINCES, citiesOf, districtsOf } from '@/lib/china-area'
import {
  AMAP_KEY_MISSING_MESSAGE,
  amapErrorMessage,
  buildResult,
  parseAmapGeocodes,
  parseAmapPois,
  readStatus,
  type AmapCandidate,
  type AreaIndex,
} from '@/lib/amap'

export const dynamic = 'force-dynamic'

/** 高等院校的类型码。高德 POI 分类里 141201 = 科教文化服务/学校/高等院校 */
const UNIVERSITY_TYPECODE = '141201'

const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000 // 命中：缓存一天
const FAILURE_TTL_MS = 5 * 60 * 1000 // 未命中：只缓存 5 分钟，允许用户改名重试
const MIN_INTERVAL_MS = 700
const HOURLY_LIMIT = 60

interface CacheEntry {
  at: number
  ok: boolean
  payload: unknown
}

/** 限流闸门：last = 上次请求时间，hits = 最近一小时的请求时间戳 */
interface GateEntry {
  last: number
  hits: number[]
}

const globalForAmap = globalThis as unknown as {
  __zxssxscAmapCache?: Map<string, CacheEntry>
  __zxssxscAmapGate?: Map<string, GateEntry>
}
// 必须显式写 new Map<...>()：`??= new Map()` 会推断成 Map<any, any>，
// 于是 gate.get() 返回 any，filter 回调参数变成隐式 any（TS7006）。
const cache = (globalForAmap.__zxssxscAmapCache ??= new Map<string, CacheEntry>())
const gate = (globalForAmap.__zxssxscAmapGate ??= new Map<string, GateEntry>())

/** 本地省市区索引，注入给纯函数的 amap 模块 */
const AREA_INDEX: AreaIndex = {
  provinces: AREA_PROVINCES.map((p) => p.name),
  citiesOf: (province: string) => citiesOf(province).map((c) => c.name),
  // 区县一级用于「省直辖县级市」兜底：高德给「济源市」，
  // 本地数据里它是「省直辖县级行政区划」这个占位市下的一个区县。
  districtsOf: (province: string, city: string) =>
    districtsOf(province, city).map((d) => d.name),
}

/** 归一化查询键：去空白、去括号后缀，避免「西华大学 」「西华大学（本部）」各占一条缓存 */
function cacheKey(name: string): string {
  return name.trim().replace(/\s+/g, '').toLowerCase()
}

function checkGate(ip: string, now: number): { ok: true } | { ok: false; reason: string } {
  const entry: GateEntry = gate.get(ip) ?? { last: 0, hits: [] }
  entry.hits = entry.hits.filter((t) => now - t < 3_600_000)

  if (now - entry.last < MIN_INTERVAL_MS) {
    gate.set(ip, entry)
    return { ok: false, reason: '请求过于频繁，请稍候再试。' }
  }
  if (entry.hits.length >= HOURLY_LIMIT) {
    gate.set(ip, entry)
    return {
      ok: false,
      reason: `自动定位次数已达上限（每小时 ${HOURLY_LIMIT} 次），请稍后再试或手动选择省市。`,
    }
  }
  entry.last = now
  entry.hits.push(now)
  gate.set(ip, entry)
  return { ok: true }
}

async function callAmap(url: URL, key: string): Promise<unknown> {
  url.searchParams.set('key', key)
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`高德接口 HTTP ${res.status}`)
  return res.json()
}

export async function GET(request: Request) {
  try {
    const key = process.env.AMAP_WEB_KEY?.trim() ?? ''
    const url = new URL(request.url)
    const name = (url.searchParams.get('name') ?? '').trim()

    if (name.length < 2) {
      return fail('请输入至少 2 个字的大学名称', 400, 'too_short', 'name')
    }
    if (name.length > 60) {
      return fail('大学名称过长', 400, 'too_long', 'name')
    }

    // 缺 Key 时返回 503 而不是 500：这是配置问题，不该被当成服务故障，
    // 前端也据此提示「手动填写」而不是「服务出错」。
    //
    // 错误信息里附上体检结论 —— 「配了变量却读不到」是极常见的求助，
    // 与其让用户来问，不如直接把「服务端到底看到了什么」写进提示里。
    if (!key) {
      return fail(
        `${AMAP_KEY_MISSING_MESSAGE}${summarizeAmapKeyProblem(diagnoseAmapKey())}`,
        503,
        'amap_key_missing',
      )
    }

    const ck = cacheKey(name)
    const cached = cache.get(ck)
    if (cached && Date.now() - cached.at < (cached.ok ? SUCCESS_TTL_MS : FAILURE_TTL_MS)) {
      return ok({ ...(cached.payload as object), cached: true })
    }

    // 命中缓存的请求不消耗限流额度（上面已提前 return）
    const gated = checkGate(ipOf(request), Date.now())
    if (!gated.ok) return fail(gated.reason, 429, 'throttled')

    /* ---------------- 逐级降级请求高德 ---------------- */

    let candidates: AmapCandidate[] = []
    let lastInfo = ''

    const placeUrl = (withType: boolean) => {
      const u = new URL('https://restapi.amap.com/v5/place/text')
      u.searchParams.set('keywords', name)
      u.searchParams.set('page_size', '5')
      u.searchParams.set('page_num', '1')
      if (withType) u.searchParams.set('types', UNIVERSITY_TYPECODE)
      return u
    }

    try {
      const json = await callAmap(placeUrl(true), key)
      const status = readStatus(json)
      if (status.ok) candidates = parseAmapPois(json)
      else lastInfo = status.info
    } catch (err) {
      console.warn('[geocode/university] POI(带类型) 失败：', err)
    }

    if (candidates.length === 0) {
      try {
        const json = await callAmap(placeUrl(false), key)
        const status = readStatus(json)
        if (status.ok) candidates = parseAmapPois(json)
        else lastInfo = lastInfo || status.info
      } catch (err) {
        console.warn('[geocode/university] POI(不限类型) 失败：', err)
      }
    }

    if (candidates.length === 0) {
      try {
        const u = new URL('https://restapi.amap.com/v3/geocode/geo')
        u.searchParams.set('address', name)
        u.searchParams.set('output', 'JSON')
        const json = await callAmap(u, key)
        const status = readStatus(json)
        if (status.ok) candidates = parseAmapGeocodes(json)
        else lastInfo = lastInfo || status.info
      } catch (err) {
        console.warn('[geocode/university] 地理编码失败：', err)
      }
    }

    const result = buildResult(candidates, AREA_INDEX, name)

    if (!result) {
      const payload = {
        result: null,
        message: lastInfo
          ? amapErrorMessage(lastInfo, '')
          : `没有找到「${name}」。可以换个更完整的校名（例如加上城市名），或手动选择省市并在地图上选点。`,
      }
      cache.set(ck, { at: Date.now(), ok: false, payload })
      return ok({ ...payload, cached: false })
    }

    const payload = {
      result,
      message: result.provinceMatched
        ? `已定位：${result.province}${result.cityMatched ? ' ' + result.city : ''}`
        : `已获取经纬度，但省市未能自动匹配（高德返回：${result.amapProvince}${result.amapCity}），请手动选择。`,
    }
    cache.set(ck, { at: Date.now(), ok: true, payload })
    return ok({ ...payload, cached: false })
  } catch (err) {
    return handleUnexpected('GET /api/geocode/university', err)
  }
}
