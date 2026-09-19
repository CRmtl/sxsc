/**
 * GET /api/college-holidays —— 大学假期列表
 * POST /api/college-holidays —— 新增/修改大学假期（复用同一套三层防护）
 */

import { fail, handleUnexpected, ipOf, ok, readJson } from '@/lib/api-helpers'
import { checkHoneypot, checkRateLimit, checkTimeTrap, scanFields } from '@/lib/anti-abuse'
import { getStore } from '@/lib/data-source'
import { isValidProvinceCity } from '@/lib/china-area'
import { validateCollegeHoliday } from '@/lib/validation'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const store = getStore()
    const [holidays, festivals] = await Promise.all([
      store.listCollegeHolidays(),
      store.listHolidays(),
    ])
    return ok({ holidays, festivals, count: holidays.length })
  } catch (err) {
    return handleUnexpected('GET /api/college-holidays', err)
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request)
    if (!body || typeof body !== 'object') {
      return fail('请求体不是合法 JSON', 400, 'bad_json')
    }
    const raw = body as Record<string, unknown>

    const honeypot = checkHoneypot(raw.website)
    if (!honeypot.ok) return fail(honeypot.reason, 400, 'honeypot')

    const timeTrap = checkTimeTrap(raw.form_loaded_at)
    if (!timeTrap.ok) return fail(timeTrap.reason, 400, 'too_fast')

    const rate = checkRateLimit(ipOf(request))
    if (!rate.ok) {
      return fail(
        `提交过于频繁：同一 IP 每小时最多 ${rate.limit} 次，请在 ${Math.ceil(
          rate.retryAfterSec / 60,
        )} 分钟后再试。`,
        429,
        'rate_limited',
      )
    }

    const validated = validateCollegeHoliday(raw)
    if (!validated.ok) {
      return fail(validated.error, 400, 'invalid', validated.field)
    }
    const sub = validated.value

    if (!isValidProvinceCity(sub.province, sub.city)) {
      return fail('省份或城市无法识别，请通过下拉选择。', 400, 'invalid_area', 'province')
    }

    // 只扫描自由文本字段。
    // **不要**把 source_url 放进来：词表里有 `http://` / `https://` 这两条防广告词，
    // 而 source_url 按设计必须是一个 http(s) 网址 —— 扫它等于把每一条合法提交都拦死
    // （这个 bug 是被 scripts/smoke-test.mjs 的「新增校历成功（201）」用例抓出来的）。
    // URL 字段该用的是格式校验（validateCollegeHoliday 已强制 ^https?://），
    // 而不是关键词黑名单。
    const hits = scanFields({
      name: sub.university_name,
      note: sub.note,
    })
    if (hits.length > 0) {
      const first = hits[0]
      return fail(
        `内容包含不允许的用语（${first.hit.categoryLabel}：${first.hit.word}），请修改后重新提交。`,
        422,
        'sensitive_word',
        first.field,
      )
    }

    const outcome = await getStore().submitCollegeCalendar(sub)
    return ok(
      {
        holiday: outcome.holiday,
        created: outcome.created,
        message: outcome.created ? '新增成功，感谢你的贡献！' : '修改成功。',
        rate: { remaining: rate.remaining, limit: rate.limit },
      },
      outcome.created ? 201 : 200,
    )
  } catch (err) {
    return handleUnexpected('POST /api/college-holidays', err)
  }
}
