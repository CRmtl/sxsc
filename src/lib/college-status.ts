/**
 * 大学放假状态的展示色。
 *
 * 这个常量**必须**住在不依赖 Leaflet 的模块里。
 * 早先它放在 components/map/college-markers.tsx，而那个文件顶层有
 * `import L from 'leaflet'`（Leaflet 在模块求值期就会访问 window）。
 * 结果任何「值导入」该常量的服务端组件都会连带把 Leaflet 拉进 SSR 包，
 * 直接 `ReferenceError: window is not defined`，导致首页 500。
 *
 * 结论：地图图层文件只能被 'use client' 组件**动态**引入，
 * 其中可复用的纯数据/常量要单独抽出来。
 */

import type { CollegeStatus } from './types'

/**
 * 配色按需求调整：
 *   未放假 → 灰（弱化，表示「没什么可看」）
 *   假期中 → 橙（唯一需要被一眼看到的强状态）
 *   已开学 → 绿
 *
 * 注：需求原文写的是「已放假（绿色）、未放假（灰色）、假期中（橙色）」，
 * 其中「已放假」与「假期中」语义重叠。这里按三态模型取
 * 未放假/假期中/已开学，第三态用绿色。
 */
export const COLLEGE_STATUS_COLORS: Record<CollegeStatus, string> = {
  before: '#64748b', // 未放假
  during: '#f59e0b', // 假期中
  after: '#16a34a', // 已开学
}
