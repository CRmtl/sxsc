'use client'

import { RotateCcw, CalendarDays } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { formatHourOffset, formatClock } from '@/lib/holidays'
import { OFFSET_MAX, OFFSET_MIN, OFFSET_STEP, type TimeTravel } from '@/hooks/use-time-travel'

const TICKS = [12, 6, 0, -6, -12]

interface TimeSliderProps {
  time: TimeTravel
  className?: string
}

/**
 * 右侧竖向时间滑块：−12h ~ +12h，步长 0.25h。
 *
 * Radix Slider 的 vertical 模式是「下小上大」，所以滑块的 value 直接用
 * offsetHours，并把最大值放在顶端 —— 向上拖 = 未来，向下拖 = 过去。
 */
export function TimeSlider({ time, className }: TimeSliderProps) {
  const {
    offsetHours,
    setOffsetHours,
    manualDate,
    setManualDate,
    effectiveDate,
    isLive,
    resetToNow,
  } = time

  return (
    <div
      className={
        'flex w-[58px] flex-col items-center gap-1.5 rounded-lg border bg-background/92 p-1.5 shadow-lg backdrop-blur sm:w-[76px] sm:gap-2 sm:p-2 ' +
        (className ?? '')
      }
    >
      {/* 视图时刻 */}
      <div className="w-full text-center">
        <div className="font-mono text-[15px] font-semibold leading-tight tabular-nums">
          {effectiveDate ? formatClock(effectiveDate, false) : '--:--'}
        </div>
        <div className="text-[10px] leading-tight text-muted-foreground">
          {effectiveDate
            ? `${effectiveDate.getMonth() + 1}/${effectiveDate.getDate()}`
            : '--/--'}
        </div>
      </div>

      {/* 偏移量 */}
      <div
        className={
          'w-full rounded px-1 py-0.5 text-center text-[10px] font-medium ' +
          (isLive ? 'bg-secondary text-secondary-foreground' : 'bg-primary/10 text-primary')
        }
      >
        {formatHourOffset(offsetHours)}
      </div>

      {/* 竖向滑块 */}
      <div className="flex min-h-[140px] flex-1 items-stretch gap-1">
        <Slider
          orientation="vertical"
          className="vertical-slider flex-1"
          min={OFFSET_MIN}
          max={OFFSET_MAX}
          step={OFFSET_STEP}
          value={[offsetHours]}
          onValueChange={(v) => setOffsetHours(v[0] ?? 0)}
          aria-label="时间偏移（小时）"
        />
        {/* 刻度 */}
        <div className="relative flex w-7 flex-col justify-between py-0.5 text-[9px] leading-none text-muted-foreground">
          {TICKS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setOffsetHours(t)}
              className="text-right hover:text-foreground"
              title={`跳到 ${t > 0 ? '+' : ''}${t} 小时`}
            >
              {t > 0 ? `+${t}` : t}
            </button>
          ))}
        </div>
      </div>

      {/* 日期选择 */}
      <div className="w-full">
        <label className="flex cursor-pointer items-center justify-center gap-1 rounded border px-1 py-1 text-[10px] text-muted-foreground hover:bg-accent">
          <CalendarDays className="size-3" />
          <span className="truncate">{manualDate ?? '今天'}</span>
          <input
            id="view-date"
            name="view-date"
            type="date"
            value={manualDate ?? ''}
            max="2100-12-31"
            onChange={(e) => setManualDate(e.target.value || null)}
            className="sr-only"
            aria-label="选择日期"
          />
        </label>
        {manualDate ? (
          <button
            type="button"
            onClick={() => setManualDate(null)}
            className="mt-0.5 w-full text-center text-[10px] text-primary hover:underline"
          >
            回到今天
          </button>
        ) : null}
      </div>

      <Button
        type="button"
        variant={isLive ? 'secondary' : 'default'}
        size="sm"
        onClick={resetToNow}
        disabled={isLive}
        className="h-7 w-full px-1 text-[11px]"
      >
        <RotateCcw className="size-3" />
        现在
      </Button>
    </div>
  )
}
