/**
 * 环境变量体检（服务端专用）。
 *
 * 起因：用户明明在 .env.local 里填了 AMAP_WEB_KEY，页面却还是提示「未配置」。
 * 这类问题靠猜是查不出来的 —— 可能是变量名多写了 NEXT_PUBLIC_ 前缀、
 * 可能写进了别的文件、可能文件带 BOM 导致第一行的变量名变成了
 * "\uFEFFAMAP_WEB_KEY"、也可能是改了 Vercel 变量但没重新部署。
 *
 * 所以这里把「服务端进程实际看到了什么」直接展示出来。
 *
 * ⚠️ 安全约束：**只输出变量名、文件名、大小、布尔判断，绝不输出任何变量值。**
 * 连长度都不报 —— 长度也是可以缩小猜测空间的信息。
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 期望的高德 Key 变量名 */
export const AMAP_KEY_ENV_NAME = 'AMAP_WEB_KEY'

export interface EnvFileReport {
  name: string
  bytes: number
  /** 文件里是否存在变量名恰好等于 AMAP_WEB_KEY 的行 */
  containsAmapKey: boolean
  /** 文件是否以 UTF-8 BOM 开头（会让第一行的变量名带 \uFEFF） */
  hasBom: boolean
}

export interface EnvDiagnosis {
  expected: string
  configured: boolean
  presentButBlank: boolean
  /** 进程环境里所有名字含 amap 的变量名（只报名字） */
  amapLikeNames: string[]
  /** 名字带首尾空格或 BOM 等脏字符的情况 */
  suspiciousNames: string[]
  /** 非生产环境才返回：环境文件体检 */
  envFiles?: EnvFileReport[]
  /** 非生产环境才返回 */
  cwd?: string
  nodeEnv: string
  /** 给人看的下一步建议 */
  hints: string[]
}

const CANDIDATE_ENV_FILES = [
  '.env.local',
  '.env.development.local',
  '.env.production.local',
  '.env',
]

function inspectEnvFile(path: string, name: string): EnvFileReport | null {
  if (!existsSync(path)) return null
  try {
    const buf = readFileSync(path)
    const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
    const text = buf.toString('utf8').replace(/^\uFEFF/, '')
    const containsAmapKey = text.split('\n').some((raw) => {
      const line = raw.trim()
      if (!line || line.startsWith('#')) return false
      const eq = line.indexOf('=')
      if (eq < 0) return false
      // 注意这里要求**去掉首尾空白后精确相等**，
      // 就是为了能识别出「AMAP_WEB_KEY 」这种带尾空格的写法
      return line.slice(0, eq).trim() === AMAP_KEY_ENV_NAME
    })
    return { name, bytes: statSync(path).size, containsAmapKey, hasBom }
  } catch {
    return { name, bytes: 0, containsAmapKey: false, hasBom: false }
  }
}

/** 体检高德 Key 的可见性 */
export function diagnoseAmapKey(): EnvDiagnosis {
  const raw = process.env[AMAP_KEY_ENV_NAME]
  const configured = typeof raw === 'string' && raw.trim() !== ''
  const presentButBlank = raw !== undefined && !configured

  const amapLikeNames = Object.keys(process.env).filter((k) => /amap/i.test(k))

  // 常见脏数据：名字前后有空白、名字里混进了 BOM、大小写不一致
  const suspiciousNames = amapLikeNames.filter(
    (k) => k !== k.trim() || k.includes('\uFEFF') || k !== k.toUpperCase(),
  )

  const isProd = process.env.NODE_ENV === 'production'
  const cwd = process.cwd()

  const hints: string[] = []
  if (configured) {
    hints.push('服务端已读到 AMAP_WEB_KEY，可以正常调用高德接口。')
  } else if (presentButBlank) {
    hints.push('AMAP_WEB_KEY 存在但是空值，请确认等号后面真的填了内容。')
  } else if (amapLikeNames.length > 0) {
    hints.push(
      `没有名为 AMAP_WEB_KEY 的变量，但发现了形似的名字：${amapLikeNames
        .map((n) => `"${n}"`)
        .join('、')}。请核对拼写，并去掉多余的 NEXT_PUBLIC_ 前缀。`,
    )
  } else {
    hints.push(
      '服务端进程里完全看不到任何 AMAP 相关变量。请依次确认：① 是否写在项目根目录的 .env.local（不是 .env.example、也不是别的目录）；② 改完是否**真正重启**了 dev server（端口被旧进程占用会导致新进程没起来，旧进程继续服务）；③ 如果看的是 Vercel 线上站，改环境变量后必须**重新部署**才生效。',
    )
  }

  const result: EnvDiagnosis = {
    expected: AMAP_KEY_ENV_NAME,
    configured,
    presentButBlank,
    amapLikeNames,
    suspiciousNames,
    nodeEnv: process.env.NODE_ENV ?? '(未设置)',
    hints,
  }

  // 文件体检与 cwd 只在非生产环境返回：
  // 线上环境变量来自平台，磁盘上没有 .env 文件，这两项既无用又多余地暴露路径。
  if (!isProd) {
    result.envFiles = CANDIDATE_ENV_FILES.map((n) =>
      inspectEnvFile(join(cwd, n), n),
    ).filter((x): x is EnvFileReport => x !== null)
    result.cwd = cwd

    const local = result.envFiles.find((f) => f.name === '.env.local')
    if (!configured && local) {
      if (local.hasBom) {
        hints.push(
          '.env.local 带 UTF-8 BOM。若 AMAP_WEB_KEY 写在第一行，它的变量名会变成 "\\uFEFFAMAP_WEB_KEY" 而读不到。请把该文件另存为「UTF-8 无 BOM」，或把这一行移到文件中间。',
        )
      }
      if (!local.containsAmapKey) {
        hints.push(`项目根的 .env.local 里没有 AMAP_WEB_KEY 这一行（当前 ${local.bytes} 字节）。`)
      }
    }
  }

  return result
}

/** 给用户看的一句话摘要，用于拼进接口错误信息 */
export function summarizeAmapKeyProblem(d: EnvDiagnosis): string {
  if (d.configured) return ''
  if (d.presentButBlank) return '（AMAP_WEB_KEY 存在但为空值）'
  if (d.amapLikeNames.length > 0) {
    return `（服务端只看到形似的变量名：${d.amapLikeNames.join('、')}）`
  }
  return '（服务端进程里没有任何 AMAP 相关变量，请确认写入的文件位置并真正重启服务；若看的是线上站，改环境变量后需重新部署）'
}
