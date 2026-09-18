import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, CheckCircle2, XCircle, Trash2, Send, Paperclip } from "lucide-react";
import { toast } from "sonner";
import api, { apiError, pdfUrl } from "../lib/api";
import { fmtINR, fmtDate } from "../lib/format";
import Layout, { StatusBadge, Empty } from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const emptyForm = { voucher_date: new Date().toISOString().slice(0, 10), category: "", narration: "",
  amount: "", tax_rate: 0, vendor_name: "", paid_via: "HDFC Bank", type: "expense" };

export default function Expenses() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const statusFilter = params.get("status") || "";
  const [rows, setRows] = useState(null);
  const [categories, setCategories] = useState([]);
  const [banks, setBanks] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState(statusFilter);
  const fileRefs = useRef({});

  const load = () => api.get("/vouchers", { params: { status: filter } }).then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); }, [filter]); // eslint-disable-line
  useEffect(() => {
    api.get("/settings/masters").then((r) => {
      setCategories((r.data.expense_categories || []).map((c) => c.name));
      setBanks((r.data.banks || []).map((b) => b.bank_name));
    }).catch(() => {});
  }, []);

  const act = async (vid, action, body) => {
    try {
      await api.post(`/vouchers/${vid}/${action}`, body || {});
      toast.success({ submit: "Submitted for approval", approve: "Voucher approved & posted", reject: "Voucher rejected" }[action] || "Done");
      load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const del = async (vid) => {
    if (!window.confirm("Delete this voucher?")) return;
    try {
      await api.delete(`/vouchers/${vid}`);
      toast.success("Voucher deleted");
      load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post("/vouchers", { ...form, amount: Number(form.amount), tax_rate: Number(form.tax_rate) });
      toast.success("Voucher created (draft)");
      setOpen(false);
      setForm(emptyForm);
      load();
    } catch (err) { toast.error(apiError(err)); }
  };

  const upload = async (vid, file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api.post(`/vouchers/${vid}/attachments`, fd);
      toast.success("Attachment uploaded");
      load();
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <Layout title="Expense Vouchers"
      actions={can("admin", "accountant", "ops") && (
        <Button data-testid="new-voucher-btn" size="sm" onClick={() => setOpen(true)}
          className="bg-[#0F284E] hover:bg-[#17386D] text-white"><Plus className="w-4 h-4 mr-1" /> New Voucher</Button>)}>
      <div className="flex items-center gap-2">
        <Select value={filter || "all"} onValueChange={(v) => setFilter(v === "all" ? "" : v)}>
          <SelectTrigger data-testid="voucher-status-filter" className="w-52 h-8 bg-white"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent className="bg-white">
            <SelectItem value="all">All statuses</SelectItem>
            {["draft", "pending_approval", "posted", "rejected"].map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-sm" data-testid="vouchers-table">
          <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
            <th className="text-left px-3 py-2">Voucher No</th><th className="text-left px-3 py-2">Date</th>
            <th className="text-left px-3 py-2">Category</th><th className="text-left px-3 py-2">Narration</th>
            <th className="text-right px-3 py-2">Amount</th><th className="text-right px-3 py-2">Tax</th>
            <th className="text-right px-3 py-2">Total</th><th className="text-left px-3 py-2">Status</th>
            <th className="text-left px-3 py-2">Files</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {(rows || []).map((v) => (
              <tr key={v.id} data-testid={`voucher-row-${v.id}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                <td className="px-3 py-2 font-mono text-xs font-semibold text-[#0066CC]">{v.voucher_no || <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-2 text-xs">{fmtDate(v.voucher_date)}</td>
                <td className="px-3 py-2">
                  <span className="text-xs font-medium">{v.category}</span>
                  {v.type === "salary_summary" && <span className="ml-1 text-[10px] font-semibold text-slate-500 border border-slate-200 rounded px-1">SALARY</span>}</td>
                <td className="px-3 py-2 text-xs text-slate-600 max-w-64 truncate" title={v.narration}>{v.narration}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtINR(v.amount)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtINR(v.tax_amount)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{fmtINR(v.total)}</td>
                <td className="px-3 py-2"><StatusBadge value={v.status} /></td>
                <td className="px-3 py-2 text-xs">
                  {(v.attachments || []).map((a) => (
                    <a key={a.path} href={pdfUrl(`/files/${a.path}`)} target="_blank" rel="noreferrer"
                      className="text-[#0066CC] hover:underline mr-2">{a.name}</a>))}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {["draft", "rejected"].includes(v.status) && can("admin", "accountant", "ops") && (<>
                    <input type="file" className="hidden" ref={(el) => (fileRefs.current[v.id] = el)} onChange={(e) => upload(v.id, e.target.files[0])} />
                    <button data-testid={`attach-voucher-${v.id}`} onClick={() => fileRefs.current[v.id]?.click()} title="Attach file"
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-500"><Paperclip className="w-3.5 h-3.5" /></button>
                    <button data-testid={`submit-voucher-${v.id}`} onClick={() => act(v.id, "submit")} title="Submit for approval"
                      className="p-1.5 rounded hover:bg-blue-50 text-slate-500 hover:text-[#0066CC]"><Send className="w-3.5 h-3.5" /></button>
                    <button data-testid={`delete-voucher-${v.id}`} onClick={() => del(v.id)} title="Delete"
                      className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>)}
                  {v.status === "pending_approval" && can("admin", "accountant") && (<>
                    <button data-testid={`approve-voucher-${v.id}`} onClick={() => act(v.id, "approve")} title="Approve & post"
                      className="p-1.5 rounded hover:bg-emerald-50 text-slate-500 hover:text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /></button>
                    <button data-testid={`reject-voucher-${v.id}`} onClick={() => act(v.id, "reject", { reason: "Rejected by approver" })} title="Reject"
                      className="p-1.5 rounded hover:bg-red-50 text-slate-500 hover:text-red-600"><XCircle className="w-3.5 h-3.5" /></button>
                  </>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty label="No vouchers in this view" />}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl bg-white" data-testid="voucher-dialog">
          <DialogHeader><DialogTitle className="font-heading">New Expense Voucher</DialogTitle></DialogHeader>
          <form onSubmit={save} className="grid grid-cols-2 gap-3">
            <div><Label>Date *</Label>
              <Input data-testid="voucher-date-input" type="date" required value={form.voucher_date} onChange={(e) => setForm({ ...form, voucher_date: e.target.value })} /></div>
            <div><Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger data-testid="voucher-type-select"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="salary_summary">Salary / Statutory summary</SelectItem>
                </SelectContent>
              </Select></div>
            <div className="col-span-2"><Label>Category *</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger data-testid="voucher-category-select"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent className="bg-white">{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="col-span-2"><Label>Narration *</Label>
              <Textarea data-testid="voucher-narration-input" required rows={2} value={form.narration} onChange={(e) => setForm({ ...form, narration: e.target.value })} /></div>
            <div><Label>Amount (₹, pre-tax) *</Label>
              <Input data-testid="voucher-amount-input" type="number" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="font-mono" /></div>
            <div><Label>GST rate %</Label>
              <Select value={String(form.tax_rate)} onValueChange={(v) => setForm({ ...form, tax_rate: Number(v) })}>
                <SelectTrigger data-testid="voucher-tax-select"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white">{[0, 5, 12, 18, 28].map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label>Vendor / payee</Label>
              <Input value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} /></div>
            <div><Label>Paid via</Label>
              <Select value={form.paid_via} onValueChange={(v) => setForm({ ...form, paid_via: v })}>
                <SelectTrigger data-testid="voucher-paidvia-select"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white">{banks.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="col-span-2 text-xs text-slate-500 font-mono">
              Total: {fmtINR(Number(form.amount || 0) * (1 + Number(form.tax_rate || 0) / 100))} — voucher number assigned on approval (TH/EV/…)</div>
            <div className="col-span-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button data-testid="voucher-save-btn" type="submit" disabled={!form.category}
                className="bg-[#0F284E] hover:bg-[#17386D] text-white">Create Voucher</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
