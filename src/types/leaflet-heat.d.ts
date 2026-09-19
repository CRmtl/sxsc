/**
 * leaflet.heat 没有官方类型声明，这里补上。
 * 它通过 `import 'leaflet.heat'` 的方式**给 L 增加** heatLayer 工厂函数。
 */

import 'leaflet'

declare module 'leaflet' {
  export interface HeatLayerOptions {
    /** 最小不透明度，默认 0.05 */
    minOpacity?: number
    /** 超过该缩放级别后点不再变大，默认 18 */
    maxZoom?: number
    /** 密度上限，默认 1.0 */
    max?: number
    /** 每个点的半径，默认 25 */
    radius?: number
    /** 模糊度，默认 15 */
    blur?: number
    /** 颜色梯度，键为 0~1 的密度阈值 */
    gradient?: Record<number, string>
  }

  export class HeatLayer extends Layer {
    constructor(latlngs: Array<[number, number, number?]>, options?: HeatLayerOptions)
    setLatLngs(latlngs: Array<[number, number, number?]>): this
    addLatLng(latlng: [number, number, number?]): this
    setOptions(options: HeatLayerOptions): this
    redraw(): this
  }

  export function heatLayer(
    latlngs: Array<[number, number, number?]>,
    options?: HeatLayerOptions,
  ): HeatLayer
}

declare module 'leaflet.heat'
