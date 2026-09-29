import React, { useEffect, useState } from "react";
import { FolderArchive, FileJson, Check } from "lucide-react";
import api, { pdfUrl } from "../lib/api";
import { fmtINR } from "../lib/format";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export default function AccountantPack() {
  const [month, setMonth] = useState("2026-08");
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!month) return;
    api.get(`/reports/month-summary?month=${month}`)
      .then((r) => setSummary(r.data))
      .catch(() => setSummary(null));
  }, [month]);

  const cells = summary ? [
    ["Invoices", summary.invoice_count],
    ["Outward taxable", fmtINR(summary.outward_taxable)],
    ["CGST", fmtINR(summary.outward_cgst)],
    ["SGST", fmtINR(summary.outward_sgst)],
    ["IGST", fmtINR(summary.outward_igst)],
    ["Outward grand", fmtINR(summary.outward_grand)],
    ["Receipts cash", fmtINR(summary.receipts_cash)],
    ["TDS deducted", fmtINR(summary.receipts_tds)],
    ["Expenses", fmtINR(summary.expense_total)],
    ["Open AR #", summary.open_ar_count],
  ] : [];

  const checklist = summary ? [
    ["Sales / purchase / expense / receipts CSVs", true, "registers"],
    ["Invoice PDFs", summary.invoice_count, `${summary.invoice_count || 0}`],
    ["Receipt PDFs", summary.receipt_pdf_count, `${summary.receipt_pdf_count || 0}`],
    ["Expense voucher PDFs", summary.voucher_pdf_count, `${summary.voucher_pdf_count || 0}`],
    ["Voucher attachments", summary.attachment_count, `${summary.attachment_count || 0}`],
    ["Purchase bill PDFs", summary.bill_pdf_count, `${summary.bill_pdf_count || 0}`],
    ["Vendor payments CSV", summary.vendor_payment_count, `${summary.vendor_payment_count || 0} · ${fmtINR(summary.vendor_payment_total || 0)}`],
    ["AR / AP outstanding CSVs", true, "included"],
    ["MANIFEST.txt", true, "file list"],
  ] : [];

  return (
    <Layout title="Accountant Pack & GST Reports">
      <div className="flex flex-wrap items-end gap-3 mb-3" data-testid="pack-month-bar">
        <div>
          <Label className="text-[11px]">Month</Label>
          <Input data-testid="pack-month-input" type="month" value={month}
            onChange={(e) => setMonth(e.target.value)} className="w-44 h-8 font-mono text-sm" />
        </div>
        <p className="text-[11px] text-slate-500 max-w-xl leading-snug" data-testid="pack-ca-handoff">
          Give CA this ZIP + GSTR JSON for the month. Attach supporting bills on expense vouchers before approval.
          Form 26Q / portal GSTR not included.
        </p>
      </div>

      {summary && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden mb-3" data-testid="pack-month-summary">
          <div className="px-3 py-1.5 bg-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            Month summary — tax & TDS
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-0 divide-x divide-y divide-slate-100">
            {cells.map(([label, val]) => (
              <div key={label} className="px-3 py-2 min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
                <div className="font-mono text-sm font-semibold text-slate-900 truncate">{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden mb-3" data-testid="pack-contents-checklist">
          <div className="px-3 py-1.5 bg-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            Pack contents (this month)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 divide-x divide-y divide-slate-100">
            {checklist.map(([label, ok, detail]) => (
              <div key={label} className="px-3 py-1.5 flex items-center gap-2 min-w-0">
                <Check className={`w-3.5 h-3.5 shrink-0 ${ok ? "text-emerald-600" : "text-slate-300"}`} />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-800 truncate">{label}</div>
                  <div className="font-mono text-[10px] text-slate-500">{detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-4xl">
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2" data-testid="pack-card">
          <div className="flex items-center gap-2">
            <FolderArchive className="w-4 h-4 text-[#0F284E]" />
            <h3 className="text-sm font-semibold text-slate-800">Monthly Accountant Pack (ZIP)</h3>
          </div>
          <p className="text-xs text-slate-500 leading-snug">
            Registers (sales, purchase, expense, receipts+TDS, vendor payments, AR/AP) + invoice / receipt /
            expense voucher / purchase bill PDFs + voucher attachments + MANIFEST.txt.
          </p>
          <a data-testid="pack-download-btn" href={pdfUrl(`/accountant-pack?month=${month}`)}
            className="inline-flex w-full sm:w-auto justify-center items-center gap-1.5 text-xs font-semibold bg-[#0F284E] hover:bg-[#17386D] text-white rounded-md px-3 py-2 min-h-11 transition-colors">
            <FolderArchive className="w-3.5 h-3.5" /> Download accountant-pack-{month}.zip</a>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2" data-testid="gstr-card">
          <div className="flex items-center gap-2">
            <FileJson className="w-4 h-4 text-[#0F284E]" />
            <h3 className="text-sm font-semibold text-slate-800">GST Return JSON (sandbox)</h3>
          </div>
          <p className="text-xs text-slate-500">Simplified GSTR-1 / GSTR-3B from approved docs — not portal upload format.</p>
          <div className="flex flex-col sm:flex-row gap-2 pt-0.5">
            <a data-testid="gstr1-download-btn" href={pdfUrl(`/reports/gstr1?month=${month}`)}
              className="inline-flex w-full sm:w-auto justify-center items-center gap-1.5 text-xs font-semibold border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-md px-3 py-2 min-h-11 transition-colors">
              <FileJson className="w-3.5 h-3.5" /> GSTR-1</a>
            <a data-testid="gstr3b-download-btn" href={pdfUrl(`/reports/gstr3b?month=${month}`)}
              className="inline-flex w-full sm:w-auto justify-center items-center gap-1.5 text-xs font-semibold border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-md px-3 py-2 min-h-11 transition-colors">
              <FileJson className="w-3.5 h-3.5" /> GSTR-3B</a>
          </div>
        </div>
      </div>
    </Layout>
  );
}
