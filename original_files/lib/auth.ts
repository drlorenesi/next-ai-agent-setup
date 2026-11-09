import { betterAuth } from "better-auth"
import { admin } from "better-auth/plugins"
import pool from "@/lib/db"
import { sendVerificationEmail, sendResetEmail } from "@/lib/email"

const extraOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS
  ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((o) => o.trim())
  : []

export const auth = betterAuth({
  database: pool,
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [process.env.NEXT_PUBLIC_APP_URL!, ...extraOrigins],

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
