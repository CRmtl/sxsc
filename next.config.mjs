/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // 构建阶段不因 lint 阻断（CI 可单独跑 npm run lint）
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        // 浏览器 Geolocation 需要安全上下文；线上由 Vercel 提供 HTTPS。
        // 这里补一组安全响应头，并对瓦片/地理编码来源做最小化预连接提示。
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(self), camera=(), microphone=()',
          },
        ],
      },
    ]
  },
}

export default nextConfig
