// ============================================================================
// Supabase Edge Function: submit-guard
//
// 这是一个**可选的加固层**。主写入路径是 Next.js 的 /api/schools，
// 它已经完整实现了三层防护（见 src/app/api/schools/route.ts）。
//
// 那这个函数解决什么问题？
//   Vercel 的 Serverless 是多实例的，进程内计数器各算各的，
//   因此「同一 IP 每小时 3 次」在极端情况下会被放大到 3×实例数。
//   这个 Edge Function 用数据库里的原子计数器（bump_rate_limit）
//   做**跨实例**的严格限流，并把敏感词校验也放在数据库这一侧。
//
// 什么时候用它：
//   如果你发现有人刷接口，把前端的提交地址从 /api/schools
//   改成 https://<project>.functions.supabase.co/submit-guard 即可。
//
// 部署：
//   supabase functions deploy submit-guard --no-verify-jwt
// 需要的环境变量（Supabase 会自动注入前两个）：
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   SUBMIT_RATE_LIMIT_PER_HOUR（可选，默认 3）
//   SUBMIT_MIN_FILL_MS（可选，默认 3000）
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

/* ------------------------------------------------------------------ */
/* 词表：由 npm run sync:words 从 data/sensitive-words.json 同步而来   */
/* ------------------------------------------------------------------ */

const wordsUrl = new URL('./sensitive-words.json', import.meta.url)
const wordsConfig = JSON.parse(await Deno.readTextFile(wordsUrl)) as {
  categories: Array<{ id: string; label: string; words: string[] }>
}

const HAS_PUNCT = /[.*·•\-_~^|/\\+]/

function normalizeText(input: string): string {
  return input
    // 全角 -> 半角
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, '')
}

function stripPunct(input: string): string {
  return input.replace(/[.*·•\-_~^|/\\+]/g, '')
}

/**
 * 与 src/lib/anti-abuse.ts 相同的双通道匹配：
 * 纯中文词走「已剥标点」通道以对抗 `加*微*信` 这类规避写法；
 * 含 ASCII 标点的特征词（如 `.com`）走原通道，避免剥标点后变成裸词误伤。
 */
function findSensitive(text: string | null | undefined): string[] {
  if (!text) return []
  const raw = normalizeText(text)
  if (!raw) return []
  const stripped = stripPunct(raw)
  const hits: string[] = []
  for (const category of wordsConfig.categories) {
    for (const word of category.words) {
      const needle = normalizeText(word)
      if (!needle) continue
      const useRaw = HAS_PUNCT.test(needle)
      const target = useRaw ? raw : stripped
      const key = useRaw ? needle : stripPunct(needle)
      if (key && target.includes(key)) hits.push(`${category.label}:${word}`)
    }
  }
  return [...new Set(hits)]
}

/* ------------------------------------------------------------------ */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function fail(error: string, status: number, code: string): Response {
  return json({ ok: false, error, code }, status)
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return fail('只接受 POST', 405, 'method_not_allowed')
  }

  const minFillMs = Number(Deno.env.get('SUBMIT_MIN_FILL_MS') ?? '3000')
  const rateLimit = Number(Deno.env.get('SUBMIT_RATE_LIMIT_PER_HOUR') ?? '3')

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return fail('请求体不是合法 JSON', 400, 'bad_json')
  }

  // —— 蜜罐 ——
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return fail('提交被拒绝：检测到自动化填写痕迹。', 400, 'honeypot')
  }

  // —— 时间陷阱 ——
  const loadedAt = Number(body.form_loaded_at)
  if (!Number.isFinite(loadedAt) || loadedAt <= 0) {
    return fail('提交被拒绝：缺少表单载入时间戳。', 400, 'too_fast')
  }
  if (Date.now() - loadedAt < minFillMs) {
    return fail(
      `提交过快。请至少停留 ${(minFillMs / 1000).toFixed(0)} 秒后提交。`,
      400,
      'too_fast',
    )
  }

  // —— 敏感词 ——
  const hits = [
    ...findSensitive(body.name as string),
    ...findSensitive(body.address as string),
    ...findSensitive(body.remark as string),
  ]
  if (hits.length > 0) {
    return fail(`内容包含不允许的用语（${hits[0]}），请修改后重新提交。`, 422, 'sensitive_word')
  }

  // —— 格式校验（与数据库 CHECK 约束一致）——
  const name = String(body.name ?? '').trim()
  const lat = Number(body.lat)
  const lng = Number(body.lng)
  const dailyHours = Number(body.daily_hours)
  const schedule = (body.schedule_json ?? {}) as Record<string, unknown>

  if (name.length < 2 || name.length > 80 || /[<>]/.test(name)) {
    return fail('学校全名长度需在 2–80 字之间，且不能包含 < 或 >。', 400, 'invalid')
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 3 || lat > 54 || lng < 73 || lng > 136) {
    return fail('经纬度必须落在中国境内。', 400, 'invalid')
  }
  if (!Number.isFinite(dailyHours) || dailyHours < 0 || dailyHours > 24) {
    return fail('每日上学时长需在 0–24 小时之间。', 400, 'invalid')
  }
  for (const key of ['arrive_time', 'leave_time'] as const) {
    const v = schedule[key]
    if (v !== null && v !== undefined && v !== '' && !TIME_RE.test(String(v))) {
      return fail('时间格式应为 HH:mm。', 400, 'invalid')
    }
  }

  // —— 跨实例严格限流（数据库原子计数）——
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown'

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data: allowed, error: rlError } = await admin.rpc('bump_rate_limit', {
    p_ip: ip,
    p_limit: rateLimit,
  })

  if (rlError) {
    // 限流器故障时**放行**（fail-open）：这是防刷层，不是权限层，
    // 让它拖垮正常提交得不偿失。错误会记录在日志里。
    console.error('[submit-guard] bump_rate_limit 失败，已放行：', rlError.message)
  } else if (allowed === false) {
    return fail(`提交过于频繁：同一 IP 每小时最多 ${rateLimit} 次。`, 429, 'rate_limited')
  }

  // —— 写入 ——
  const isUpdate = typeof body.id === 'string' && body.id.length > 0
  const payload = {
    name,
    stage: String(body.stage ?? ''),
    province: String(body.province ?? ''),
    city: String(body.city ?? ''),
    district: String(body.district ?? ''),
    address: body.address ? String(body.address) : null,
    lat,
    lng,
    daily_hours: dailyHours,
    weekly_days: Number(body.weekly_days),
    monthly_days: Number(body.monthly_days),
    boarding: body.boarding === true,
    schedule_json: schedule,
    remark: body.remark ? String(body.remark) : null,
    updated_at: new Date().toISOString(),
  }

  if (isUpdate) {
    const id = String(body.id)

    const { data: before, error: readError } = await admin
      .from('schools')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (readError) return fail(`读取原数据失败：${readError.message}`, 500, 'server_error')
    if (!before) return fail('要修改的学校不存在。', 404, 'not_found')

    const { error: revError } = await admin
      .from('school_revisions')
      .insert({ school_id: id, version: before.version, snapshot: before })
    if (revError) return fail(`写入版本快照失败：${revError.message}`, 500, 'server_error')

    const { data, error } = await admin
      .from('schools')
      .update({ ...payload, version: before.version + 1 })
      .eq('id', id)
      .select('*')
      .single()
    if (error) return fail(`保存失败：${error.message}`, 400, 'save_failed')

    return json({
      ok: true,
      data: { school: data, created: false, message: '修改成功（经 Edge Function 加固层）。' },
    })
  }

  const { data, error } = await admin
    .from('schools')
    .insert({ ...payload, version: 1, created_at: new Date().toISOString() })
    .select('*')
    .single()
  if (error) return fail(`新增失败：${error.message}`, 400, 'save_failed')

  return json(
    {
      ok: true,
      data: { school: data, created: true, message: '新增成功（经 Edge Function 加固层）。' },
    },
    201,
  )
})
