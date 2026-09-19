'use client'

import { useState } from 'react'
import { Crosshair, Layers, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import { AUTO_TILE_PROVIDER_ID, selectableTileProviders } from '@/lib/tileProviders'
import { cn } from '@/lib/utils'
import type { VisibleLayers } from './map/leaflet-map'

export interface LayerSwitcherProps {
  layers: VisibleLayers
  onLayersChange: (layers: VisibleLayers) => void
  showTwilight: boolean
  onShowTwilightChange: (v: boolean) => void
  tileProviderId: string
  onTileProviderChange: (id: string) => void
  onLocate: () => void
  locating: boolean
  hasVisitor: boolean
  /**
   * 该页面实际提供哪些图层。用于大学放假页这种只有「大学 + 晨昏线」的场景，
   * 避免出现勾了没反应的开关。
   */
  available?: Array<keyof VisibleLayers>
  className?: string
}

const LAYER_ITEMS: Array<{ key: keyof VisibleLayers; label: string; hint: string }> = [
  { key: 'schools', label: '中学分布', hint: '按每日上学时长着色' },
  { key: 'heat', label: '热力图', hint: '颜色越红代表在校时间越长' },
  { key: 'terminator', label: '晨昏线', hint: '随时间与季节变化' },
  { key: 'colleges', label: '大学放假', hint: '按放假状态着色' },
]

export function LayerSwitcher({
  layers,
  onLayersChange,
  showTwilight,
  onShowTwilightChange,
  tileProviderId,
  onTileProviderChange,
  onLocate,
  locating,
  hasVisitor,
  available,
  className,
}: LayerSwitcherProps) {
  const [open, setOpen] = useState(false)
  const providers = selectableTileProviders()
  const items = available
    ? LAYER_ITEMS.filter((i) => available.includes(i.key))
    : LAYER_ITEMS

  return (
    <div className={cn('flex flex-col items-end gap-2', className)}>
      <div className="flex gap-2">
        <Button
          type="button"
          variant={hasVisitor ? 'default' : 'outline'}
          size="sm"
          onClick={onLocate}
          disabled={locating}
          className="bg-background/92 shadow-lg backdrop-blur"
          title="使用浏览器定位筛选附近的学校（仅取经纬度，不反查地址、不存储）"
        >
          {locating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Crosshair className="size-4" />
          )}
          <span className="hidden sm:inline">{hasVisitor ? '已定位' : '定位我'}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          className="bg-background/92 shadow-lg backdrop-blur"
        >
          <Layers className="size-4" />
          <span className="hidden sm:inline">图层</span>
        </Button>
      </div>

      {open ? (
        <div className="w-[248px] rounded-lg border bg-background/95 p-3 text-sm shadow-xl backdrop-blur">
          <div className="mb-2 font-medium">地图图层</div>

          <div className="space-y-2">
            {items.map((item) => (
              <label
                key={item.key}
                className="flex cursor-pointer items-start gap-2 leading-tight"
              >
                <Checkbox
                  id={`layer-${item.key}`}
                  name={`layer-${item.key}`}
                  checked={layers[item.key]}
                  onCheckedChange={(v) =>
                    onLayersChange({ ...layers, [item.key]: v === true })
                  }
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-[13px]">{item.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{item.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-3 border-t pt-2">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                id="layer-twilight"
                name="layer-twilight"
                checked={showTwilight}
                onCheckedChange={(v) => onShowTwilightChange(v === true)}
              />
              <span className="text-[13px]">
                晨昏蒙影线
                <span className="ml-1 text-[11px] text-muted-foreground">−6° / −12°</span>
              </span>
            </label>
          </div>

          <div className="mt-3 border-t pt-2">
            <label className="mb-1 block text-[12px] text-muted-foreground" htmlFor="tile-provider">
              底图（OSM 镜像）
            </label>
            <Select
              id="tile-provider"
              value={tileProviderId}
              onChange={(e) => onTileProviderChange(e.target.value)}
            >
              <option value={AUTO_TILE_PROVIDER_ID}>自动（测速选最快的镜像）</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
              {tileProviderId === AUTO_TILE_PROVIDER_ID
                ? '并发测速 3 个 OSM 镜像，取响应最快的作为底图；结果缓存在本次会话内，不会再重复测。'
                : providers.find((p) => p.id === tileProviderId)?.note}
            </p>
          </div>

          <p className="mt-2 border-t pt-2 text-[10px] leading-tight text-muted-foreground">
            底图数据 © OpenStreetMap contributors（ODbL）。请勿批量抓取瓦片。
          </p>
        </div>
      ) : null}
    </div>
  )
}
