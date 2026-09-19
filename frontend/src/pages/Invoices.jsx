import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, FileDown, Mail } from "lucide-react";
import api, { pdfUrl } from "../lib/api";
import { fmtINR, fmtDate, DOC_TYPE_LABELS } from "../lib/format";
import Layout, { StatusBadge, Empty } from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import FilterBar, { FIELD } from "../components/filters/FilterBar";
import { useListFilters } from "../hooks/useListFilters";

const STATUS_OPTS = ["draft", "approved", "partially_paid", "paid", "cancelled"];

const SCHEMA = [
  { key: "q", type: FIELD.TEXT, label: "Search", placeholder: "Number / customer…", width: "w-44" },
  { key: "status", type: FIELD.SELECT, label: "Status", width: "w-40",
    options: STATUS_OPTS.map((s) => ({ value: s, label: s.replace("_", " ") })) },
  { key: "dates", type: FIELD.DATE_RANGE, label: "Invoice date", fromKey: "date_from", toKey: "date_to" },
  { key: "customer_id", type: FIELD.SELECT, label: "Customer", width: "w-48", options: [] },
  { key: "total", type: FIELD.NUMBER_RANGE, label: "Grand total", minKey: "min_total", maxKey: "max_total" },
  { key: "tax_scheme", type: FIELD.SELECT, label: "Tax scheme", width: "w-36",
    options: [
      { value: "intra_state", label: "CGST+SGST" },
      { value: "inter_state", label: "IGST" },
      { value: "zero_rated", label: "Zero-rated" },
    ] },
  { key: "has_balance", type: FIELD.TOGGLE, label: "Open balance", placeholder: "Has balance" },
];

export default function Invoices() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [customers, setCustomers] = useState([]);
  const { values, setFilter, setMany, clearFilters, activeCount, apiParams } = useListFilters(SCHEMA, {
    preserve: ["doc_type"],
  });
  const tab = values.doc_type || "INV";

  const schema = useMemo(() => SCHEMA.map((f) => {
    if (f.key !== "customer_id") return f;
    return {
      ...f,
      options: customers.map((c) => ({ value: c.id, label: c.legal_name || c.name || c.id })),
    };
  }), [customers]);

  useEffect(() => {
    api.get("/customers").then((r) => setCustomers(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    api.get("/invoices", { params: { ...apiParams, doc_type: tab } })
      .then((r) => setRows(Array.isArray(r.data) ? r.data : r.data?.items || []))
      .catch(() => setRows([]));
  }, [apiParams, tab]);

  return (
    <Layout title="Invoices & Notes"
      actions={can("admin", "accountant", "ops") && (
        <Button data-testid="new-invoice-btn" size="sm" onClick={() => navigate("/invoices/new")}
          className="bg-[#0F284E] hover:bg-[#17386D] text-white"><Plus className="w-4 h-4 mr-1" /> New Invoice</Button>)}>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <div className="flex border border-slate-200 rounded-md overflow-hidden bg-white" data-testid="invoice-type-tabs">
          {["INV", "CN", "DN"].map((t) => (
            <button key={t} data-testid={`tab-${t}`}
              onClick={() => setMany({ doc_type: t })}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${tab === t ? "bg-[#0F284E] text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {DOC_TYPE_LABELS[t]}s</button>
          ))}
        </div>
      </div>
      <FilterBar schema={schema} values={values} setFilter={setFilter}
        clearFilters={clearFilters} activeCount={activeCount} testId="invoice-filters" />

      <div className="bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-sm" data-testid="invoices-table">
          <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
            <th className="text-left px-3 py-2">Number</th><th className="text-left px-3 py-2">Date</th>
            <th className="text-left px-3 py-2">Customer</th><th className="text-left px-3 py-2">Tax Scheme</th>
            <th className="text-right px-3 py-2">Taxable</th><th className="text-right px-3 py-2">GST</th>
            <th className="text-right px-3 py-2">Total</th><th className="text-right px-3 py-2">Balance</th>
            <th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Sent</th>
            <th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {(rows || []).map((i) => (
              <tr key={i.id} data-testid={`invoice-row-${i.id}`}
                className="border-t border-slate-100 hover:bg-slate-50/80 transition-colors">
                <td className="px-3 py-2 font-mono text-xs font-semibold text-[#0066CC] cursor-pointer"
                  onClick={() => navigate(`/invoices/${i.id}`)}>{i.invoice_no || <span className="text-slate-400">DRAFT</span>}</td>
                <td className="px-3 py-2 text-xs cursor-pointer" onClick={() => navigate(`/invoices/${i.id}`)}>{fmtDate(i.invoice_date)}</td>
                <td className="px-3 py-2 cursor-pointer" onClick={() => navigate(`/invoices/${i.id}`)}>{(i.customer_snapshot || {}).legal_name}</td>
                <td className="px-3 py-2 cursor-pointer" onClick={() => navigate(`/invoices/${i.id}`)}>
                  {i.tax_scheme === "intra_state"
                    ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border text-emerald-700 bg-emerald-50 border-emerald-200">CGST+SGST</span>
                    : i.tax_scheme === "zero_rated"
                    ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border text-sky-700 bg-sky-50 border-sky-200">ZERO-RATED</span>
                    : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border text-indigo-700 bg-indigo-50 border-indigo-200">IGST</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono cursor-pointer" onClick={() => navigate(`/invoices/${i.id}`)}>{fmtINR(i.total_taxable)}</td>
                <td className="px-3 py-2 text-right font-mono cursor-pointer" onClick={() => navigate(`/invoices/${i.id}`)}>{fmtINR(i.total_tax)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold cursor-pointer" onClick={() => navigate(`/invoices/${i.id}`)}>{fmtINR(i.grand_total)}</td>
                <td className="px-3 py-2 text-right font-mono cursor-pointer" onClick={() => navigate(`/invoices/${i.id}`)}>{fmtINR(i.balance)}</td>
                <td className="px-3 py-2 cursor-pointer" onClick={() => navigate(`/invoices/${i.id}`)}><StatusBadge value={i.status} /></td>
                <td className="px-3 py-2">{i.sent_on
                  ? <span className="flex items-center gap-1 text-[11px] text-slate-500" title={`Sent ${fmtDate(i.sent_on)} (mocked)`}><Mail className="w-3 h-3" />{fmtDate(i.sent_on)}</span>
                  : <span className="text-[11px] text-slate-300">—</span>}</td>
                <td className="px-3 py-2 text-right">
                  {i.status !== "draft" && (
                    <a data-testid={`download-invoice-pdf-${i.id}`} href={pdfUrl(`/invoices/${i.id}/pdf`)}
                      target="_blank" rel="noreferrer" title="Download PDF"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#0F284E]">
                      <FileDown className="w-3.5 h-3.5" /></a>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty label="No documents found" />}
      </div>
    </Layout>
  );
}
