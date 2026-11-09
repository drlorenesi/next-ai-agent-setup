import nodemailer from "nodemailer"

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export async function sendVerificationEmail(to: string, url: string) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Verifica tu correo electrónico",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Verifica tu correo electrónico</h2>
        <p>Haz clic en el enlace de abajo para verificar tu cuenta:</p>
        <a
          href="${url}"
          style="display: inline-block; padding: 12px 24px; background-color: #000; color: #fff; text-decoration: none; border-radius: 6px;"
        >
          Verificar correo
        </a>
        <p style="margin-top: 16px; color: #666; font-size: 14px;">
          Si no creaste una cuenta, puedes ignorar este correo.
        </p>
        <p style="color: #666; font-size: 14px;">
          El enlace expirará en 24 horas.
        </p>
      </div>
    `,
  })
}

export async function sendResetEmail(to: string, url: string) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Restablece tu contraseña",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Restablece tu contraseña</h2>
        <p>Haz clic en el enlace de abajo para crear una nueva contraseña:</p>
        <a
          href="${url}"
          style="display: inline-block; padding: 12px 24px; background-color: #000; color: #fff; text-decoration: none; border-radius: 6px;"
        >
          Restablecer contraseña
        </a>
        <p style="margin-top: 16px; color: #666; font-size: 14px;">
          Si no solicitaste este cambio, puedes ignorar este correo.
        </p>
        <p style="color: #666; font-size: 14px;">
          El enlace expirará en 1 hora.
        </p>
      </div>
    `,
  })
}
