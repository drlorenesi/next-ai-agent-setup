import type { MetadataRoute } from "next"

// Serves /robots.txt asking every crawler to stay out. This is a request, not
// protection: malicious bots ignore it. The X-Robots-Tag header in
// next.config.ts keeps pages out of search indexes; auth protects the data.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  }
}
