/**
 * POST /api/schools/[id]/rollback —— 回滚到指定版本
 * body: { version: number }
 *
 * 回滚本身也是一次「修改」：会先把当前版本存成新快照，再恢复目标版本，
 * 并把 version +1。因此回滚之后仍可再回滚回来，不会丢失历史。
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

    const school = await getStore().rollbackSchool(id, version)
    return ok({
      school,
      message: `已回滚到 v${version}，当前版本 v${school.version}。`,
    })
  } catch (err) {
    return handleUnexpected('POST /api/schools/[id]/rollback', err)
  }
}
