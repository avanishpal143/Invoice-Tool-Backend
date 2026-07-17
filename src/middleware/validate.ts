import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

type Target = 'body' | 'query' | 'params';

/**
 * Zod validation middleware factory.
 *
 * Usage: router.post('/route', validate(MySchema), handler)
 *        router.get('/route', validate(QuerySchema, 'query'), handler)
 */
export function validate(schema: ZodSchema, target: Target = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const errors = (result.error as ZodError).errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));

      res.status(422).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Input validation failed.',
          details: errors,
        },
      });
      return;
    }

    // Replace the target with the parsed (type-safe, coerced) data
    (req as any)[target] = result.data;
    next();
  };
}
