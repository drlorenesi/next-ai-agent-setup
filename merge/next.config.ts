// Template: replaces the scaffold's next.config.ts in the new project.
// Merge by hand if the scaffold's config already has options set.
import type { NextConfig } from "next"

// Applied to every response. Notes:
// - X-Robots-Tag is what keeps pages out of search results and caches;
//   app/robots.ts only asks well-behaved crawlers to stay away. Neither one is
//   protection: auth (and a network gate in front of the app) is.
// - Cache-Control isn't set here: Next.js overwrites it for pages. Pages that
//   read the session are dynamic and already sent with no-store.
// - The CSP has no script-src on purpose. A nonce-based script CSP makes every
//   page render dynamically; add it later as a separate step if needed.
const securityHeaders = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
  // Ignored by browsers over plain http (localhost).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Verification and password-reset URLs carry tokens: never send them on.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
}

export default nextConfig
