import { z } from 'zod';

export const createClientSchema = z.object({
  clientName:     z.string().min(1),
  businessName:   z.string().optional(),
  phone:          z.string().min(7),
  email:          z.string().email().optional().or(z.literal('')),
  city:           z.string().optional(),
  leadSource:     z.enum(['META_ADS','ORGANIC','REFERRAL','LEAD','ADS']).optional(),
  websiteUrl:     z.string().url().optional().or(z.literal('')),
  activeServices: z.string().optional(),
  packageAmount:  z.coerce.number().nonnegative().optional(),
  startDate:      z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  nextDueDate:    z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  status:         z.string().default('ACTIVE'),
  remarks:        z.string().optional(),
});

export const updateClientSchema = createClientSchema.partial();

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
