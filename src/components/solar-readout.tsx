'use client'

import { useMemo, useState } from 'react'
import * as SunCalc from 'suncalc'
import { ChevronDown, ChevronUp, Sun } from 'lucide-react'

import { dayLengthHours, getSolarPosition, polarState } from '@/lib/solar'
import { formatClock } from '@/lib/holidays'
import { cn } from '@/lib/utils'

export interface SolarReference {
  lat: number
  lng: number
  label: string
}

/** 没有访客定位时的默认参考点：北京 */
export const DEFAULT_SOLAR_REFERENCE: SolarReference = {
  lat: 39.9042,
  lng: 116.4074,
  label: '北京（默认）',
}

interface SolarReadoutProps {
  date: Date | null
  reference?: SolarReference | null
  className?: string
}

/** 极区会出现 null/Invalid Date，统一显示为破折号 */
function fmtTime(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return '—'
  return formatClock(d, false)
}

/**
 * 太阳几何读数面板。
 *
 * 这里刻意用了两套算法互为印证：
 * - 本项目的 solar.ts 负责**全球**几何（赤纬、直射点、晨昏线），
 *   这是绘制晨昏线所必需的；
 * - suncalc 负责**站点**几何（该地此刻的太阳高度角、日出日落），
 *   它的时角/蒙影算法更完整，直接拿来用比自己再写一遍更可靠。
 * 两者在“直射点附近高度角≈90°”这一点上是一致的。
 */
export function SolarReadout({
  date,
  reference = DEFAULT_SOLAR_REFERENCE,
  className,
}: SolarReadoutProps) {
  const [open, setOpen] = useState(true)
  const ref = reference ?? DEFAULT_SOLAR_REFERENCE

  const info = useMemo(() => {
    if (!date) return null
    const solar = getSolarPosition(date)
    const sunPos = SunCalc.getPosition(date, ref.lat, ref.lng)
    const times = SunCalc.getTimes(date, ref.lat, ref.lng)
    const polar = polarState(ref.lat, date)
    const dayLen = dayLengthHours(ref.lat, date)
    return {
      solar,
      altitude: (sunPos.altitude * 180) / Math.PI,
      azimuth: (sunPos.azimuth * 180) / Math.PI + 180,
      sunrise: times.sunrise,
      sunset: times.sunset,
      solarNoon: times.solarNoon,
      polar,
      dayLen,
    }
  }, [date, ref.lat, ref.lng])

  const isDay = info ? info.altitude > 0 : false

  return (
    <div
      className={cn(
        'w-[200px] rounded-lg border bg-background/92 text-xs shadow-lg backdrop-blur',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left font-medium"
      >
        <Sun className={cn('size-3.5', isDay ? 'text-amber-500' : 'text-slate-400')} />
        <span>太阳几何</span>
        <span
          className={cn(
            'ml-auto rounded px-1 py-0.5 text-[10px]',
            isDay ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-700',
          )}
        >
          {info ? (isDay ? '昼' : '夜') : '—'}
        </span>
        {open ? (
          <ChevronUp className="size-3 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3 text-muted-foreground" />
        )}
      </button>

      {open && info ? (
        <dl className="space-y-1 border-t px-2.5 py-2 text-[11px]">
          <Row label="太阳赤纬 δ">
            <span className="font-mono tabular-nums">{info.solar.declination.toFixed(2)}°</span>
          </Row>
          <Row label="直射点">
            <span className="font-mono tabular-nums">
              {info.solar.subsolarLat.toFixed(1)}°, {info.solar.subsolarLng.toFixed(1)}°
            </span>
          </Row>
          <Row label="时差 EoT">
            <span className="font-mono tabular-nums">
              {info.solar.equationOfTime >= 0 ? '+' : ''}
              {info.solar.equationOfTime.toFixed(1)} min
            </span>
          </Row>

          <div className="my-1 border-t" />

          <div className="text-[10px] font-medium text-muted-foreground">
            参考点：{ref.label}
          </div>
          <Row label="太阳高度角">
            <span className="font-mono tabular-nums">{info.altitude.toFixed(1)}°</span>
          </Row>
          <Row label="方位角">
            <span className="font-mono tabular-nums">{info.azimuth.toFixed(0)}°</span>
          </Row>
          <Row label="日出 / 日落">
            <span className="font-mono tabular-nums">
              {fmtTime(info.sunrise)} / {fmtTime(info.sunset)}
            </span>
          </Row>
          <Row label="昼长">
            <span className="font-mono tabular-nums">
              {info.polar === 'polar-day'
                ? '极昼 24h'
                : info.polar === 'polar-night'
                  ? '极夜 0h'
                  : `${info.dayLen.toFixed(2)} h`}
            </span>
          </Row>
        </dl>
      ) : null}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
