/**
 * Supabase 客户端（仅服务端使用）。
 *
 * 重要设计决定：**浏览器不直接持有 Supabase 凭据**。
 * 所有读写都经由 Next.js 的 /api/* 路由在服务端完成，原因有三：
 *   1. 三层反滥用（敏感词 / 蜜罐 / 时间陷阱 / IP 限流）必须在服务端强制执行，
 *      否则攻击者可以绕过前端直接调 PostgREST；
 *   2. 服务端使用的是 anon key，**RLS 依然生效**，安全性没有削弱；
 *   3. 少暴露一个对外端点，也就少一份被刷的风险。
 *
 * 环境变量优先读不带前缀的名字（服务端专用）；为兼容常见写法，
 * 同时接受 NEXT_PUBLIC_ 前缀的旧命名。
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function readEnv(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return ''
}

export function getSupabaseUrl(): string {
  return readEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL')
}

export function getSupabaseAnonKey(): string {
  return readEnv('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

export function getSupabaseServiceKey(): string {
  return readEnv('SUPABASE_SERVICE_ROLE_KEY')
}

/** 是否已经配置好 Supabase（决定走真实数据还是 mock） */
export function supabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey())
}

let anonClient: SupabaseClient | null = null
let adminClient: SupabaseClient | null = null

/** anon 客户端：受 RLS 约束，用于全部读写 */
export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured()) return null
  if (anonClient) return anonClient
  anonClient = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'zxssxsc' } },
  })
  return anonClient
}

/**
 * service_role 客户端：**绕过 RLS**，只用于两件必须的事：
 *   1. 写入版本历史快照（不希望普通访客能随意伪造快照）；
 *   2. 严格的跨实例 IP 限流计数。
 * 未配置时相关功能自动降级，不影响主流程。
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const key = getSupabaseServiceKey()
  if (!supabaseConfigured() || !key) return null
  if (adminClient) return adminClient
  adminClient = createClient(getSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return adminClient
}

/**
 * 分页取全表。
 * PostgREST 默认单次最多返回 1000 行，数据量上去后必须翻页，
 * 否则会「静默截断」——地图上会莫名少掉一批学校。
 *
 * `filter` 用于把「只取 active」这类条件下推到数据库，
 * 而不是取回来再在内存里筛（那样分页边界会算错）。
 */
export async function selectAll<T>(
  client: SupabaseClient,
  table: string,
  options: {
    order?: string
    ascending?: boolean
    filter?: { column: string; value: string }
  } = {},
): Promise<T[]> {
  const pageSize = 1000
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    let query = client.from(table).select('*').range(from, from + pageSize - 1)
    if (options.filter) {
      query = query.eq(options.filter.column, options.filter.value)
    }
    if (options.order) {
      query = query.order(options.order, { ascending: options.ascending ?? true })
    }
    const { data, error } = await query
    if (error) throw new Error(`读取 ${table} 失败：${error.message}`)
    const batch = (data ?? []) as T[]
    rows.push(...batch)
    if (batch.length < pageSize) break
  }
  return rows
}
