import React, { useRef, useState } from "react";
import { Upload, Download, PlayCircle, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import api, { apiError, pdfUrl } from "../lib/api";
import Layout from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const ENTITIES = [
  ["customers", "Customers"], ["vendors", "Vendors"], ["products", "Products & Plans"],
  ["subscriptions", "Subscriptions"], ["expenses", "Expense vouchers (posted)"],
  ["invoices", "Historical invoices (approved)"], ["payments", "Payments / receipts"],
  ["opening_balances", "Opening balances (AR)"],
];

export default function Imports() {
  const { can } = useAuth();
  const [entity, setEntity] = useState("customers");
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  if (!can("admin", "accountant"))
    return <Layout title="CSV Import"><div className="text-sm text-slate-500" data-testid="import-forbidden">Only Admin and Accountant roles can import data.</div></Layout>;

  const run = async (mode) => {
    if (!file) return toast.error("Choose a CSV file first");
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { data } = await api.post(`/import/${entity}/${mode}`, fd);
      setResult(data);
      if (mode === "commit") toast.success(`Imported ${data.valid}/${data.total} rows`);
      else toast.success(`Dry-run: ${data.valid} valid, ${data.invalid} invalid`);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout title="CSV Import">
      <div className="bg-white border border-slate-200 rounded-lg p-5 max-w-3xl space-y-4" data-testid="import-panel">
        <div className="text-xs text-slate-500">
          Historical data onboarding with <b>dry-run validation</b> — nothing is written until you commit.
          Legacy invoice numbers are preserved via the <code className="font-mono">legacy_no</code> column; blank rows take the next TH series number.</div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={entity} onValueChange={(v) => { setEntity(v); setResult(null); }}>
            <SelectTrigger data-testid="import-entity-select" className="w-72 bg-white"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-white">{ENTITIES.map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
          <a data-testid="import-template-link" href={pdfUrl(`/import/templates/${entity}`)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#0066CC] hover:underline">
            <Download className="w-3.5 h-3.5" /> Template CSV</a>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" accept=".csv" className="hidden" ref={fileRef}
            onChange={(e) => { setFile(e.target.files[0]); setResult(null); }} />
          <Button data-testid="import-file-btn" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="w-3.5 h-3.5 mr-1" /> {file ? file.name : "Choose CSV"}</Button>
          <Button data-testid="import-dryrun-btn" size="sm" variant="outline" disabled={!file || busy} onClick={() => run("dry-run")}>
            <PlayCircle className="w-3.5 h-3.5 mr-1" /> Dry-run validation</Button>
          <Button data-testid="import-commit-btn" size="sm" disabled={!file || busy || !result || result.mode !== "dry-run" || result.valid === 0}
            onClick={() => run("commit")} className="bg-[#0F284E] hover:bg-[#17386D] text-white">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Commit {result?.mode === "dry-run" ? `${result.valid} valid rows` : ""}</Button>
        </div>
        <p className="text-[11px] text-slate-400">Order matters: import customers before subscriptions / invoices / payments.</p>
      </div>

      {result && (
        <div className="bg-white border border-slate-200 rounded-lg" data-testid="import-results">
          <div className="px-4 py-2.5 border-b border-slate-200 flex items-center gap-4 text-sm">
            <span className="font-semibold text-slate-800">{result.mode === "commit" ? "Commit results" : "Dry-run results"}</span>
            <span className="text-xs text-slate-500">{result.total} rows</span>
            <span className="text-xs font-semibold text-emerald-700">{result.valid} valid</span>
            <span className="text-xs font-semibold text-red-700">{result.invalid} invalid</span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
              <th className="text-left px-3 py-2 w-16">Row</th><th className="text-left px-3 py-2 w-24">Status</th>
              <th className="text-left px-3 py-2">Detail</th></tr></thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.row} data-testid={`import-row-${r.row}`} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{r.row}</td>
                  <td className="px-3 py-2">{r.ok
                    ? <span className="flex items-center gap-1 text-emerald-700 text-xs font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> OK</span>
                    : <span className="flex items-center gap-1 text-red-700 text-xs font-semibold"><XCircle className="w-3.5 h-3.5" /> Error</span>}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{r.ok ? r.summary : r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
