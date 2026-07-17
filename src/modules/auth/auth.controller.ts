import { Request, Response } from 'express';
import * as authService from './auth.service';
import { logger } from '../../config/logger';

const REFRESH_COOKIE = 'dfx_refresh';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;
    const result = await authService.loginUser(email, password);

    res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    res.json({ success: true, data: { accessToken: result.accessToken, user: result.user } });
  } catch (err: any) {
    if (err.message === 'INVALID_CREDENTIALS') {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
      });
      return;
    }
    logger.error('Login error', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Login failed.' } });
  }
}

export async function refresh(req: Request, res: Response): Promise<void> {
  try {
    const token: string | undefined = req.cookies?.[REFRESH_COOKIE];

    if (!token) {
      res.status(401).json({
        success: false,
        error: { code: 'NO_REFRESH_TOKEN', message: 'Refresh token not found.' },
      });
      return;
    }

    const result = await authService.refreshAccessToken(token);
    res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    res.json({ success: true, data: { accessToken: result.accessToken } });
  } catch (err: any) {
    res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS);
    res.status(401).json({
      success: false,
      error: { code: 'REFRESH_TOKEN_INVALID', message: 'Session expired. Please log in again.' },
    });
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
  if (token && req.user) {
    await authService.logoutUser(token, req.user.id).catch(() => {});
  }
  res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS);
  res.json({ success: true, data: { message: 'Logged out successfully.' } });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  try {
    const { email } = req.body;
    await authService.forgotPassword(email);
    // Always return 200 to prevent email enumeration
    res.json({ success: true, data: { message: 'If that email exists, a reset link has been sent.' } });
  } catch (err) {
    logger.error('Forgot password error', err);
    res.json({ success: true, data: { message: 'If that email exists, a reset link has been sent.' } });
  }
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  try {
    const { token, password } = req.body;
    await authService.resetPassword(token, password);
    res.json({ success: true, data: { message: 'Password reset successfully. Please log in.' } });
  } catch (err: any) {
    if (err.message === 'RESET_TOKEN_INVALID') {
      res.status(400).json({
        success: false,
        error: { code: 'RESET_TOKEN_INVALID', message: 'Reset link is invalid or has expired.' },
      });
      return;
    }
    logger.error('Reset password error', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Reset failed.' } });
  }
}
