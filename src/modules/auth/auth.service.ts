import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import prisma from '../../lib/prisma';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

// ─── Token helpers ──────────────────────────────────────────

function signAccessToken(userId: number, role: string, name: string): string {
  return jwt.sign(
    { sub: userId, role, name },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN } as jwt.SignOptions
  );
}

async function createRefreshToken(userId: number): Promise<string> {
  const token = crypto.randomBytes(64).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await prisma.refreshToken.create({
    data: { token, userId, expiresAt },
  });

  return token;
}

// ─── Auth operations ─────────────────────────────────────────

export async function loginUser(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.status !== 'ACTIVE') {
    throw new Error('INVALID_CREDENTIALS');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new Error('INVALID_CREDENTIALS');
  }

  const accessToken = signAccessToken(user.id, user.role, user.name);
  const refreshToken = await createRefreshToken(user.id);

  // Write login audit event
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'LOGIN',
      entityType: 'user',
      entityId: String(user.id),
    },
  });

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

export async function refreshAccessToken(token: string) {
  const stored = await prisma.refreshToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!stored || stored.revoked || stored.expiresAt < new Date()) {
    throw new Error('REFRESH_TOKEN_INVALID');
  }

  if (stored.user.status !== 'ACTIVE') {
    throw new Error('USER_INACTIVE');
  }

  // Rotate: revoke old, issue new
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
  const newRefreshToken = await createRefreshToken(stored.userId);
  const accessToken = signAccessToken(stored.user.id, stored.user.role, stored.user.name);

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logoutUser(token: string, userId: number) {
  await prisma.refreshToken.updateMany({
    where: { token, userId },
    data: { revoked: true },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'LOGOUT',
      entityType: 'user',
      entityId: String(userId),
    },
  });
}

export async function forgotPassword(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });

  // Always return success to prevent email enumeration
  if (!user || user.status !== 'ACTIVE') return;

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.passwordResetToken.create({
    data: { tokenHash, userId: user.id, expiresAt },
  });

  const resetUrl = `${env.FRONTEND_URL}/reset-password/${rawToken}`;

  if (!env.SMTP_HOST) {
    logger.info(`[DEV] Password reset link for ${email}: ${resetUrl}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject: 'Reset your Devlofox CRM password',
    html: `
      <p>Hi ${user.name},</p>
      <p>Click the link below to reset your password. This link expires in 1 hour.</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>If you didn't request this, ignore this email.</p>
    `,
  });
}

export async function resetPassword(rawToken: string, newPassword: string) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!record || record.used || record.expiresAt < new Date()) {
    throw new Error('RESET_TOKEN_INVALID');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { used: true } }),
    // Revoke all refresh tokens on password reset for security
    prisma.refreshToken.updateMany({ where: { userId: record.userId }, data: { revoked: true } }),
  ]);
}
