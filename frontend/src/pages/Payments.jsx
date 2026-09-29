import React, { useEffect, useMemo, useState } from "react";
import { Plus, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { apiError, pdfUrl } from "../lib/api";
import { fmtINR, fmtDate } from "../lib/format";
import Layout, { Empty } from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import FilterBar, { FIELD } from "../components/filters/FilterBar";
import { useListFilters } from "../hooks/useListFilters";

const METHODS = { upi: "UPI", neft: "NEFT", rtgs: "RTGS", cheque: "Cheque", cash: "Cash", card: "Card" };

const BASE_SCHEMA = [
  { key: "q", type: FIELD.TEXT, label: "Search", placeholder: "Receipt / customer / ref…", width: "w-44" },
  { key: "dates", type: FIELD.DATE_RANGE, label: "Payment date" },
  { key: "customer_id", type: FIELD.SELECT, label: "Customer", width: "w-48", options: [] },
  { key: "method", type: FIELD.SELECT, label: "Method", width: "w-32",
    options: Object.entries(METHODS).map(([v, l]) => ({ value: v, label: l })) },
  { key: "bank_id", type: FIELD.SELECT, label: "Bank", width: "w-40", options: [] },
  { key: "amount", type: FIELD.NUMBER_RANGE, label: "Amount", minKey: "min_amount", maxKey: "max_amount" },
  { key: "has_tds", type: FIELD.TOGGLE, label: "TDS", placeholder: "Has TDS" },
];

export default function Payments() {
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [open, setOpen] = useState(false);
  const [openInvoices, setOpenInvoices] = useState([]);
  const [form, setForm] = useState({ customer_id: "", payment_date: new Date().toISOString().slice(0, 10),
    amount: "", tds_amount: "", method: "upi", reference_no: "", notes: "", bank_id: "" });
  const [allocs, setAllocs] = useState({});
  const [banks, setBanks] = useState([]);
  const { values, setFilter, clearFilters, activeCount, apiParams } = useListFilters(BASE_SCHEMA);

  const schema = useMemo(() => BASE_SCHEMA.map((f) => {
    if (f.key === "customer_id") return { ...f, options: customers.map((c) => ({ value: c.id, label: c.legal_name })) };
    if (f.key === "bank_id") return { ...f, options: banks.map((b) => ({ value: b.id, label: b.bank_name || b.label })) };
    return f;
  }), [customers, banks]);

  const load = () => api.get("/payments", { params: apiParams }).then((r) => setRows(Array.isArray(r.data) ? r.data : r.data?.items || [])).catch(() => {});
  useEffect(() => { load(); }, [apiParams]); // eslint-disable-line
  useEffect(() => {
    api.get("/customers").then((r) => setCustomers(r.data)).catch(() => {});
    api.get("/banks", { params: { active_only: false } }).then((r) => {
      setBanks(r.data || []);
      const primary = (r.data || []).find((b) => b.primary) || (r.data || []).find((b) => b.account_type === "bank");
      if (primary) setForm((f) => ({ ...f, bank_id: f.bank_id || primary.id }));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (form.method === "cash") {
      const cash = banks.find((b) => b.account_type === "cash");
      if (cash) setForm((f) => ({ ...f, bank_id: cash.id }));
    }
  }, [form.method, banks]);

  useEffect(() => {
    if (form.customer_id) {
      api.get(`/payments/open-invoices/${form.customer_id}`).then((r) => setOpenInvoices(r.data)).catch(() => {});
      setAllocs({});
    } else setOpenInvoices([]);
  }, [form.customer_id]);

  const totalAlloc = Object.values(allocs).reduce((s, v) => s + Number(v || 0), 0);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/payments", {
        ...form, amount: Number(form.amount), tds_amount: Number(form.tds_amount || 0),
        allocations: Object.entries(allocs).filter(([, v]) => Number(v) > 0)
          .map(([invoice_id, amount]) => ({ invoice_id, amount: Number(amount) })),
      });
      toast.success("Payment recorded & receipt numbered");
      setOpen(false);
      const primary = banks.find((b) => b.primary) || banks.find((b) => b.account_type === "bank");
      setForm({ customer_id: "", payment_date: new Date().toISOString().slice(0, 10), amount: "", tds_amount: "", method: "upi", reference_no: "", notes: "", bank_id: primary?.id || "" });
      setAllocs({});
      load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const del = async (pid) => {
    if (!window.confirm("Reverse this payment and restore invoice balances?")) return;
    try {
      await api.delete(`/payments/${pid}`);
      toast.success("Payment reversed");
      load();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  return (
    <Layout title="Payments & Receipts"
      actions={can("admin", "accountant", "ops") && (
        <Button data-testid="record-payment-btn" size="sm" onClick={() => setOpen(true)}
          className="bg-[#0F284E] hover:bg-[#17386D] text-white"><Plus className="w-4 h-4 mr-1" /> Record Payment</Button>)}>
      <FilterBar schema={schema} values={values} setFilter={setFilter}
        clearFilters={clearFilters} activeCount={activeCount} testId="payment-filters" />
      <div className="bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-sm pwa-table" data-testid="payments-table">
          <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
            <th className="text-left px-3 py-2">Receipt No</th><th className="text-left px-3 py-2">Date</th>
            <th className="text-left px-3 py-2">Customer</th><th className="text-left px-3 py-2">Method</th>
            <th className="text-left px-3 py-2">Reference</th><th className="text-right px-3 py-2">Amount</th>
            <th className="text-left px-3 py-2">Allocated To</th><th className="text-right px-3 py-2">Unallocated</th>
            <th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {(rows || []).map((p) => (
              <tr key={p.id} data-testid={`payment-row-${p.id}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                <td className="px-3 py-2 font-mono text-xs font-semibold text-[#0066CC]">{p.receipt_no}</td>
                <td className="px-3 py-2 text-xs">{fmtDate(p.payment_date)}</td>
                <td className="px-3 py-2">{p.customer_name}</td>
                <td className="px-3 py-2 text-xs">{METHODS[p.method] || p.method}</td>
                <td className="px-3 py-2 font-mono text-xs">{p.reference_no || "—"}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{fmtINR(p.amount)}</td>
                <td className="px-3 py-2 text-xs font-mono">{(p.allocations || []).map((a) => a.invoice_no).join(", ") || "—"}
                  {p.tds_amount > 0 && <span className="block text-[10px] text-slate-400">TDS {fmtINR(p.tds_amount)}</span>}</td>
                <td className="px-3 py-2 text-right font-mono">{p.unallocated > 0 ? <span className="text-amber-700 font-semibold">{fmtINR(p.unallocated)}</span> : "—"}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <a data-testid={`receipt-pdf-${p.id}`} href={pdfUrl(`/payments/${p.id}/receipt-pdf`)} target="_blank" rel="noreferrer"
                    className="inline-block p-1.5 rounded hover:bg-slate-100 text-slate-500" title="Receipt PDF"><Download className="w-3.5 h-3.5" /></a>
                  {can("admin", "accountant") && (
                    <button data-testid={`delete-payment-${p.id}`} onClick={() => del(p.id)}
                      className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600" title="Reverse payment"><Trash2 className="w-3.5 h-3.5" /></button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty label="No payments recorded yet" />}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl bg-white" data-testid="payment-dialog">
          <DialogHeader><DialogTitle className="font-heading">Record Payment</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Customer *</Label>
                <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
                  <SelectTrigger data-testid="payment-customer-select"><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent className="bg-white max-h-64">{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.legal_name}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><Label>Date *</Label>
                <Input data-testid="payment-date-input" type="date" required value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} /></div>
              <div><Label>Method</Label>
                <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                  <SelectTrigger data-testid="payment-method-select"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">{Object.entries(METHODS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><Label>Amount (cash) *</Label>
                <Input data-testid="payment-amount-input" type="number" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="font-mono" /></div>
              <div><Label>TDS amount</Label>
                <Input data-testid="payment-tds-input" type="number" step="0.01" value={form.tds_amount} onChange={(e) => setForm({ ...form, tds_amount: e.target.value })} className="font-mono" /></div>
              <div><Label>Bank / Cash account</Label>
                <Select value={form.bank_id} onValueChange={(v) => setForm({ ...form, bank_id: v })}>
                  <SelectTrigger data-testid="payment-bank-select"><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent className="bg-white">{banks.map((b) => <SelectItem key={b.id} value={b.id}>{b.label || b.bank_name}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="col-span-2"><Label>Reference</Label>
                <Input data-testid="payment-ref-input" value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></div>
            </div>
            {openInvoices.length > 0 && (
              <div className="border border-slate-200 rounded-md overflow-hidden">
                <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-semibold uppercase text-slate-600">Allocate to open invoices (optional)</div>
                <table className="w-full text-xs pwa-table">
                  <thead><tr className="bg-slate-100 text-[10px] uppercase"><th className="text-left px-2 py-1">Invoice</th><th className="text-right px-2 py-1">Balance</th><th className="text-right px-2 py-1">Allocate</th></tr></thead>
                  <tbody>
                    {openInvoices.map((inv) => (
                      <tr key={inv.id} className="border-t border-slate-100">
                        <td className="px-2 py-1 font-mono">{inv.invoice_no}</td>
                        <td className="px-2 py-1 text-right font-mono">{fmtINR(inv.balance)}</td>
                        <td className="px-2 py-1 text-right">
                          <Input type="number" step="0.01" className="h-7 w-28 ml-auto font-mono text-xs"
                            value={allocs[inv.id] || ""} onChange={(e) => setAllocs({ ...allocs, [inv.id]: e.target.value })} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-3 py-1.5 text-[11px] text-slate-500">Allocated {fmtINR(totalAlloc)}</div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button data-testid="payment-save-btn" type="submit" disabled={!form.customer_id || !form.amount}
                className="bg-[#0F284E] hover:bg-[#17386D] text-white">Save receipt</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
