import { z } from 'zod';

export const createLeadSchema = z.object({
  source:          z.enum(['META_ADS','ORGANIC','REFERRAL','LEAD','ADS']),
  date:            z.string().min(1, 'Date required'),
  name:            z.string().min(1),
  contactNumber:   z.string().min(7),
  email:           z.string().email().optional().or(z.literal('')),
  businessInfo:    z.string().optional(),
  requiredService: z.string().optional(),
  lastConversation:z.string().optional().nullable(),
  nextCall:        z.string().optional().nullable(),
  status:          z.enum(['NEW','WARM','HOLD','REFUSED','CONVERTED']).default('NEW'),
  proposalSent:    z.coerce.boolean().default(false),
  dealValue:       z.coerce.number().nonnegative().optional().nullable(),
  followUp1:       z.string().optional().nullable(),
  followUp2:       z.string().optional().nullable(),
  followUp3:       z.string().optional().nullable(),
  contactedById:   z.coerce.number().int().positive().optional().nullable(),
  remarks:         z.string().optional(),
});

export const updateLeadSchema = createLeadSchema.partial();

export const addNoteSchema = z.object({
  note: z.string().min(1, 'Note cannot be empty'),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
