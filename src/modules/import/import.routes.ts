import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import prisma from '../../lib/prisma';
import { logger } from '../../config/logger';
import {
  parseWorkbook,
  previewLeadImport,
  importLeads,
  previewClientImport,
  importClients,
  type ColumnMapping,
} from './import.service';

const router = Router();
router.use(authenticate, requireRole(['ADMIN']));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel', 'text/csv', 'application/csv', 'text/plain'];
    if (ok.includes(file.mimetype) || /\.(csv|xlsx|xls)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only CSV and XLSX files are supported'));
  },
});

function parseMapping(raw: unknown): ColumnMapping {
  if (!raw || typeof raw !== 'object') return {};
  return raw as ColumnMapping;
}

function getMapping(body: Record<string, unknown>): ColumnMapping {
  return parseMapping(typeof body.mapping === 'string' ? JSON.parse(body.mapping) : body.mapping);
}

// ─── Leads ────────────────────────────────────────────────────

router.post('/leads/headers', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) { res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded.' } }); return; }
  try {
    const { headers, rows } = parseWorkbook(req.file.buffer);
    res.json({ success: true, data: { headers, rowCount: rows.length, sample: rows.slice(0, 3) } });
  } catch (err: any) {
    res.status(422).json({ success: false, error: { code: 'PARSE_ERROR', message: `Cannot parse file: ${err.message}` } });
  }
});

router.post('/leads/preview', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) { res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded.' } }); return; }
  try {
    const preview = await previewLeadImport(req.file.buffer, getMapping(req.body));
    res.json({ success: true, data: preview });
  } catch (err: any) {
    logger.error('Lead preview error', err);
    res.status(422).json({ success: false, error: { code: 'PARSE_ERROR', message: err.message } });
  }
});

router.post('/leads', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) { res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded.' } }); return; }
  try {
    const overwrite = req.body.overwrite === 'true' || req.body.overwrite === true;
    const result = await importLeads(req.file.buffer, getMapping(req.body), overwrite);
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: 'CREATE', entityType: 'lead', entityId: 'BULK_IMPORT', afterValue: { imported: result.imported, skipped: result.skipped } as any },
    }).catch(() => {});
    res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error('Lead import error', err);
    res.status(500).json({ success: false, error: { code: 'IMPORT_ERROR', message: err.message } });
  }
});

// ─── Clients ─────────────────────────────────────────────────

router.post('/clients/headers', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) { res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded.' } }); return; }
  try {
    const { headers, rows } = parseWorkbook(req.file.buffer);
    res.json({ success: true, data: { headers, rowCount: rows.length, sample: rows.slice(0, 3) } });
  } catch (err: any) {
    res.status(422).json({ success: false, error: { code: 'PARSE_ERROR', message: `Cannot parse file: ${err.message}` } });
  }
});

router.post('/clients/preview', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) { res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded.' } }); return; }
  try {
    const preview = await previewClientImport(req.file.buffer, getMapping(req.body));
    res.json({ success: true, data: preview });
  } catch (err: any) {
    res.status(422).json({ success: false, error: { code: 'PARSE_ERROR', message: err.message } });
  }
});

router.post('/clients', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) { res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded.' } }); return; }
  try {
    const overwrite = req.body.overwrite === 'true' || req.body.overwrite === true;
    const result = await importClients(req.file.buffer, getMapping(req.body), overwrite);
    res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error('Client import error', err);
    res.status(500).json({ success: false, error: { code: 'IMPORT_ERROR', message: err.message } });
  }
});

export default router;
