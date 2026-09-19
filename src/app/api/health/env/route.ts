/**
 * GET /api/health/env —— 环境变量体检。
 *
 * 专门用来回答「我明明配了变量，为什么服务端读不到」这类问题：
 *   1. 服务端进程**实际**有没有读到 AMAP_WEB_KEY；
 *   2. 有没有形似的变量名（例如多写了 NEXT_PUBLIC_ 前缀、拼错、带尾空格）；
 *   3. 项目根目录的 .env.local 里到底有没有那一行、文件多大、有没有 BOM（仅非生产环境）；
 *   4. 当前工作目录是不是项目根（Next 只从项目根读 .env.local）。
 *
 * 只返回布尔判断与变量名，**不返回任何变量值**。
 */

import { handleUnexpected, ok } from '@/lib/api-helpers'
import { getDataMode } from '@/lib/data-source'
import { diagnoseAmapKey } from '@/lib/env-diagnostics'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok({
      dataMode: getDataMode(),
      supabaseConfigured: getDataMode() === 'supabase',
      amap: diagnoseAmapKey(),
    })
  } catch (err) {
    return handleUnexpected('GET /api/health/env', err)
  }
}
