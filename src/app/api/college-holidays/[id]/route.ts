/**
 * GET /api/college-holidays/[id] —— 单条校历 + 版本历史
 */

import { fail, handleUnexpected, ok } from '@/lib/api-helpers'
import { getStore } from '@/lib/data-source'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const store = getStore()
    const holiday = await store.getCollegeHoliday(id)
    if (!holiday) return fail('找不到该校历记录', 404, 'not_found')
    const revisions = await store.listCollegeHolidayRevisions(id)
    return ok({ holiday, revisions })
  } catch (err) {
    return handleUnexpected('GET /api/college-holidays/[id]', err)
  }
}
