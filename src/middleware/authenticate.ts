import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import prisma from '../lib/prisma';

export interface AuthenticatedUser {
  id: number;
  role: 'ADMIN' | 'MANAGER' | 'SALES';
  name: string;
  email: string;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

interface JwtPayload {
  sub: number;
  role: 'ADMIN' | 'MANAGER' | 'SALES';
  name: string;
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header.' },
    });
    return;
  }

  const token = authHeader.slice(7);

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as unknown as JwtPayload;
  } catch {
    res.status(401).json({
      success: false,
      error: { code: 'TOKEN_INVALID', message: 'Access token is invalid or expired.' },
    });
    return;
  }

  // Re-validate user exists and is still active (never trust JWT alone)
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, name: true, email: true, role: true, status: true },
  });

  if (!user || user.status !== 'ACTIVE') {
    res.status(401).json({
      success: false,
      error: { code: 'USER_INACTIVE', message: 'User account is inactive or not found.' },
    });
    return;
  }

  req.user = { id: user.id, role: user.role, name: user.name, email: user.email };
  next();
}
