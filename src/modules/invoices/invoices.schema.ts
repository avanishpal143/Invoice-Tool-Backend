import { z } from 'zod';

export const invoiceItemSchema = z.object({
  description: z.string().min(1),
  qty:         z.coerce.number().positive(),
  rate:        z.coerce.number().nonnegative(),
});

export const createInvoiceSchema = z.object({
  clientId:    z.coerce.number().int().positive(),
  invoiceDate: z.string().min(1),
  dueDate:     z.string().min(1),
  discount:    z.coerce.number().nonnegative().default(0),
  taxOverride: z.coerce.number().nonnegative().optional(),
  notes:       z.string().optional(),
  items:       z.array(invoiceItemSchema).min(1, 'At least one line item required'),
});

export const updateInvoiceSchema = z.object({
  invoiceDate: z.string().optional(),
  dueDate:     z.string().optional(),
  discount:    z.coerce.number().nonnegative().optional(),
  taxOverride: z.coerce.number().nonnegative().optional(),
  notes:       z.string().optional(),
  items:       z.array(invoiceItemSchema).min(1).optional(),
});

export const recordPaymentSchema = z.object({
  amount:  z.coerce.number().positive(),
  date:    z.string().min(1),
  mode:    z.enum(['UPI', 'BANK', 'CASH', 'CHEQUE']),
  notes:   z.string().optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
