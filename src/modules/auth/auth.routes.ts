import { Router } from 'express';
import { loginLimiter } from '../../middleware/rateLimiter';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import {
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.schema';
import * as authController from './auth.controller';

const router = Router();

router.post('/login', loginLimiter, validate(loginSchema), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authenticate, authController.logout);
router.post('/forgot-password', validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);

export default router;
