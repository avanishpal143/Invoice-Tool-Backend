import puppeteer, { Browser } from 'puppeteer';
import { logger } from '../config/logger';

let browserInstance: Browser | null = null;
let launchPromise: Promise<Browser> | null = null;

/**
 * Returns a singleton Puppeteer browser instance.
 * Launches once on first call and reuses the same process for all subsequent PDF generations.
 */
async function getBrowser(): Promise<Browser> {
  if (browserInstance) {
    try {
      // Check the browser is still alive
      await browserInstance.version();
      return browserInstance;
    } catch {
      browserInstance = null;
      launchPromise = null;
    }
  }

  if (launchPromise) return launchPromise;

  launchPromise = puppeteer
    .launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    })
    .then((b) => {
      browserInstance = b;
      logger.info('Puppeteer browser launched');
      return b;
    })
    .catch((err) => {
      launchPromise = null;
      throw err;
    });

  return launchPromise;
}

/**
 * Renders an HTML string as a PDF Buffer (A4, with background graphics).
 */
export async function renderInvoicePdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(buffer);
  } finally {
    await page.close();
  }
}

/**
 * For the in-browser HTML preview — just returns the HTML string as-is.
 * Kept as a function so routes don't need to import the template directly.
 */
export function renderInvoiceHtml(html: string): string {
  return html;
}

/**
 * Gracefully close the browser on process exit.
 */
process.on('exit', () => {
  if (browserInstance) {
    browserInstance.close().catch(() => {});
  }
});
