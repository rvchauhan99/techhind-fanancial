import React, { useEffect, useState } from "react";
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

const METHODS = { upi: "UPI", neft: "NEFT", rtgs: "RTGS", cheque: "Cheque", cash: "Cash", card: "Card" };

export default function Payments() {
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [open, setOpen] = useState(false);
  const [openInvoices, setOpenInvoices] = useState([]);
  const [form, setForm] = useState({ customer_id: "", payment_date: new Date().toISOString().slice(0, 10),
    amount: "", tds_amount: "", method: "upi", reference_no: "", notes: "" });
  const [allocs, setAllocs] = useState({});

  const load = () => api.get("/payments").then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => {
    load();
    api.get("/customers").then((r) => setCustomers(r.data)).catch(() => {});
  }, []);

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
      setForm({ customer_id: "", payment_date: new Date().toISOString().slice(0, 10), amount: "", tds_amount: "", method: "upi", reference_no: "", notes: "" });
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
      <div className="bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-sm" data-testid="payments-table">
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
                {p.tds_amount > 0 && <td className="hidden"></td>}
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
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Customer *</Label>
                <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
                  <SelectTrigger data-testid="payment-customer-select"><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent className="bg-white max-h-64">{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.legal_name}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><Label>Date *</Label>
                <Input data-testid="payment-date-input" type="date" required value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} /></div>
              <div><Label>Amount received (₹) *</Label>
                <Input data-testid="payment-amount-input" type="number" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="font-mono" /></div>
              <div><Label>TDS deducted by customer (₹)</Label>
                <Input data-testid="payment-tds-input" type="number" step="0.01" value={form.tds_amount} onChange={(e) => setForm({ ...form, tds_amount: e.target.value })} className="font-mono" placeholder="0.00" /></div>
              <div><Label>Method</Label>
                <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                  <SelectTrigger data-testid="payment-method-select"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">{Object.entries(METHODS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><Label>Reference (UTR/UPI/cheque no)</Label>
                <Input data-testid="payment-ref-input" value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} className="font-mono" /></div>
            </div>
            {openInvoices.length > 0 && (
              <div className="border border-slate-200 rounded-md" data-testid="allocation-table">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  Allocate to open invoices (leave blank to skip)</div>
                {openInvoices.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 px-3 py-2 border-b border-slate-100 last:border-0 text-sm">
                    <span className="font-mono text-xs w-36">{i.invoice_no}</span>
                    <span className="text-xs text-slate-500 flex-1">due {fmtDate(i.due_date)}</span>
                    <span className="font-mono text-xs w-28 text-right">bal {fmtINR(i.balance)}</span>
                    <Input data-testid={`alloc-${i.id}`} type="number" step="0.01" max={i.balance} placeholder="0.00"
                      value={allocs[i.id] || ""} onChange={(e) => setAllocs({ ...allocs, [i.id]: e.target.value })}
                      className="w-28 h-8 text-right font-mono" />
                    <button type="button" data-testid={`alloc-full-${i.id}`} onClick={() => setAllocs({ ...allocs, [i.id]: i.balance })}
                      className="text-[10px] font-semibold text-[#0066CC] hover:underline">FULL</button>
                  </div>
                ))}
              </div>
            )}
            {form.customer_id && !openInvoices.length && (
              <div className="text-xs text-slate-500 border border-slate-200 rounded-md px-3 py-2">No open invoices — payment will be recorded as unallocated advance.</div>)}
            <div className="flex items-center justify-between text-sm pt-1">
              <span className={totalAlloc > Number(form.amount || 0) + Number(form.tds_amount || 0) ? "text-red-600 font-semibold" : "text-slate-600"} data-testid="alloc-summary">
                Allocated {fmtINR(totalAlloc)} of {fmtINR(Number(form.amount || 0) + Number(form.tds_amount || 0))} (incl. TDS {fmtINR(form.tds_amount || 0)}) · Unallocated {fmtINR(Math.max(Number(form.amount || 0) + Number(form.tds_amount || 0) - totalAlloc, 0))}</span>
              <Button data-testid="payment-save-btn" type="submit" disabled={!form.customer_id || !form.amount || totalAlloc > Number(form.amount || 0) + Number(form.tds_amount || 0)}
                className="bg-[#0F284E] hover:bg-[#17386D] text-white">Record Payment</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
