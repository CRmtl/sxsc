/**
 * 三层匿名数据防护中的「第二层（敏感词）」与「第三层（防滥用）」。
 *
 * 设计原则：
 * - 本文件是**同构**的（前端可用于即时提示，服务端是唯一权威）。
 * - 所有检查都返回结构化原因，前端可给出友好中文提示。
 * - 不依赖任何外部服务，纯本地判断。
 */

import sensitiveWordsConfig from '../../data/sensitive-words.json'

/* ================================================================== */
/* 配置                                                                */
/* ================================================================== */

export interface AntiAbuseConfig {
  /** 表单加载到提交的最短间隔（毫秒） */
  minFillMs: number
  /** 同一 IP 每小时最多提交次数 */
  rateLimitPerHour: number
  /** 是否整体关闭（仅本地调试） */
  disabled: boolean
}

export function getAntiAbuseConfig(): AntiAbuseConfig {
  const minFillMs = Number(process.env.SUBMIT_MIN_FILL_MS ?? 3000)
  const rateLimitPerHour = Number(process.env.SUBMIT_RATE_LIMIT_PER_HOUR ?? 3)
  const disabled = process.env.DISABLE_ANTI_ABUSE === '1'
  return {
    minFillMs: Number.isFinite(minFillMs) && minFillMs >= 0 ? minFillMs : 3000,
    rateLimitPerHour:
      Number.isFinite(rateLimitPerHour) && rateLimitPerHour > 0 ? rateLimitPerHour : 3,
    disabled,
  }
}

/** 蜜罐字段名：真实用户看不到，只有脚本会填 */
export const HONEYPOT_FIELD = 'website'

/* ================================================================== */
/* 第二层：敏感词过滤                                                  */
/* ================================================================== */

export interface SensitiveWordCategory {
  id: string
  label: string
  words: string[]
}

interface SensitiveWordsFile {
  categories: SensitiveWordCategory[]
}

const CATEGORIES: SensitiveWordCategory[] =
  (sensitiveWordsConfig as SensitiveWordsFile).categories ?? []

/** 全角 ASCII -> 半角，全角空格 -> 普通空格 */
function toHalfWidth(input: string): string {
  return input
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
}

/** 基础归一化：半角化、转小写、去零宽字符、压缩空白 */
function normalizeText(input: string): string {
  return toHalfWidth(input)
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, '')
}

/** 用于识别“含标点的特征词”，注意不要加 /g（避免 lastIndex 状态污染） */
const HAS_PUNCT = /[.*·•\-_~^|/\\+]/

/** 剥掉常用于规避的插入符号 */
function stripPunct(input: string): string {
  return input.replace(/[.*·•\-_~^|/\\+]/g, '')
}

export interface SensitiveHit {
  word: string
  categoryId: string
  categoryLabel: string
}

/**
 * 在文本中查找命中的敏感词。
 *
 * 采用**双通道**匹配，兼顾两类互相冲突的需求：
 * - 纯中文词（如「加微信」）：走「已剥离标点」的通道，
 *   这样 `加*微*信`、`加 微 信` 这类规避写法也能命中。
 * - 含 ASCII 标点的广告特征（如 `.com`、`http://`）：走「保留原标点」的通道，
 *   否则剥标点会把 `.com` 变成裸 `com`，造成大面积误伤。
 */
export function findSensitiveWords(text: string | null | undefined): SensitiveHit[] {
  if (!text) return []
  const raw = normalizeText(text)
  if (!raw) return []
  const stripped = stripPunct(raw)

  const hits: SensitiveHit[] = []
  const seen = new Set<string>()

  for (const category of CATEGORIES) {
    for (const word of category.words) {
      const needle = normalizeText(word)
      if (!needle) continue
      const target = HAS_PUNCT.test(needle) ? raw : stripped
      const key = HAS_PUNCT.test(needle) ? needle : stripPunct(needle)
      if (!key) continue
      if (target.includes(key) && !seen.has(word)) {
        seen.add(word)
        hits.push({ word, categoryId: category.id, categoryLabel: category.label })
      }
    }
  }
  return hits
}

/** 对所有需要检查的文本字段做统一扫描 */
export function scanFields(
  fields: Record<string, string | null | undefined>,
): { field: string; hit: SensitiveHit }[] {
  const out: { field: string; hit: SensitiveHit }[] = []
  for (const [field, value] of Object.entries(fields)) {
    for (const hit of findSensitiveWords(value)) {
      out.push({ field, hit })
    }
  }
  return out
}

/** 可编辑词表的只读视图（供 UI 展示） */
export function listSensitiveCategories(): SensitiveWordCategory[] {
  return CATEGORIES.map((c) => ({ ...c, words: [...c.words] }))
}

/* ================================================================== */
/* 第三层 A：蜜罐                                                      */
/* ================================================================== */

export function checkHoneypot(value: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof value === 'string' && value.trim() !== '') {
    return { ok: false, reason: '提交被拒绝：检测到自动化填写痕迹。' }
  }
  return { ok: true }
}

/* ================================================================== */
/* 第三层 B：时间陷阱                                                  */
/* ================================================================== */

export function checkTimeTrap(
  formLoadedAt: unknown,
  now: number = Date.now(),
): { ok: true; elapsedMs: number } | { ok: false; reason: string } {
  const cfg = getAntiAbuseConfig()
  if (cfg.disabled) return { ok: true, elapsedMs: cfg.minFillMs }

  const loadedAt = typeof formLoadedAt === 'number' ? formLoadedAt : Number(formLoadedAt)
  if (!Number.isFinite(loadedAt) || loadedAt <= 0) {
    return { ok: false, reason: '提交被拒绝：缺少表单载入时间戳，请刷新页面后重试。' }
  }
  const elapsedMs = now - loadedAt
  if (elapsedMs < 0) {
    return { ok: false, reason: '提交被拒绝：表单时间戳异常。' }
  }
  if (elapsedMs < cfg.minFillMs) {
    return {
      ok: false,
      reason: `提交过快（${(elapsedMs / 1000).toFixed(1)} 秒）。请至少停留 ${(
        cfg.minFillMs / 1000
      ).toFixed(0)} 秒后提交，以便我们确认是真人填写。`,
    }
  }
  return { ok: true, elapsedMs }
}

/* ================================================================== */
/* 第三层 C：IP 限流（滑动窗口计数器）                                  */
/* ================================================================== */

interface RateBucket {
  /** 窗口内每次提交的时间戳 */
  hits: number[]
}

/**
 * 进程内计数器。
 *
 * 注意：Serverless（Vercel）多实例/冷启动下每个实例各有一份计数，
 * 因此这只是**第一道软限流**。要严格限流请启用 supabase/functions/submit-guard
 * 里的 rate_limit 表实现（按 IP + 小时窗口落库，多实例共享）。
 */
interface RateLimitStore {
  buckets: Map<string, RateBucket>
}

const globalForRateLimit = globalThis as unknown as { __zxssxscRateLimit?: RateLimitStore }
const store: RateLimitStore =
  globalForRateLimit.__zxssxscRateLimit ??
  (globalForRateLimit.__zxssxscRateLimit = { buckets: new Map() })

const WINDOW_MS = 3_600_000

export interface RateLimitResult {
  ok: boolean
  /** 本窗口内已用次数 */
  used: number
  /** 剩余可用次数 */
  remaining: number
  /** 还需等待多少秒（ok=false 时有意义） */
  retryAfterSec: number
  limit: number
}

export function checkRateLimit(ip: string, now: number = Date.now()): RateLimitResult {
  const cfg = getAntiAbuseConfig()
  const limit = cfg.rateLimitPerHour
  if (cfg.disabled) {
    return { ok: true, used: 0, remaining: limit, retryAfterSec: 0, limit }
  }

  const key = ip || 'unknown'
  const bucket = store.buckets.get(key) ?? { hits: [] }
  // 滑动窗口：丢弃 1 小时之前的记录
  bucket.hits = bucket.hits.filter((t) => now - t < WINDOW_MS)

  const used = bucket.hits.length
  if (used >= limit) {
    const oldest = bucket.hits[0]
    const retryAfterSec = Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000))
    store.buckets.set(key, bucket)
    return { ok: false, used, remaining: 0, retryAfterSec, limit }
  }

  bucket.hits.push(now)
  store.buckets.set(key, bucket)

  // 顺手清理过期 bucket，避免内存无限增长
  if (store.buckets.size > 5000) {
    for (const [k, b] of store.buckets) {
      const alive = b.hits.filter((t) => now - t < WINDOW_MS)
      if (alive.length === 0) store.buckets.delete(k)
      else b.hits = alive
    }
  }

  return { ok: true, used: used + 1, remaining: limit - used - 1, retryAfterSec: 0, limit }
}

/** 只读查询，不消耗配额（供 UI 显示剩余次数） */
export function peekRateLimit(ip: string, now: number = Date.now()): RateLimitResult {
  const cfg = getAntiAbuseConfig()
  const limit = cfg.rateLimitPerHour
  const bucket = store.buckets.get(ip || 'unknown')
  const used = (bucket?.hits ?? []).filter((t) => now - t < WINDOW_MS).length
  return {
    ok: used < limit,
    used,
    remaining: Math.max(0, limit - used),
    retryAfterSec: 0,
    limit,
  }
}

/**
 * 从请求头解析客户端 IP。
 * Vercel 会设置 x-forwarded-for / x-real-ip。
 */
export function clientIpFromHeaders(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return (
    headers.get('x-real-ip')?.trim() ||
    headers.get('cf-connecting-ip')?.trim() ||
    headers.get('x-vercel-forwarded-for')?.trim() ||
    'unknown'
  )
}
