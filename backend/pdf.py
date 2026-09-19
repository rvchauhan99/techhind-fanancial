import asyncio
import base64
import html as html_lib
from gst import inr, in_words
import storage

_pdf_sem = None


def _esc(value) -> str:
    return html_lib.escape("" if value is None else str(value), quote=True)

CSS = """
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
body { font-family: 'DejaVu Sans', sans-serif; font-size: 9.5pt; color: #0f172a; }
.header { display: flex; justify-content: space-between; border-bottom: 3px solid BRAND; padding-bottom: 10px; }
.brand-name { font-size: 20pt; font-weight: bold; color: BRAND; letter-spacing: 0.5px; }
.brand-meta { font-size: 8pt; color: #475569; line-height: 1.5; }
.doc-title { text-align: right; }
.doc-title h1 { font-size: 16pt; margin: 0; color: BRAND; text-transform: uppercase; }
.badge { display: inline-block; border: 1px solid #cbd5e1; border-radius: 3px; padding: 2px 8px; font-size: 8pt; color: #334155; margin-top: 4px; }
.meta { width: 100%; border-collapse: collapse; margin-top: 12px; }
.meta td { border: 1px solid #cbd5e1; padding: 5px 8px; font-size: 8.5pt; vertical-align: top; }
.meta .lbl { color: #64748b; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.4px; }
table.lines { width: 100%; border-collapse: collapse; margin-top: 12px; }
table.lines th { background: BRAND; color: #fff; font-size: 7.5pt; text-transform: uppercase; padding: 5px 6px; border: 1px solid BRAND; text-align: left; }
table.lines td { border: 1px solid #cbd5e1; padding: 5px 6px; font-size: 8.5pt; }
.num { text-align: right; font-family: 'DejaVu Sans Mono', monospace; }
.totals { width: 100%; border-collapse: collapse; margin-top: 0; }
.totals td { padding: 4px 6px; font-size: 8.5pt; }
.totals .grand { background: BRAND; color: #fff; font-weight: bold; font-size: 10pt; }
.words { border: 1px solid #cbd5e1; background: #f8fafc; padding: 6px 8px; font-size: 8.5pt; margin-top: 8px; }
.two-col { display: flex; justify-content: space-between; margin-top: 12px; }
.box { width: 48%; border: 1px solid #cbd5e1; padding: 8px; font-size: 8pt; line-height: 1.5; }
.box h4 { margin: 0 0 4px 0; font-size: 8pt; text-transform: uppercase; color: BRAND; }
.sign { margin-top: 18px; text-align: right; font-size: 8.5pt; }
.sign .name { font-weight: bold; margin-top: 8px; }
.foot { margin-top: 14px; border-top: 1px solid #cbd5e1; padding-top: 6px; font-size: 7.5pt; color: #64748b; }
.section-h { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin: 12px 0 4px 0; }
"""

DOC_TITLES = {"INV": "Tax Invoice", "CN": "Credit Note", "DN": "Debit Note"}


def _asset_b64(company: dict, field: str):
    path = company.get(field) if company else None
    if not path:
        return None
    got = storage.get_object_or_none(path)
    if not got:
        return None
    data, ctype = got
    return f"data:{ctype};base64," + base64.b64encode(data).decode()


def _logo_b64(company: dict):
    return _asset_b64(company, "logo_path")


def _signatory_html(snap: dict) -> str:
    """Authorised signatory block with optional signature image + company stamp/seal."""
    sig = _asset_b64(snap, "signature_path")
    stamp = _asset_b64(snap, "stamp_path")
    sig_img = (f'<img src="{sig}" alt="signature" '
               f'style="max-height:48px;max-width:140px;display:block;margin:4px 0 2px auto;" />') if sig else ""
    stamp_img = (f'<img src="{stamp}" alt="stamp" '
                 f'style="max-height:72px;max-width:90px;display:block;margin:2px 0 4px auto;opacity:0.92;" />') if stamp else ""
    return (f'<div class="sign">For <b>{_esc(snap.get("legal_name", ""))}</b>'
            f'{sig_img}{stamp_img}'
            f'<div class="name">Authorised Signatory</div></div>')


def _qr_b64(payload: str) -> str:
    import io as _io
    import qrcode
    img = qrcode.make(payload)
    buf = _io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def render_invoice_html(doc: dict, company: dict) -> str:
    brand = (doc.get("branding_snapshot") or {}).get("brand", {}).get("primary") or company.get("brand", {}).get("primary") or "#0F284E"
    snap = doc.get("branding_snapshot") or company
    bank = snap.get("bank", {})
    cust = doc.get("customer_snapshot") or {}
    logo = _logo_b64(snap)
    logo_html = f'<img src="{logo}" style="max-height:52px;max-width:160px;" />' if logo else ""
    title = DOC_TITLES.get(doc.get("doc_type"), "Tax Invoice")
    if doc.get("is_export_sez"):
        title += " (Export/SEZ)"
    css = CSS.replace("BRAND", brand)

    irn_block = ""
    if doc.get("irn"):
        qr = _qr_b64(f'{{"irn":"{doc["irn"]}","ack":"{doc.get("irn_ack_no","")}"}}')
        irn_block = (f'<table class="meta"><tr>'
                     f'<td><div class="lbl">IRN (e-Invoice · sandbox)</div>'
                     f'<span style="font-size:7pt">{doc["irn"]}</span></td>'
                     f'<td style="width:22%"><div class="lbl">Ack No / Date</div>{doc.get("irn_ack_no","")}<br/>{doc.get("irn_ack_date","")}</td>'
                     f'<td style="width:70px;text-align:center"><img src="{qr}" style="width:62px;height:62px"/></td>'
                     f'</tr></table>')

    rows = ""
    for i, l in enumerate(doc.get("lines", []), 1):
        if doc.get("tax_scheme") == "intra_state":
            tax_cells = f'<td class="num">{inr(l["cgst"])}</td><td class="num">{inr(l["sgst"])}</td>'
            tax_head = "<th class='num'>CGST</th><th class='num'>SGST</th>"
        else:
            tax_cells = f'<td class="num">{inr(l["igst"])}</td>'
            tax_head = "<th class='num'>IGST</th>"
        rows += (f"<tr><td>{i}</td><td>{_esc(l['description'])}</td><td>{_esc(l.get('hsn_sac',''))}</td>"
                 f"<td class='num'>{inr(l['qty'])}</td><td>{l.get('unit','')}</td>"
                 f"<td class='num'>{inr(l['rate'])}</td><td class='num'>{inr(l.get('discount',0))}</td>"
                 f"<td class='num'>{inr(l['taxable'])}</td><td class='num'>{l['tax_rate']}%</td>"
                 f"{tax_cells}<td class='num'>{inr(l['total'])}</td></tr>")
    if doc.get("tax_scheme") == "intra_state":
        tax_head = "<th class='num'>CGST</th><th class='num'>SGST</th>"
        tax_cols = 2
    else:
        tax_head = "<th class='num'>IGST</th>"
        tax_cols = 1

    extra_meta = ""
    if doc.get("doc_type") in ("CN", "DN") and doc.get("reference_invoice_no"):
        extra_meta += f'<tr><td><div class="lbl">Against Invoice</div>{doc["reference_invoice_no"]}</td><td colspan="3"><div class="lbl">Reason</div>{doc.get("reason","")}</td></tr>'

    html = f"""<html><head><style>{css}</style></head><body>
<div class="header">
  <div>{logo_html}<div class="brand-name">{_esc(snap.get('legal_name',''))}</div>
    <div class="brand-meta">{snap.get('address','')}<br/>
    GSTIN: <b>{snap.get('gstin','')}</b> &nbsp;|&nbsp; CIN: {snap.get('cin','')} &nbsp;|&nbsp; PAN: {snap.get('pan','')}<br/>
    {snap.get('email','')} &nbsp;|&nbsp; {snap.get('phone','')}</div></div>
  <div class="doc-title"><h1>{title}</h1>
    <div class="badge">GSTIN: {snap.get('gstin','')}</div><br/>
    <div class="badge">Original for Recipient</div></div>
</div>
<table class="meta"><tr>
  <td><div class="lbl">{title} No</div><b>{doc.get('invoice_no') or 'DRAFT'}</b></td>
  <td><div class="lbl">Date</div>{doc.get('invoice_date','')}</td>
  <td><div class="lbl">Due Date</div>{doc.get('due_date') or '-'}</td>
  <td><div class="lbl">Place of Supply</div>{doc.get('place_of_supply',{}).get('state','')} ({doc.get('place_of_supply',{}).get('code','')})</td>
  <td><div class="lbl">Reverse Charge</div>{'Yes' if doc.get('reverse_charge') else 'No'}</td>
</tr></table>
{irn_block}
{extra_meta and '<table class="meta">' + extra_meta + '</table>'}
<div class="section-h">Billed To</div>
<table class="meta"><tr>
  <td style="width:55%"><b>{_esc(cust.get('legal_name',''))}</b><br/>{_esc(cust.get('billing_address',''))}<br/>
  State: {cust.get('state','')} ({cust.get('state_code','')})</td>
  <td><div class="lbl">GSTIN</div>{cust.get('gstin') or 'Unregistered'}<br/>
  <div class="lbl">Contact</div>{cust.get('contact_email','')}</td>
</tr></table>
<div class="section-h">Particulars</div>
<table class="lines"><tr><th>#</th><th>Description</th><th>HSN/SAC</th><th class="num">Qty</th><th>Unit</th>
<th class="num">Rate</th><th class="num">Disc</th><th class="num">Taxable</th><th class="num">GST%</th>{tax_head}<th class="num">Total (INR)</th></tr>
{rows}</table>
<table style="width:100%"><tr>
<td style="width:55%;vertical-align:top">
  <div class="words"><b>Amount in words:</b> {in_words(doc.get('grand_total',0))}</div>
  <div class="two-col" style="margin-top:8px"><div class="box" style="width:100%">
    <h4>Bank Details (NEFT/RTGS/UPI)</h4>
    Bank: {bank.get('bank_name','')} &nbsp;|&nbsp; Branch: {bank.get('branch','')}<br/>
    A/c Name: {bank.get('account_name','')} &nbsp;|&nbsp; A/c No: <b>{bank.get('account_no','')}</b><br/>
    IFSC: <b>{bank.get('ifsc','')}</b> &nbsp;|&nbsp; UPI: {bank.get('upi','')}
  </div></div>
</td>
<td style="width:42%;vertical-align:top">
<table class="totals" style="width:100%">
<tr><td>Sub Total</td><td class="num">{inr(doc.get('sub_total',0))}</td></tr>
<tr><td>Discount</td><td class="num">-{inr(doc.get('total_discount',0))}</td></tr>
<tr><td>Taxable Value</td><td class="num">{inr(doc.get('total_taxable',0))}</td></tr>
<tr><td>CGST</td><td class="num">{inr(doc.get('total_cgst',0))}</td></tr>
<tr><td>SGST</td><td class="num">{inr(doc.get('total_sgst',0))}</td></tr>
<tr><td>IGST</td><td class="num">{inr(doc.get('total_igst',0))}</td></tr>
<tr><td>Round Off</td><td class="num">{'+' if doc.get('round_off',0) >= 0 else ''}{inr(doc.get('round_off',0))}</td></tr>
<tr class="grand"><td>Grand Total</td><td class="num">₹ {inr(doc.get('grand_total',0))}</td></tr>
</table></td></tr></table>
<div class="two-col">
  <div class="box"><h4>Terms &amp; Conditions</h4>{snap.get('terms','')}</div>
  {_signatory_html(snap)}
</div>
<div class="foot">This is a computer generated {title.lower()}. Generated by TechHind Company Finance. {'Tax is payable under reverse charge by the recipient.' if doc.get('reverse_charge') else ''} {'Supply meant for export/SEZ under LUT without payment of IGST.' if doc.get('is_export_sez') and doc.get('lut_flag') else ''}</div>
</body></html>"""
    return html


def render_receipt_html(payment: dict, company: dict, customer: dict, allocations: list) -> str:
    brand = company.get("brand", {}).get("primary") or "#0F284E"
    css = CSS.replace("BRAND", brand)
    logo = _logo_b64(company)
    logo_html = f'<img src="{logo}" style="max-height:52px;max-width:160px;" />' if logo else ""
    rows = ""
    for a in allocations:
        rows += (f"<tr><td>{a.get('invoice_no','')}</td><td>{a.get('invoice_date','')}</td>"
                 f"<td class='num'>{inr(a.get('amount',0))}</td></tr>")
    html = f"""<html><head><style>{css}</style></head><body>
<div class="header">
  <div>{logo_html}<div class="brand-name">{company.get('legal_name','')}</div>
  <div class="brand-meta">{company.get('address','')}<br/>GSTIN: <b>{company.get('gstin','')}</b> | {company.get('email','')} | {company.get('phone','')}</div></div>
  <div class="doc-title"><h1>Receipt</h1><div class="badge">GSTIN: {company.get('gstin','')}</div></div>
</div>
<table class="meta"><tr>
  <td><div class="lbl">Receipt No</div><b>{payment.get('receipt_no','')}</b></td>
  <td><div class="lbl">Date</div>{payment.get('payment_date','')}</td>
  <td><div class="lbl">Mode</div>{payment.get('method','')}</td>
  <td><div class="lbl">Reference</div>{payment.get('reference_no') or '-'}</td>
</tr></table>
<div class="section-h">Received From</div>
<table class="meta"><tr><td><b>{customer.get('legal_name','')}</b><br/>{customer.get('billing_address','')}<br/>GSTIN: {customer.get('gstin') or 'Unregistered'}</td></tr></table>
<div class="section-h">Allocation Against Invoices</div>
<table class="lines"><tr><th>Invoice No</th><th>Invoice Date</th><th class="num">Amount (INR)</th></tr>{rows or '<tr><td colspan="3">Unallocated advance</td></tr>'}</table>
<div class="words" style="margin-top:10px"><b>Amount received:</b> ₹ {inr(payment.get('amount',0))} ({in_words(payment.get('amount',0))})
{('<br/><b>Unallocated balance:</b> ₹ ' + inr(payment.get('unallocated',0))) if payment.get('unallocated',0) > 0 else ''}</div>
{_signatory_html(company)}
<div class="foot">This is a computer generated receipt.</div>
</body></html>"""
    return html


def _doc_header(company: dict, title: str) -> str:
    brand = company.get("brand", {}).get("primary") or "#0F284E"
    css = CSS.replace("BRAND", brand)
    logo = _logo_b64(company)
    logo_html = f'<img src="{logo}" style="max-height:52px;max-width:160px;" />' if logo else ""
    return css, f"""<div class="header">
  <div>{logo_html}<div class="brand-name">{_esc(company.get('legal_name',''))}</div>
  <div class="brand-meta">{_esc(company.get('address',''))}<br/>GSTIN: <b>{_esc(company.get('gstin',''))}</b> | {_esc(company.get('email',''))} | {_esc(company.get('phone',''))}</div></div>
  <div class="doc-title"><h1>{_esc(title)}</h1><div class="badge">GSTIN: {_esc(company.get('gstin',''))}</div></div>
</div>"""


def render_voucher_html(voucher: dict, company: dict) -> str:
    css, header = _doc_header(company, "Expense Voucher")
    total = voucher.get("total") or 0
    html = f"""<html><head><style>{css}</style></head><body>
{header}
<table class="meta"><tr>
  <td><div class="lbl">Voucher No</div><b>{_esc(voucher.get('voucher_no') or 'DRAFT')}</b></td>
  <td><div class="lbl">Date</div>{_esc(voucher.get('voucher_date',''))}</td>
  <td><div class="lbl">Status</div>{_esc((voucher.get('status') or '').replace('_', ' ').title())}</td>
  <td><div class="lbl">Type</div>{_esc(voucher.get('type') or 'expense')}</td>
</tr></table>
<table class="meta"><tr>
  <td><div class="lbl">Category</div><b>{_esc(voucher.get('category',''))}</b></td>
  <td><div class="lbl">Payee / Vendor</div>{_esc(voucher.get('vendor_name') or '—')}</td>
  <td><div class="lbl">Paid Via</div>{_esc(voucher.get('paid_via') or '—')}</td>
</tr></table>
<div class="section-h">Narration</div>
<table class="meta"><tr><td>{_esc(voucher.get('narration',''))}</td></tr></table>
<table class="totals" style="width:42%;margin-left:auto;margin-top:12px">
<tr><td>Amount</td><td class="num">{inr(voucher.get('amount',0))}</td></tr>
<tr><td>Tax ({voucher.get('tax_rate',0)}%)</td><td class="num">{inr(voucher.get('tax_amount',0))}</td></tr>
<tr class="grand"><td>Total</td><td class="num">₹ {inr(total)}</td></tr>
</table>
<div class="words" style="margin-top:10px"><b>Amount in words:</b> {in_words(total)}</div>
{('<div class="section-h">Attachments</div><table class="lines"><tr><th>File</th></tr>'
  + ''.join(f'<tr><td>{_esc(a.get("name",""))}</td></tr>' for a in (voucher.get("attachments") or []))
  + '</table>') if voucher.get('attachments') else ''}
{_signatory_html(company)}
<div class="foot">Computer generated expense voucher — TechHind Company Finance.
{('Approved: ' + _esc(voucher.get('approved_at',''))) if voucher.get('approved_at') else ''}</div>
</body></html>"""
    return html


def render_bill_html(bill: dict, company: dict) -> str:
    css, header = _doc_header(company, "Purchase Bill")
    vendor = bill.get("vendor_snapshot") or {}
    rows = ""
    for i, l in enumerate(bill.get("lines") or [], 1):
        rows += (f"<tr><td>{i}</td><td>{_esc(l.get('description',''))}</td><td>{_esc(l.get('hsn_sac',''))}</td>"
                 f"<td class='num'>{inr(l.get('qty',0))}</td><td class='num'>{inr(l.get('rate',0))}</td>"
                 f"<td class='num'>{l.get('tax_rate',0)}%</td><td class='num'>{inr(l.get('taxable') or l.get('qty',0)*l.get('rate',0))}</td>"
                 f"<td class='num'>{inr(l.get('total') or 0)}</td></tr>")
    html = f"""<html><head><style>{css}</style></head><body>
{header}
<table class="meta"><tr>
  <td><div class="lbl">Bill No</div><b>{_esc(bill.get('bill_no',''))}</b></td>
  <td><div class="lbl">Date</div>{_esc(bill.get('bill_date',''))}</td>
  <td><div class="lbl">Due</div>{_esc(bill.get('due_date') or '—')}</td>
  <td><div class="lbl">Status</div>{_esc(bill.get('status',''))}</td>
  <td><div class="lbl">ITC</div>{'Eligible' if bill.get('itc_eligible') else 'Blocked'}</td>
</tr></table>
<div class="section-h">Vendor</div>
<table class="meta"><tr><td><b>{_esc(vendor.get('name',''))}</b><br/>{_esc(vendor.get('address',''))}<br/>
GSTIN: {_esc(vendor.get('gstin') or 'Unregistered')} | State: {_esc(vendor.get('state',''))} ({_esc(vendor.get('state_code',''))})</td></tr></table>
<table class="lines"><tr><th>#</th><th>Description</th><th>HSN</th><th class="num">Qty</th><th class="num">Rate</th>
<th class="num">GST%</th><th class="num">Taxable</th><th class="num">Total</th></tr>{rows or '<tr><td colspan="8">No lines</td></tr>'}</table>
<table class="totals" style="width:42%;margin-left:auto">
<tr><td>Taxable</td><td class="num">{inr(bill.get('total_taxable',0))}</td></tr>
<tr><td>GST</td><td class="num">{inr(bill.get('total_tax',0))}</td></tr>
<tr class="grand"><td>Grand Total</td><td class="num">₹ {inr(bill.get('grand_total',0))}</td></tr>
<tr><td>Balance</td><td class="num">{inr(bill.get('balance',0))}</td></tr>
</table>
<div class="words"><b>Amount in words:</b> {in_words(bill.get('grand_total',0))}</div>
{_signatory_html(company)}
<div class="foot">Computer generated purchase bill record — for internal / CA use.</div>
</body></html>"""
    return html


def render_vendor_payment_html(payment: dict, company: dict) -> str:
    css, header = _doc_header(company, "Vendor Payment Advice")
    rows = ""
    for a in payment.get("allocations") or []:
        rows += (f"<tr><td>{_esc(a.get('bill_no',''))}</td><td class='num'>{inr(a.get('amount',0))}</td></tr>")
    html = f"""<html><head><style>{css}</style></head><body>
{header}
<table class="meta"><tr>
  <td><div class="lbl">Payment Ref</div><b>{_esc(payment.get('payment_ref',''))}</b></td>
  <td><div class="lbl">Date</div>{_esc(payment.get('payment_date',''))}</td>
  <td><div class="lbl">Method</div>{_esc(payment.get('method',''))}</td>
  <td><div class="lbl">Bank Ref</div>{_esc(payment.get('reference_no') or '—')}</td>
</tr></table>
<div class="section-h">Paid To</div>
<table class="meta"><tr><td><b>{_esc(payment.get('vendor_name',''))}</b></td></tr></table>
<div class="section-h">Allocated Against Bills</div>
<table class="lines"><tr><th>Bill No</th><th class="num">Amount (INR)</th></tr>
{rows or '<tr><td colspan="2">Unallocated</td></tr>'}</table>
<div class="words" style="margin-top:10px"><b>Amount paid:</b> ₹ {inr(payment.get('amount',0))} ({in_words(payment.get('amount',0))})</div>
{_signatory_html(company)}
<div class="foot">Computer generated vendor payment advice — TechHind Company Finance.</div>
</body></html>"""
    return html


async def build_pdf(html: str) -> bytes:
    import os
    from pathlib import Path
    hb = Path("/opt/homebrew/lib")
    if hb.is_dir():
        cur = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "")
        if str(hb) not in cur.split(":"):
            os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = f"{hb}:{cur}" if cur else str(hb)
    global _pdf_sem
    if _pdf_sem is None:
        n = max(1, int(os.environ.get("PDF_MAX_CONCURRENCY") or 2))
        _pdf_sem = asyncio.Semaphore(n)
    from weasyprint import HTML
    async with _pdf_sem:
        return await asyncio.to_thread(lambda: HTML(string=html).write_pdf())
