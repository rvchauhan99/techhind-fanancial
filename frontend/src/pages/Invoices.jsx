import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import api from "../lib/api";
import { fmtINR, fmtDate, DOC_TYPE_LABELS } from "../lib/format";
import Layout, { StatusBadge, Empty } from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Mail } from "lucide-react";

const STATUS_OPTS = ["draft", "approved", "partially_paid", "paid", "cancelled"];

export default function Invoices() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("doc_type") || "INV";
  const status = params.get("status") || "";
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(null);

  const load = () =>
    api.get("/invoices", { params: { doc_type: tab, status, q } }).then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); }, [tab, status]); // eslint-disable-line

  return (
    <Layout title="Invoices & Notes"
      actions={can("admin", "accountant", "ops") && (
        <Button data-testid="new-invoice-btn" size="sm" onClick={() => navigate("/invoices/new")}
          className="bg-[#0F284E] hover:bg-[#17386D] text-white"><Plus className="w-4 h-4 mr-1" /> New Invoice</Button>)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex border border-slate-200 rounded-md overflow-hidden bg-white" data-testid="invoice-type-tabs">
          {["INV", "CN", "DN"].map((t) => (
            <button key={t} data-testid={`tab-${t}`} onClick={() => setParams({ doc_type: t })}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${tab === t ? "bg-[#0F284E] text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {DOC_TYPE_LABELS[t]}s</button>
          ))}
        </div>
        <Select value={status || "all"} onValueChange={(v) => setParams({ doc_type: tab, ...(v !== "all" ? { status: v } : {}) })}>
          <SelectTrigger data-testid="invoice-status-filter" className="w-44 h-8 bg-white"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent className="bg-white">
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTS.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative w-72">
          <Search className="w-4 h-4 absolute left-3 top-2 text-slate-400" />
          <Input data-testid="invoice-search-input" placeholder="Search number / customer…" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} className="pl-9 h-8 bg-white" />
        </div>
        <Button data-testid="invoice-search-btn" variant="outline" size="sm" onClick={load}>Search</Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-sm" data-testid="invoices-table">
          <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
            <th className="text-left px-3 py-2">Number</th><th className="text-left px-3 py-2">Date</th>
            <th className="text-left px-3 py-2">Customer</th><th className="text-left px-3 py-2">Tax Scheme</th>
            <th className="text-right px-3 py-2">Taxable</th><th className="text-right px-3 py-2">GST</th>
            <th className="text-right px-3 py-2">Total</th><th className="text-right px-3 py-2">Balance</th>
            <th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Sent</th></tr></thead>
          <tbody>
            {(rows || []).map((i) => (
              <tr key={i.id} data-testid={`invoice-row-${i.id}`} onClick={() => navigate(`/invoices/${i.id}`)}
                className="border-t border-slate-100 hover:bg-slate-50/80 cursor-pointer transition-colors">
                <td className="px-3 py-2 font-mono text-xs font-semibold text-[#0066CC]">{i.invoice_no || <span className="text-slate-400">DRAFT</span>}</td>
                <td className="px-3 py-2 text-xs">{fmtDate(i.invoice_date)}</td>
                <td className="px-3 py-2">{(i.customer_snapshot || {}).legal_name}</td>
                <td className="px-3 py-2">
                  {i.tax_scheme === "intra_state"
                    ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border text-emerald-700 bg-emerald-50 border-emerald-200">CGST+SGST</span>
                    : i.tax_scheme === "zero_rated"
                    ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border text-sky-700 bg-sky-50 border-sky-200">ZERO-RATED</span>
                    : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border text-indigo-700 bg-indigo-50 border-indigo-200">IGST</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono">{fmtINR(i.total_taxable)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtINR(i.total_tax)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{fmtINR(i.grand_total)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtINR(i.balance)}</td>
                <td className="px-3 py-2"><StatusBadge value={i.status} /></td>
                <td className="px-3 py-2">{i.sent_on
                  ? <span className="flex items-center gap-1 text-[11px] text-slate-500" title={`Sent ${fmtDate(i.sent_on)} (mocked)`}><Mail className="w-3 h-3" />{fmtDate(i.sent_on)}</span>
                  : <span className="text-[11px] text-slate-300">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty label="No documents found" />}
      </div>
    </Layout>
  );
}
