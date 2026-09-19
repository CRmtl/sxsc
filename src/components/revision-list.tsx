'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { History, Loader2, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

/** 摘要片段：带 color 时在前面画一个同色圆点（学校的时长档位色用它） */
export interface RevisionSummaryItem {
  text: string
  color?: string
}

/**
 * 版本历史里的一行，**已由服务端预格式化**。
 *
 * 为什么不是传 render 函数进来：这个组件是客户端组件，而它的调用方是
 * 服务端组件。服务端 → 客户端的 props 必须可序列化，**函数不行**。
 * 最初的实现传了 renderTitle / renderSummary 两个函数，
 * 结果两个详情页直接 500 —— 这是被冒烟测试抓出来的。
 * 改成传纯数据后，既过了边界，组件也变简单了（不再需要泛型）。
 */
export interface RevisionRow {
  id: string
  version: number
  createdAt: string
  changeNote: string | null
  title: string
  summary: RevisionSummaryItem[]
}

interface RevisionListProps {
  /** 回滚接口前缀，例如 '/api/schools' 或 '/api/college-holidays' */
  apiBase: string
  entityId: string
  rows: RevisionRow[]
  currentVersion: number
  /** 空态提示里的实体称呼，例如「这所学校」 */
  entityLabel: string
}

function fmt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

/**
 * 版本历史与回滚（学校与大学校历共用）。
 *
 * 回滚本身也是一次「修改」：服务端会先把当前版本存成新快照，再恢复目标版本，
 * 因此回滚之后仍可回滚回来，历史不会丢失。
 */
export function RevisionList({
  apiBase,
  entityId,
  rows,
  currentVersion,
  entityLabel,
}: RevisionListProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyVersion, setBusyVersion] = useState<number | null>(null)

  async function rollback(version: number) {
    if (
      !window.confirm(
        `确认回滚到 v${version}？当前 v${currentVersion} 会先被存为快照，之后仍然可以再回滚回来。`,
      )
    ) {
      return
    }
    setBusyVersion(version)
    try {
      const res = await fetch(`${apiBase}/${entityId}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      })
      const json = (await res.json()) as
        | { ok: true; data: { message: string } }
        | { ok: false; error: string }
      if (!json.ok) {
        toast.error(json.error)
        return
      }
      toast.success(json.data.message)
      startTransition(() => router.refresh())
    } catch {
      toast.error('回滚请求失败，请稍后重试')
    } finally {
      setBusyVersion(null)
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        <History className="mx-auto mb-2 size-5" />
        还没有历史版本。{entityLabel}自创建以来没有被修改过（当前 v{currentVersion}）。
      </div>
    )
  }

  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
          <Badge variant="outline" className="font-mono">
            v{row.version}
          </Badge>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{row.title}</div>
            <div className="text-[11px] text-muted-foreground">
              {fmt(row.createdAt)}
              {row.changeNote ? ` · ${row.changeNote}` : ''}
            </div>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            {row.summary.map((item, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                {item.color ? (
                  <span
                    className="inline-block size-2.5 rounded-full"
                    style={{ background: item.color }}
                  />
                ) : null}
                {item.text}
              </span>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || busyVersion !== null}
            onClick={() => void rollback(row.version)}
          >
            {busyVersion === row.version ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RotateCcw className="size-3.5" />
            )}
            回滚到此版本
          </Button>
        </li>
      ))}
    </ul>
  )
}
