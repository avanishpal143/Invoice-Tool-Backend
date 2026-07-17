import { LeadSource, LeadStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import prisma from '../../lib/prisma';

// ─── Types ────────────────────────────────────────────────────

export interface ColumnMapping {
  [schemaField: string]: string; // schemaField -> headerInFile
}

export interface ImportPreview {
  totalRows:   number;
  validRows:   number;
  invalidRows: { row: number; errors: string[] }[];
  duplicates:  { row: number; field: string; value: string }[];
  sampleData:  Record<string, unknown>[];
  headers:     string[];
}

export interface ImportResult {
  imported: number;
  skipped:  number;
  errors:   { row: number; error: string }[];
}

// ─── XLSX parsing ─────────────────────────────────────────────

export function parseWorkbook(buffer: Buffer): { headers: string[]; rows: Record<string, unknown>[] } {
  const wb   = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const raw  = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const headers = raw.length > 0 ? Object.keys(raw[0]) : [];
  return { headers, rows: raw };
}

// ─── Apply column mapping ─────────────────────────────────────

function applyMapping(row: Record<string, unknown>, mapping: ColumnMapping): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [schemaField, fileHeader] of Object.entries(mapping)) {
    if (fileHeader && fileHeader in row) {
      out[schemaField] = row[fileHeader];
    }
  }
  return out;
}

// ─── Lead import helpers ──────────────────────────────────────

const LEAD_SOURCE_MAP: Record<string, string> = {
  'meta ads': 'META_ADS', 'meta': 'META_ADS', 'facebook': 'META_ADS',
  'organic': 'ORGANIC', 'seo': 'ORGANIC',
  'referral': 'REFERRAL', 'reference': 'REFERRAL',
  'lead': 'LEAD',
  'ads': 'ADS', 'google ads': 'ADS', 'google': 'ADS',
};
const LEAD_STATUS_MAP: Record<string, string> = {
  'new': 'NEW', 'warm': 'WARM', 'hot': 'WARM',
  'hold': 'HOLD', 'on hold': 'HOLD',
  'refused': 'REFUSED', 'not interested': 'REFUSED',
  'converted': 'CONVERTED', 'client': 'CONVERTED',
};

function normalizeSource(v: unknown): string {
  const s = String(v ?? '').toLowerCase().trim();
  return LEAD_SOURCE_MAP[s] ?? 'LEAD';
}
function normalizeLeadStatus(v: unknown): string {
  const s = String(v ?? '').toLowerCase().trim();
  return LEAD_STATUS_MAP[s] ?? 'NEW';
}
function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}
function parseNum(v: unknown): number | null {
  const n = parseFloat(String(v ?? ''));
  return isNaN(n) ? null : n;
}

// ─── Leads dry-run ────────────────────────────────────────────

export async function previewLeadImport(
  buffer: Buffer,
  mapping: ColumnMapping
): Promise<ImportPreview> {
  const { headers, rows } = parseWorkbook(buffer);
  const invalidRows: ImportPreview['invalidRows'] = [];
  const duplicates:  ImportPreview['duplicates']  = [];
  let validRows = 0;

  // Batch duplicate check against DB
  const phones = rows
    .map(r => String(applyMapping(r, mapping).contactNumber ?? '').trim())
    .filter(Boolean);
  const existingPhones = new Set(
    (await prisma.lead.findMany({ where: { contactNumber: { in: phones } }, select: { contactNumber: true } }))
      .map(l => l.contactNumber)
  );

  for (let i = 0; i < rows.length; i++) {
    const mapped = applyMapping(rows[i], mapping);
    const errs: string[] = [];

    if (!String(mapped.name ?? '').trim()) errs.push('name is required');
    const phone = String(mapped.contactNumber ?? '').trim();
    if (!phone) errs.push('contactNumber is required');

    if (errs.length > 0) {
      invalidRows.push({ row: i + 2, errors: errs });
    } else {
      validRows++;
      if (phone && existingPhones.has(phone)) {
        duplicates.push({ row: i + 2, field: 'contactNumber', value: phone });
      }
    }
  }

  return {
    totalRows:  rows.length,
    validRows,
    invalidRows,
    duplicates,
    sampleData: rows.slice(0, 5).map(r => applyMapping(r, mapping)),
    headers,
  };
}

// ─── Leads actual import ──────────────────────────────────────

export async function importLeads(
  buffer: Buffer,
  mapping: ColumnMapping,
  overwrite = false
): Promise<ImportResult> {
  const { rows } = parseWorkbook(buffer);
  let imported = 0, skipped = 0;
  const errors: ImportResult['errors'] = [];

  // Existing phones for duplicate check
  const phones = rows.map(r => String(applyMapping(r, mapping).contactNumber ?? '').trim()).filter(Boolean);
  const existingMap = new Map(
    (await prisma.lead.findMany({ where: { contactNumber: { in: phones } }, select: { id: true, contactNumber: true } }))
      .map(l => [l.contactNumber, l.id])
  );

  for (let i = 0; i < rows.length; i++) {
    const mapped = applyMapping(rows[i], mapping);
    const name  = String(mapped.name ?? '').trim();
    const phone = String(mapped.contactNumber ?? '').trim();

    if (!name || !phone) { errors.push({ row: i + 2, error: 'Missing name or phone' }); continue; }

    if (existingMap.has(phone) && !overwrite) { skipped++; continue; }

    try {
      const data = {
        source:          normalizeSource(mapped.source) as LeadSource,
        date:            parseDate(mapped.date) ?? new Date(),
        name,
        contactNumber:   phone,
        email:           String(mapped.email ?? '').trim() || null,
        businessInfo:    String(mapped.businessInfo ?? '').trim() || null,
        requiredService: String(mapped.requiredService ?? '').trim() || null,
        status:          normalizeLeadStatus(mapped.status) as LeadStatus,
        dealValue:       parseNum(mapped.dealValue),
        remarks:         String(mapped.remarks ?? '').trim() || null,
        proposalSent:    false,
      };

      if (existingMap.has(phone) && overwrite) {
        await prisma.lead.update({ where: { id: existingMap.get(phone)! }, data });
      } else {
        await prisma.lead.create({ data });
      }
      imported++;
    } catch (err: any) {
      errors.push({ row: i + 2, error: err.message?.slice(0, 120) ?? 'Unknown error' });
    }
  }

  return { imported, skipped, errors };
}

// ─── Clients dry-run + import ─────────────────────────────────

export async function previewClientImport(
  buffer: Buffer,
  mapping: ColumnMapping
): Promise<ImportPreview> {
  const { headers, rows } = parseWorkbook(buffer);
  const invalidRows: ImportPreview['invalidRows'] = [];
  const duplicates:  ImportPreview['duplicates']  = [];
  let validRows = 0;

  const emails = rows.map(r => String(applyMapping(r, mapping).email ?? '').trim()).filter(Boolean);
  const existingEmails = new Set(
    (await prisma.client.findMany({ where: { email: { in: emails } }, select: { email: true } }))
      .map(c => c.email!)
  );

  for (let i = 0; i < rows.length; i++) {
    const mapped = applyMapping(rows[i], mapping);
    const errs: string[] = [];
    if (!String(mapped.clientName ?? '').trim()) errs.push('clientName is required');
    if (!String(mapped.phone ?? '').trim()) errs.push('phone is required');

    if (errs.length > 0) { invalidRows.push({ row: i + 2, errors: errs }); }
    else {
      validRows++;
      const email = String(mapped.email ?? '').trim();
      if (email && existingEmails.has(email)) {
        duplicates.push({ row: i + 2, field: 'email', value: email });
      }
    }
  }

  return { totalRows: rows.length, validRows, invalidRows, duplicates, sampleData: rows.slice(0, 5).map(r => applyMapping(r, mapping)), headers };
}

export async function importClients(
  buffer: Buffer,
  mapping: ColumnMapping,
  overwrite = false
): Promise<ImportResult> {
  const { rows } = parseWorkbook(buffer);
  let imported = 0, skipped = 0;
  const errors: ImportResult['errors'] = [];

  const emails = rows.map(r => String(applyMapping(r, mapping).email ?? '').trim()).filter(Boolean);
  const existingMap = new Map(
    (await prisma.client.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } }))
      .map(c => [c.email!, c.id])
  );
  const existingCount = await prisma.client.count();

  for (let i = 0; i < rows.length; i++) {
    const mapped = applyMapping(rows[i], mapping);
    const clientName = String(mapped.clientName ?? '').trim();
    const phone      = String(mapped.phone ?? '').trim();
    const email      = String(mapped.email ?? '').trim() || null;

    if (!clientName || !phone) { errors.push({ row: i + 2, error: 'Missing clientName or phone' }); continue; }

    if (email && existingMap.has(email) && !overwrite) { skipped++; continue; }

    try {
      const clientCode = String(mapped.clientCode ?? '').trim() || `DFX-${String(existingCount + imported + 1).padStart(3,'0')}`;
      const data = {
        clientName, phone, email,
        businessName:   String(mapped.businessName   ?? '').trim() || null,
        city:           String(mapped.city            ?? '').trim() || null,
        activeServices: String(mapped.activeServices  ?? '').trim() || null,
        packageAmount:  parseNum(mapped.packageAmount),
        status:         'ACTIVE',
      };

      if (email && existingMap.has(email) && overwrite) {
        await prisma.client.update({ where: { id: existingMap.get(email)! }, data });
      } else {
        // Ensure unique clientCode
        const exists = await prisma.client.findUnique({ where: { clientCode } });
        const finalCode = exists ? `DFX-${String(existingCount + imported + 100).padStart(3,'0')}` : clientCode;
        await prisma.client.create({ data: { ...data, clientCode: finalCode } });
      }
      imported++;
    } catch (err: any) {
      errors.push({ row: i + 2, error: err.message?.slice(0, 120) ?? 'Unknown error' });
    }
  }

  return { imported, skipped, errors };
}
