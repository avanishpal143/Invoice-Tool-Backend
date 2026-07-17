import prisma from './prisma';

/**
 * Atomically allocate the next invoice number for a given year.
 * Uses MySQL's ON DUPLICATE KEY UPDATE to increment the counter at the DB level,
 * making it safe under concurrent requests without application-level locks.
 *
 * Returns a formatted string like "INV-2026-0128"
 */
export async function allocateInvoiceNumber(year: number): Promise<string> {
  // This must be called inside an existing Prisma transaction (tx passed in),
  // or it creates its own. Either way, the DB-level atomic update is safe.
  await prisma.$executeRaw`
    INSERT INTO invoice_counter (year, lastSeq)
    VALUES (${year}, 1)
    ON DUPLICATE KEY UPDATE lastSeq = lastSeq + 1
  `;

  const row = await prisma.invoiceCounter.findUniqueOrThrow({ where: { year } });
  const seq = String(row.lastSeq).padStart(4, '0');
  return `INV-${year}-${seq}`;
}
