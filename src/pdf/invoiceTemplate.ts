/**
 * Builds a fully self-contained A4 HTML string for an invoice.
 * All styles are inline / inside a <style> block — no external CSS.
 * This same template is used for both PDF export and in-browser preview.
 */

interface InvoiceItem {
  description: string;
  qty: number | string;
  rate: number | string;
  amount: number | string;
}

interface Client {
  clientName: string;
  businessName?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  clientCode?: string | null;
}

interface InvoiceData {
  invoiceNo: string;
  invoiceDate: Date | string;
  dueDate: Date | string;
  status: string;
  subtotal: number | string;
  discount: number | string;
  tax: number | string;
  total: number | string;
  notes?: string | null;
  items: InvoiceItem[];
  client: Client;
  createdBy?: { name: string } | null;
}

interface CompanySettings {
  companyName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  bankAccountName?: string | null;
  bankAccountNo?: string | null;
  bankName?: string | null;
  ifsc?: string | null;
  upiId?: string | null;
  gstin?: string | null;
  gstPercent?: number | string | null;
  defaultPaymentTermsDays?: number | null;
}

// ─── Formatters ───────────────────────────────────────────────

function formatINR(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return '₹0.00';
  const num = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
  if (isNaN(num)) return '₹0.00';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(num);
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d));
}

function toNum(v: number | string): number {
  return typeof v === 'string' ? parseFloat(v) : v;
}

// ─── Status ribbon ────────────────────────────────────────────

function ribbonColor(status: string): string {
  switch (status) {
    case 'PAID':    return '#1A9C5C';
    case 'OVERDUE': return '#C0392B';
    case 'VOID':    return '#6B7280';
    case 'PARTIAL': return '#B8860B';
    default:        return '#6B7280';
  }
}

// ─── Main template builder ────────────────────────────────────

export function buildInvoiceHtml(invoice: InvoiceData, settings: CompanySettings | null): string {
  const co = settings ?? {};
  const client = invoice.client;

  const subtotal  = toNum(invoice.subtotal as number);
  const discount  = toNum(invoice.discount as number);
  const tax       = toNum(invoice.tax as number);
  const total     = toNum(invoice.total as number);
  const gstPct    = co.gstPercent ? toNum(co.gstPercent as number) : 18;
  const taxLabel  = co.gstin ? `GST (${gstPct}%)` : 'Tax';
  const showGst   = tax > 0;

  const payTerms  = co.defaultPaymentTermsDays ?? 30;
  const ribbonBg  = ribbonColor(invoice.status);

  const zebra = (i: number) => i % 2 === 0 ? '#ffffff' : '#f4f8fe';

  const itemRows = invoice.items.map((item, i) => `
    <tr style="background:${zebra(i)};">
      <td style="padding:8px 10px;text-align:center;color:#6B7280;">${i + 1}</td>
      <td style="padding:8px 10px;">${escHtml(item.description)}</td>
      <td style="padding:8px 10px;text-align:center;">${toNum(item.qty as number)}</td>
      <td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums;">${formatINR(item.rate)}</td>
      <td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${formatINR(item.amount)}</td>
    </tr>`).join('');

  const companyAddress = [co.addressLine1, co.addressLine2, co.city, co.state, co.pincode].filter(Boolean).join(', ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Invoice ${escHtml(invoice.invoiceNo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Inter',sans-serif;font-size:13px;color:#0A1F3C;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .page{width:210mm;min-height:297mm;margin:0 auto;padding:0;position:relative;}
  table{border-collapse:collapse;width:100%;}
  @media print{body{margin:0;}@page{size:A4;margin:0;}}
</style>
</head>
<body>
<div class="page">

  <!-- ═══ HEADER BAND ═══════════════════════════════════════════ -->
  <div style="background:#12335C;padding:22px 28px;display:flex;justify-content:space-between;align-items:center;position:relative;overflow:hidden;">
    <!-- Logo + company -->
    <div style="display:flex;align-items:center;gap:14px;">
      <div style="width:44px;height:44px;background:#0099FA;border-radius:10px;display:flex;align-items:center;justify-content:center;">
        <span style="color:#fff;font-size:22px;font-weight:700;">D</span>
      </div>
      <div>
        <div style="color:#fff;font-size:16px;font-weight:700;letter-spacing:-0.3px;">Devlofox Technologies LLP</div>
        <div style="color:rgba(255,255,255,0.6);font-size:10px;margin-top:2px;">Web Design &amp; Marketing Services</div>
      </div>
    </div>
    <!-- Title -->
    <div style="text-align:right;">
      <div style="color:#fff;font-size:26px;font-weight:700;letter-spacing:1px;">INVOICE</div>
      <div style="color:rgba(255,255,255,0.5);font-size:10px;margin-top:3px;">${escHtml(invoice.invoiceNo)}</div>
    </div>
    <!-- Status ribbon -->
    <div style="position:absolute;top:12px;right:-18px;width:90px;transform:rotate(45deg);background:${ribbonBg};color:#fff;text-align:center;font-size:9px;font-weight:700;letter-spacing:1.2px;padding:4px 0;box-shadow:0 2px 6px rgba(0,0,0,0.3);">
      ${invoice.status}
    </div>
  </div>

  <!-- ═══ META STRIP ════════════════════════════════════════════ -->
  <div style="background:#EEF4FC;padding:10px 28px;display:flex;gap:0;border-bottom:1px solid #D7E2EF;">
    ${metaCol('Invoice No.', invoice.invoiceNo)}
    ${metaCol('Invoice Date', formatDate(invoice.invoiceDate))}
    ${metaCol('Due Date', formatDate(invoice.dueDate))}
    ${metaCol('Status', invoice.status)}
  </div>

  <!-- ═══ INFO BLOCK ════════════════════════════════════════════ -->
  <div style="display:flex;padding:20px 28px;gap:0;border-bottom:1px solid #D7E2EF;">
    <!-- Bill To -->
    <div style="flex:1;padding-right:20px;">
      <div style="font-size:9px;font-weight:700;letter-spacing:1px;color:#6B7280;text-transform:uppercase;margin-bottom:8px;">Bill To</div>
      <div style="font-size:14px;font-weight:700;color:#0A1F3C;">${escHtml(client.clientName)}</div>
      ${client.businessName ? `<div style="font-size:12px;color:#6B7280;">${escHtml(client.businessName)}</div>` : ''}
      ${client.phone ? `<div style="font-size:12px;color:#6B7280;margin-top:4px;">📞 ${escHtml(client.phone)}</div>` : ''}
      ${client.email ? `<div style="font-size:12px;color:#6B7280;">✉ ${escHtml(client.email)}</div>` : ''}
      ${client.city ? `<div style="font-size:12px;color:#6B7280;">${escHtml(client.city)}</div>` : ''}
    </div>
    <!-- From -->
    <div style="flex:1;padding:0 20px;border-left:1px solid #D7E2EF;">
      <div style="font-size:9px;font-weight:700;letter-spacing:1px;color:#6B7280;text-transform:uppercase;margin-bottom:8px;">From</div>
      <div style="font-size:14px;font-weight:700;color:#0A1F3C;">${escHtml(co.companyName ?? 'Devlofox Technologies LLP')}</div>
      ${companyAddress ? `<div style="font-size:12px;color:#6B7280;margin-top:4px;">${escHtml(companyAddress)}</div>` : ''}
      ${co.phone ? `<div style="font-size:12px;color:#6B7280;margin-top:4px;">📞 ${escHtml(co.phone)}</div>` : ''}
      ${co.email ? `<div style="font-size:12px;color:#6B7280;">✉ ${escHtml(co.email)}</div>` : ''}
      ${co.gstin ? `<div style="font-size:10px;color:#6B7280;margin-top:4px;">GSTIN: ${escHtml(co.gstin)}</div>` : ''}
    </div>
    <!-- Service Period -->
    <div style="flex:1;padding-left:20px;border-left:1px solid #D7E2EF;">
      <div style="font-size:9px;font-weight:700;letter-spacing:1px;color:#6B7280;text-transform:uppercase;margin-bottom:8px;">Service Period</div>
      <div style="font-size:12px;color:#0A1F3C;">${new Date(invoice.invoiceDate).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</div>
      ${client.clientCode ? `<div style="font-size:11px;color:#6B7280;margin-top:4px;">Client ID: ${escHtml(client.clientCode)}</div>` : ''}
      ${invoice.createdBy ? `<div style="font-size:11px;color:#6B7280;margin-top:4px;">Account Manager: ${escHtml(invoice.createdBy.name)}</div>` : ''}
    </div>
  </div>

  <!-- ═══ LINE ITEMS TABLE ══════════════════════════════════════ -->
  <div style="padding:0 28px;margin-top:20px;">
    <table>
      <thead>
        <tr style="background:#12335C;">
          <th style="padding:10px;text-align:center;color:#fff;font-size:11px;font-weight:600;width:40px;">#</th>
          <th style="padding:10px;text-align:left;color:#fff;font-size:11px;font-weight:600;">Description</th>
          <th style="padding:10px;text-align:center;color:#fff;font-size:11px;font-weight:600;width:60px;">Qty</th>
          <th style="padding:10px;text-align:right;color:#fff;font-size:11px;font-weight:600;width:110px;">Rate</th>
          <th style="padding:10px;text-align:right;color:#fff;font-size:11px;font-weight:600;width:110px;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
  </div>

  <!-- ═══ TOTALS ════════════════════════════════════════════════ -->
  <div style="padding:16px 28px;display:flex;justify-content:flex-end;">
    <div style="width:260px;">
      ${totalRow('Subtotal', formatINR(subtotal))}
      ${discount > 0 ? totalRow('Discount', `− ${formatINR(discount)}`, '#C0392B') : ''}
      ${showGst ? totalRow(taxLabel, formatINR(tax)) : ''}
      <div style="border-top:2px solid #12335C;margin:8px 0;"></div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:13px;font-weight:700;color:#12335C;">Total Due</span>
        <span style="font-size:18px;font-weight:700;color:#12335C;font-variant-numeric:tabular-nums;">${formatINR(total)}</span>
      </div>
    </div>
  </div>

  <!-- ═══ PAYMENT DETAILS + NOTES ══════════════════════════════ -->
  <div style="margin:0 28px 20px;display:flex;gap:20px;background:#F7FAFD;border:1px solid #D7E2EF;border-radius:8px;padding:16px;">
    <div style="flex:1;">
      <div style="font-size:9px;font-weight:700;letter-spacing:1px;color:#6B7280;text-transform:uppercase;margin-bottom:8px;">Payment Details</div>
      ${co.bankAccountName ? `<div style="font-size:11px;margin-bottom:3px;"><span style="color:#6B7280;">Account Name:</span> <strong>${escHtml(co.bankAccountName)}</strong></div>` : ''}
      ${co.bankAccountNo ? `<div style="font-size:11px;margin-bottom:3px;"><span style="color:#6B7280;">Account No.:</span> <strong>${escHtml(co.bankAccountNo)}</strong></div>` : ''}
      ${co.bankName ? `<div style="font-size:11px;margin-bottom:3px;"><span style="color:#6B7280;">Bank:</span> ${escHtml(co.bankName)}</div>` : ''}
      ${co.ifsc ? `<div style="font-size:11px;margin-bottom:3px;"><span style="color:#6B7280;">IFSC:</span> ${escHtml(co.ifsc)}</div>` : ''}
      ${co.upiId ? `<div style="font-size:11px;"><span style="color:#6B7280;">UPI:</span> ${escHtml(co.upiId)}</div>` : ''}
    </div>
    <div style="flex:1;border-left:1px solid #D7E2EF;padding-left:20px;">
      <div style="font-size:9px;font-weight:700;letter-spacing:1px;color:#6B7280;text-transform:uppercase;margin-bottom:8px;">Notes &amp; Terms</div>
      <div style="font-size:11px;color:#0A1F3C;line-height:1.6;">
        ${invoice.notes ? escHtml(invoice.notes) : `Payment due within ${payTerms} days of invoice date.`}
      </div>
      ${co.website ? `<div style="margin-top:8px;font-size:11px;color:#0099FA;">${escHtml(co.website)}</div>` : ''}
    </div>
  </div>

  <!-- ═══ SIGNATURE ═════════════════════════════════════════════ -->
  <div style="padding:0 28px 20px;display:flex;justify-content:flex-start;">
    <div style="min-width:200px;border-top:1px solid #0A1F3C;padding-top:8px;">
      <div style="font-size:10px;color:#6B7280;">Authorised Signatory</div>
      <div style="font-size:12px;font-weight:600;color:#0A1F3C;margin-top:2px;">${escHtml(co.companyName ?? 'Devlofox Technologies LLP')}</div>
    </div>
  </div>

  <!-- ═══ FOOTER ════════════════════════════════════════════════ -->
  <div style="border-top:1px solid #D7E2EF;padding:8px 28px;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:9px;color:#6B7280;">${co.companyName ?? 'Devlofox Technologies LLP'} · ${companyAddress || 'Delhi, India'} · ${co.website ?? 'devlofox.com'}</span>
    <span style="font-size:9px;color:#6B7280;">Generated by Devlofox CRM · Page 1 of 1</span>
  </div>

</div>
</body>
</html>`;
}

// ─── Helpers ──────────────────────────────────────────────────

function escHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function metaCol(label: string, value: string): string {
  return `
    <div style="flex:1;padding:0 16px;border-right:1px solid #D7E2EF;last-child:border-right:none;">
      <div style="font-size:9px;font-weight:600;letter-spacing:.8px;color:#6B7280;text-transform:uppercase;">${label}</div>
      <div style="font-size:12px;font-weight:600;color:#0A1F3C;margin-top:3px;">${value}</div>
    </div>`;
}

function totalRow(label: string, value: string, color = '#0A1F3C'): string {
  return `
    <div style="display:flex;justify-content:space-between;padding:4px 0;">
      <span style="font-size:12px;color:#6B7280;">${label}</span>
      <span style="font-size:12px;font-weight:500;color:${color};font-variant-numeric:tabular-nums;">${value}</span>
    </div>`;
}
