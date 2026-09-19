/**
 * GET /api/schools —— 学校列表
 * POST /api/schools —— 新增或修改学校（匿名、直接生效）
 *
 * POST 的完整防护链（三层全部在服务端强制执行）：
 *   1. 蜜罐字段
 *   2. 时间陷阱
 *   3. IP 滑动窗口限流
 *   4. 结构/范围校验（与数据库 CHECK 约束一致）
 *   5. 行政区划真实性校验（防止伪造省份）
 *   6. 敏感词扫描
 */

import { fail, handleUnexpected, ipOf, ok, readJson } from '@/lib/api-helpers'
import { checkHoneypot, checkTimeTrap, checkRateLimit, scanFields } from '@/lib/anti-abuse'
import { getStore } from '@/lib/data-source'
import { isValidArea } from '@/lib/china-area'
import { validateSchoolSubmission } from '@/lib/validation'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const schools = await getStore().listSchools()
    return ok({ schools, count: schools.length })
  } catch (err) {
    return handleUnexpected('GET /api/schools', err)
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request)
    if (!body || typeof body !== 'object') {
      return fail('请求体不是合法 JSON', 400, 'bad_json')
    }
    const raw = body as Record<string, unknown>

    // —— 第三层 A：蜜罐 ——
    const honeypot = checkHoneypot(raw.website)
    if (!honeypot.ok) return fail(honeypot.reason, 400, 'honeypot')

    // —— 第三层 B：时间陷阱 ——
    const timeTrap = checkTimeTrap(raw.form_loaded_at)
    if (!timeTrap.ok) return fail(timeTrap.reason, 400, 'too_fast')

    // —— 第三层 C：IP 限流 ——
    const ip = ipOf(request)
    const rate = checkRateLimit(ip)
    if (!rate.ok) {
      return fail(
        `提交过于频繁：同一 IP 每小时最多 ${rate.limit} 次，请在 ${Math.ceil(
          rate.retryAfterSec / 60,
        )} 分钟后再试。`,
        429,
        'rate_limited',
      )
    }

    // —— 第四层：结构与范围校验 ——
    const validated = validateSchoolSubmission(raw)
    if (!validated.ok) {
      return fail(validated.error, 400, 'invalid', validated.field)
    }
    const sub = validated.value

    // —— 行政区划真实性 ——
    if (!isValidArea(sub.province, sub.city, sub.district)) {
      return fail(
        '省/市/区县组合无法识别，请通过下拉选择而不是手动输入。',
        400,
        'invalid_area',
        'province',
      )
    }

    // —— 第二层：敏感词 ——
    const hits = scanFields({
      name: sub.name,
      address: sub.address,
      remark: sub.remark,
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

    // —— 落库 ——
    const outcome = await getStore().submitSchool(sub)

    return ok(
      {
        school: outcome.school,
        created: outcome.created,
        previousVersion: outcome.previousVersion,
        message: outcome.created
          ? '新增成功，感谢你的贡献！'
          : `修改成功，已保存为 v${outcome.school.version}（旧版本可在详情页回滚）。`,
        rate: { remaining: rate.remaining, limit: rate.limit },
      },
      outcome.created ? 201 : 200,
    )
  } catch (err) {
    return handleUnexpected('POST /api/schools', err)
  }
}
