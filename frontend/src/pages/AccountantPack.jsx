import React, { useState } from "react";
import { FolderArchive, FileJson } from "lucide-react";
import api, { pdfUrl } from "../lib/api";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export default function AccountantPack() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  return (
    <Layout title="Accountant Pack & GST Reports">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3" data-testid="pack-card">
          <div className="flex items-center gap-2">
            <FolderArchive className="w-5 h-5 text-[#0F284E]" />
            <h3 className="text-sm font-semibold text-slate-800">Monthly Accountant Pack (ZIP)</h3>
          </div>
          <p className="text-xs text-slate-500">Sales / purchase / expense / receipts registers (CSV) + AR-AP outstanding + all branded invoice PDFs for the month.</p>
          <div><Label>Month</Label>
            <Input data-testid="pack-month-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-48 font-mono" /></div>
          <a data-testid="pack-download-btn" href={pdfUrl(`/accountant-pack?month=${month}`)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold bg-[#0F284E] hover:bg-[#17386D] text-white rounded-md px-3 py-2 transition-colors">
            <FolderArchive className="w-3.5 h-3.5" /> Download accountant-pack-{month}.zip</a>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3" data-testid="gstr-card">
          <div className="flex items-center gap-2">
            <FileJson className="w-5 h-5 text-[#0F284E]" />
            <h3 className="text-sm font-semibold text-slate-800">GST Return JSON (sandbox format)</h3>
          </div>
          <p className="text-xs text-slate-500">Simplified GSTR-1 (B2B / B2C / CDNR) and GSTR-3B summary JSON for the selected month, generated from approved documents.</p>
          <div className="flex gap-2 pt-1">
            <a data-testid="gstr1-download-btn" href={pdfUrl(`/reports/gstr1?month=${month}`)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-md px-3 py-2 transition-colors">
              <FileJson className="w-3.5 h-3.5" /> GSTR-1 JSON</a>
            <a data-testid="gstr3b-download-btn" href={pdfUrl(`/reports/gstr3b?month=${month}`)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-md px-3 py-2 transition-colors">
              <FileJson className="w-3.5 h-3.5" /> GSTR-3B JSON</a>
          </div>
        </div>
      </div>
    </Layout>
  );
}
