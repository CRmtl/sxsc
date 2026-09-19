'use client'

import { useEffect, useState } from 'react'

import {
  AUTO_TILE_PROVIDER_ID,
  measureTileProviders,
  type MirrorSpeed,
} from '@/lib/tileProviders'

/** 测速结果缓存在 sessionStorage：同一次会话内跨页面导航（及详情页小地图）不再重测 */
const STORAGE_KEY = 'zxssxsc:tile-provider'

interface Cached {
  id: string
  ms: number
}

function readCache(): Cached | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Cached
    return parsed?.id ? parsed : null
  } catch {
    // 隐私模式 / 禁用存储时 sessionStorage 会抛异常，直接当作没有缓存
    return null
  }
}

export interface TileProviderState {
  /** 当前实际使用的瓦片源 id（'auto' 已被解析成具体镜像） */
  providerId: string
  /** 是否正在测速 */
  detecting: boolean
  /** 胜出镜像的耗时（毫秒） */
  speedMs: number | null
  /** 全部候选的测速排名（仅本次会话测过才有） */
  ranking: MirrorSpeed[]
  /** 是否由自动测速选出（而非环境变量/用户手动指定） */
  autoSelected: boolean
}

/**
 * 底图自动选源。只读：要换源就改传进来的 requestedId。
 *
 * 刻意放在 leaflet-map 内部而不是各个页面里：
 * 首页地图、大学放假页地图、学校详情页小地图三处都会自动获得选源优化，
 * 页面组件一行都不用改。
 *
 * 只在**客户端**测速 —— 要测的是「用户所在网络到镜像」的速度，
 * 服务端测出来的是 Vercel 机房的速度，与用户无关。
 */
export function useTileProvider(requestedId: string): TileProviderState {
  const isAuto = requestedId === AUTO_TILE_PROVIDER_ID

  const [providerId, setProviderId] = useState(isAuto ? 'hot' : requestedId)
  const [detecting, setDetecting] = useState(isAuto)
  const [speedMs, setSpeedMs] = useState<number | null>(null)
  const [ranking, setRanking] = useState<MirrorSpeed[]>([])

  useEffect(() => {
    // 明确指定了镜像：不测速，尊重指定
    if (requestedId !== AUTO_TILE_PROVIDER_ID) {
      setProviderId(requestedId)
      setSpeedMs(null)
      setDetecting(false)
      return
    }

    const cached = readCache()
    if (cached) {
      setProviderId(cached.id)
      setSpeedMs(cached.ms)
      setDetecting(false)
      return
    }

    let cancelled = false
    setDetecting(true)

    measureTileProviders().then((ranked) => {
      if (cancelled) return
      setRanking(ranked)
      const best = ranked[0]
      if (best) {
        setProviderId(best.id)
        setSpeedMs(best.ms)
        try {
          window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(best))
        } catch {
          /* 同上，忽略 */
        }
      }
      setDetecting(false)
    })

    return () => {
      cancelled = true
    }
  }, [requestedId])

  /** 供排障用：控制台里能直接看到是谁胜出、快多少 */
  useEffect(() => {
    if (!isAuto || !speedMs) return
    console.info(
      `[zxssxsc] 底图自动选源：${providerId}（${speedMs}ms）` +
        (ranking.length > 1
          ? `；对比 ${ranking.map((r) => `${r.id}:${r.ms}ms`).join(' / ')}`
          : ''),
    )
  }, [isAuto, providerId, speedMs, ranking])

  return { providerId, detecting, speedMs, ranking, autoSelected: isAuto }
}
