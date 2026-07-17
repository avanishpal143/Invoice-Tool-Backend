import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import { env } from '../../config/env';
import prisma from '../../lib/prisma';

const router = Router();
router.use(authenticate, requireRole(['ADMIN']));

// GET /settings
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const settings = await prisma.companySettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  res.json({ success: true, data: settings });
});

// PATCH /settings
router.patch('/', async (req: Request, res: Response): Promise<void> => {
  const settings = await prisma.companySettings.upsert({
    where: { id: 1 },
    update: req.body,
    create: { id: 1, ...req.body },
  });
  res.json({ success: true, data: settings });
});

// POST /settings/logo — multer upload
const uploadsDir = path.resolve(env.UPLOADS_DIR);
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `logo-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

router.post('/logo', upload.single('logo'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded.' } });
    return;
  }

  const logoUrl = `/uploads/${req.file.filename}`;

  // Delete old logo file if one exists
  const existing = await prisma.companySettings.findUnique({ where: { id: 1 } });
  if (existing?.logoUrl) {
    const oldPath = path.join(uploadsDir, path.basename(existing.logoUrl));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  const settings = await prisma.companySettings.upsert({
    where: { id: 1 },
    update: { logoUrl },
    create: { id: 1, logoUrl },
  });

  res.json({ success: true, data: settings });
});

export default router;
