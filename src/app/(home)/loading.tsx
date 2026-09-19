import { Skeleton } from '@/components/ui/skeleton'

/**
 * 首页的加载骨架屏。
 *
 * ⚠️ 为什么它在 (home) 这个 **route group** 里，而不是直接放 app/loading.tsx：
 *
 * 加 loading.tsx 会给该路由段挂上 Suspense 边界，页面随即变成**流式渲染** ——
 * HTTP 状态码在页面组件执行完之前就已经发出去了。于是详情页里的 notFound()
 * 只渲染未找到界面，状态码却停在 200。我实测确认过这一点：
 *   app/loading.tsx 存在  → /school/不存在 返回 200
 *   app/loading.tsx 移除  → /school/不存在 返回 404
 *
 * 404 关系到 SEO 与「资源是否真的存在」，比一个骨架屏重要。
 * 放进 (home) 分组后，这个 Suspense 边界只包住首页本身，
 * /school/[id] 与 /college-holiday/[id] 不受影响，404 保持正确。
 *
 * 形状刻意做成和首页一致（工具条 + 70vh 地图 + 底部图例条），
 * 这样内容填进来时布局不会跳。
 *
 * 说明：/college-holiday 列表页目前**没有**骨架屏，因为它的子路由 [id]
 * 会一并被包进来、404 又会退化成 200。要补的话得再开一个 route group
 * 把列表页与详情页分开，代价是目录结构变复杂 —— 需要的话告诉我。
 */
export default function Loading() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="页面加载中">
      {/* 搜索工具条 */}
      <div className="px-3 pt-3 sm:px-4">
        <div className="flex flex-col gap-2 rounded-lg border p-2 sm:flex-row sm:items-center">
          <Skeleton className="h-9 w-full sm:w-[110px]" />
          <Skeleton className="h-9 w-full sm:w-[110px]" />
          <Skeleton className="h-9 w-full sm:w-[110px]" />
          <Skeleton className="h-9 flex-1" />
        </div>
      </div>

      {/* 地图区域：与真实地图等高，避免内容到位时页面跳动 */}
      <div className="relative mt-3 h-[70vh] min-h-[440px] w-full overflow-hidden border-y bg-muted/40">
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        {/* 右侧竖向时间滑块的位置 */}
        <div className="absolute bottom-2 right-2 top-2 w-[58px] sm:w-[76px]">
          <Skeleton className="h-full w-full rounded-lg" />
        </div>
      </div>

      {/* 底部图例条 */}
      <div className="flex items-center gap-4 border-t px-3 py-2 sm:px-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  )
}
