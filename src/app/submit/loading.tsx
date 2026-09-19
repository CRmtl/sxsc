import { Skeleton } from '@/components/ui/skeleton'

/**
 * 上传/修改页的加载骨架屏。
 *
 * 这个路由没有任何 notFound()，所以加 loading.tsx 不会影响状态码语义
 * （对比 (home)/loading.tsx 顶部那段关于流式渲染与 404 的说明）。
 *
 * 形状对齐真实表单：几张卡片的标题 + 输入框网格，
 * 让骨架到真实内容的过渡不跳版。
 */
export default function Loading() {
  return (
    <div
      className="mx-auto w-full max-w-3xl px-3 py-5 sm:px-4"
      aria-busy="true"
      aria-label="表单加载中"
    >
      {/* 标题 + 模式切换 */}
      <Skeleton className="mb-4 h-7 w-64" />
      <Skeleton className="mb-4 h-9 w-full max-w-[280px]" />

      {/* 三张卡片 */}
      {[0, 1, 2].map((card) => (
        <div key={card} className="mb-4 rounded-lg border p-4">
          <Skeleton className="mb-4 h-5 w-32" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
          {card === 1 ? <Skeleton className="mt-4 h-[280px] w-full rounded-lg" /> : null}
        </div>
      ))}

      <Skeleton className="h-11 w-56" />
    </div>
  )
}
