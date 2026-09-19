/**
 * API 路由的统一响应封装与请求工具。
 */

import { NextResponse } from 'next/server'
import { clientIpFromHeaders } from './anti-abuse'

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(
    { ok: true, data },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

export function fail(
  error: string,
  status = 400,
  code = 'bad_request',
  field?: string,
) {
  return NextResponse.json(
    { ok: false, error, code, ...(field ? { field } : {}) },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

/** 安全地解析 JSON body */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

export function ipOf(request: Request): string {
  return clientIpFromHeaders(request.headers)
}

/**
 * 把各种异常统一翻译成给用户看的中文提示，
 * 并且**不把内部错误细节泄露到响应里**（只在服务端日志打印）。
 */
export function handleUnexpected(scope: string, err: unknown) {
  console.error(`[${scope}]`, err)
  const message = err instanceof Error ? err.message : String(err)
  // DataError 的消息是特意写成用户可读的，可以直接透出
  if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code) {
    return fail(message, 400, (err as { code: string }).code)
  }
  return fail('服务器开小差了，请稍后重试。', 500, 'server_error')
}
