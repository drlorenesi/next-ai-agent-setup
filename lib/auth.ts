import { betterAuth } from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { admin } from "better-auth/plugins"
import { isEmailAllowed, parseAllowedDomains } from "@/lib/auth-allowlist"
import { getPool } from "@/lib/db/postgres"
import { sendVerificationEmail, sendResetEmail } from "@/lib/email"

const extraOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS
  ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((o) => o.trim())
  : []

// Email domains allowed to self-register. Empty = nobody can self-register.
const allowedDomains = parseAllowedDomains(process.env.AUTH_ALLOWED_EMAIL_DOMAINS)

export const auth = betterAuth({
  // Better Auth accepts a pg Pool directly. getPool() is the shared singleton
  // from lib/db/postgres.ts (DATABASE_URL, direct Neon endpoint).
  database: getPool(),
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [process.env.NEXT_PUBLIC_APP_URL!, ...extraOrigins],

  // Self-registration only for allowlisted domains (AUTH_ALLOWED_EMAIL_DOMAINS).
  // Users created by an admin (admin plugin's createUser) skip this on purpose.
  // Adding social providers or enabling user.changeEmail opens other ways to
  // get an account or email in: extend this check to cover them.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") return
      const email: unknown = ctx.body?.email
      if (typeof email !== "string" || !isEmailAllowed(email, allowedDomains)) {
        throw new APIError("FORBIDDEN", {
          message: "Este correo no está autorizado para registrarse.",
        })
      }
    }),
  },

  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email":   { window: 60, max: 5 },
      "/sign-up/email":   { window: 60, max: 3 },
      "/forget-password": { window: 60, max: 3 },
    },
  },

  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 60,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendResetEmail(user.email, url)
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, token }) => {
      const url = `${process.env.NEXT_PUBLIC_APP_URL}/verificar-email?token=${token}`
      await sendVerificationEmail(user.email, url)
    },
  },

  user: {
    additionalFields: {
      firstName: {
        type: "string",
        required: false,
        input: true,
      },
      lastName: {
        type: "string",
        required: false,
        input: true,
      },
    },
  },

  plugins: [admin()],
})

export type Session = typeof auth.$Infer.Session
