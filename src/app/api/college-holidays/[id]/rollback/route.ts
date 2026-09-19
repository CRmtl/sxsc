/**
 * POST /api/college-holidays/[id]/rollback —— 回滚校历到指定版本
 * body: { version: number }
 *
 * 与学校回滚同一套语义：先把当前版本存成新快照，再恢复目标版本，version +1。
 * 因此回滚之后仍可再回滚回来，历史不会丢失。
 */

import { fail, handleUnexpected, ipOf, ok, readJson } from '@/lib/api-helpers'
import { checkRateLimit } from '@/lib/anti-abuse'
import { getStore } from '@/lib/data-source'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = (await readJson(request)) as Record<string, unknown> | null
    const version = Number(body?.version)
    if (!Number.isInteger(version) || version < 1) {
      return fail('version 必须是不小于 1 的整数', 400, 'invalid', 'version')
    }

    // 回滚是写操作，同样纳入限流
    const rate = checkRateLimit(ipOf(request))
    if (!rate.ok) {
      return fail('操作过于频繁，请稍后再试。', 429, 'rate_limited')
    }

    const holiday = await getStore().rollbackCollegeHoliday(id, version)
    return ok({
      holiday,
      message: `已回滚到 v${version}，当前版本 v${holiday.version}。`,
    })
  } catch (err) {
    return handleUnexpected('POST /api/college-holidays/[id]/rollback', err)
  }
}
