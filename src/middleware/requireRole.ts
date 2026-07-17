import { Request, Response, NextFunction } from 'express';

type Role = 'ADMIN' | 'MANAGER' | 'SALES';

/**
 * Middleware factory that restricts a route to specific roles.
 * Must be used AFTER the `authenticate` middleware.
 *
 * Usage: router.get('/route', authenticate, requireRole(['ADMIN', 'MANAGER']), handler)
 */
export function requireRole(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated.' },
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Access denied. Required role: ${allowedRoles.join(' or ')}.`,
        },
      });
      return;
    }

    next();
  };
}
