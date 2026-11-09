// Email-domain allowlist for self-registration (AUTH_ALLOWED_EMAIL_DOMAINS).
// Pure module: no Next.js or Better Auth imports, so it is type-checked and
// unit-tested in the kit. lib/auth.ts uses it in a `/sign-up/email` hook.

const DOMAIN_ENTRY = /^@[a-z0-9-]+(\.[a-z0-9-]+)+$/

/**
 * Parses a comma-separated list like "@mycompany1.com, @mycompany2.com" into
 * lowercase domains without the "@". Entries that aren't "@domain.tld" are
 * dropped, so a typo narrows the list instead of widening it.
 */
export function parseAllowedDomains(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => DOMAIN_ENTRY.test(entry))
    .map((entry) => entry.slice(1))
}

/**
 * True when the email's domain exactly matches an allowed domain. No subdomain
 * or suffix matching. An empty list allows nobody (fails closed).
 */
export function isEmailAllowed(email: string, domains: readonly string[]): boolean {
  const normalized = email.trim().toLowerCase()
  const at = normalized.lastIndexOf("@")
  if (at <= 0 || at === normalized.length - 1) return false
  return domains.includes(normalized.slice(at + 1))
}
