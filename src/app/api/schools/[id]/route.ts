/**
 * GET /api/schools/[id] —— 单个学校 + 版本历史
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
    const school = await store.getSchool(id)
    if (!school) return fail('找不到该学校', 404, 'not_found')
    const revisions = await store.listRevisions(id)
    return ok({ school, revisions })
  } catch (err) {
    return handleUnexpected('GET /api/schools/[id]', err)
  }
}
