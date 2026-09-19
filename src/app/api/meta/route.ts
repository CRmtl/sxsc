/**
 * GET /api/meta
 *
 * 前端需要知道但不应硬编码的运行期信息：
 * - 当前数据模式（mock / supabase），用于在页面上诚实地标注“演示数据”
 * - 反滥用配置（最短填写时间、每小时限流），用于在表单里给出准确提示
 * - 站点名与底图信息
 */

import { ok, handleUnexpected } from '@/lib/api-helpers'
import { getAntiAbuseConfig } from '@/lib/anti-abuse'
import { getDataMode } from '@/lib/data-source'
import { DEFAULT_TILE_PROVIDER_ID, selectableTileProviders } from '@/lib/tileProviders'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const cfg = getAntiAbuseConfig()
    return ok({
      dataMode: getDataMode(),
      antiAbuse: {
        enabled: !cfg.disabled,
        minFillMs: cfg.minFillMs,
        rateLimitPerHour: cfg.rateLimitPerHour,
      },
      tile: {
        defaultProviderId: DEFAULT_TILE_PROVIDER_ID,
        providers: selectableTileProviders().map((p) => ({
          id: p.id,
          label: p.label,
          note: p.note,
          maxZoom: p.maxZoom,
          requiresKey: p.requiresKey ?? null,
        })),
      },
    })
  } catch (err) {
    return handleUnexpected('GET /api/meta', err)
  }
}
