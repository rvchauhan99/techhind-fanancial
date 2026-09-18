import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Pencil, Bell, BellRing } from "lucide-react";
import { toast } from "sonner";
import api, { apiError } from "../lib/api";
import { fmtINR, fmtDate } from "../lib/format";
import Layout, { StatusBadge, Empty } from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";

const STATUSES = ["trial", "active", "grace", "overdue", "paused", "cancelled", "expired"];
const CYCLES = { monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half-yearly", yearly: "Yearly" };

const emptyForm = { customer_id: "", product_id: "", plan_name: "", status: "active",
  start_on: new Date().toISOString().slice(0, 10), next_renewal_on: "", billing_cycle: "monthly",
  price: 0, auto_renew: true, notes: "" };

export default function Subscriptions() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const bucket = params.get("bucket") || "";
  const statusFilter = params.get("status") || "";
  const [rows, setRows] = useState(null);
  const [renewals, setRenewals] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const load = () => {
    api.get("/subscriptions").then((r) => setRows(r.data)).catch(() => {});
    api.get("/subscriptions/renewals").then((r) => setRenewals(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.get("/customers").then((r) => setCustomers(r.data)).catch(() => {});
    api.get("/products").then((r) => setProducts(r.data.filter((p) => p.active))).catch(() => {});
  }, []);

  const shown = useMemo(() => {
    if (!rows) return [];
    let list = rows;
    if (bucket && renewals) list = renewals.buckets[bucket] || [];
    if (statusFilter) list = list.filter((s) => s.status === statusFilter);
    return list;
  }, [rows, renewals, bucket, statusFilter]);

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (s) => { setEditing(s); setForm({ ...s }); setOpen(true); };

  const pickProduct = (pid) => {
    const p = products.find((x) => x.id === pid);
    if (!p) return setForm({ ...form, product_id: pid });
    setForm({ ...form, product_id: pid, plan_name: p.name, price: p.price,
      billing_cycle: p.billing_cycle === "one_time" ? "monthly" : p.billing_cycle });
  };

  const sendReminder = async (sid) => {
    try {
      const { data } = await api.post(`/subscriptions/${sid}/reminder`);
      toast.success(`Reminder sent to ${data.log.to} (mocked)`);
      load();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const bulkRemind = async () => {
    if (!bucket || !shown.length) return;
    try {
      const { data } = await api.post("/subscriptions/reminders/bulk", { ids: shown.map((s) => s.id) });
      toast.success(`${data.sent} reminders sent (mocked)`);
      load();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, price: Number(form.price) };
      if (editing) await api.patch(`/subscriptions/${editing.id}`, payload);
      else await api.post("/subscriptions", payload);
      toast.success(editing ? "Subscription updated" : "Subscription created");
      setOpen(false);
      load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const bucketTabs = [["", "All"], ["overdue", "Overdue"], ["in_7_days", "≤ 7 days"], ["in_15_days", "≤ 15 days"], ["in_30_days", "≤ 30 days"]];

  return (
    <Layout title="Subscriptions & Renewals"
      actions={can("admin", "accountant", "ops") && (
        <Button data-testid="new-subscription-btn" size="sm" onClick={openNew} className="bg-[#0F284E] hover:bg-[#17386D] text-white">
          <Plus className="w-4 h-4 mr-1" /> New Subscription</Button>)}>
      <div className="flex items-center gap-2" data-testid="subscription-filters">
        {bucketTabs.map(([k, label]) => (
          <button key={k || "all"} data-testid={`sub-filter-${k || "all"}`}
            onClick={() => setParams(k ? { bucket: k } : {})}
            className={`text-xs font-semibold border rounded px-2.5 py-1 transition-colors ${bucket === k ? "bg-[#0F284E] text-white border-[#0F284E]" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
            {label}{renewals && k ? ` (${renewals.counts[k]})` : ""}
          </button>
        ))}
        <Select value={statusFilter || "all"} onValueChange={(v) => setParams({ ...(bucket ? { bucket } : {}), ...(v !== "all" ? { status: v } : {}) })}>
          <SelectTrigger data-testid="sub-status-filter" className="w-44 h-8 bg-white"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent className="bg-white">
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {bucket && shown.length > 0 && can("admin", "accountant", "ops") && (
          <Button data-testid="bulk-remind-btn" size="sm" variant="outline" onClick={bulkRemind}
            className="h-8 text-xs text-amber-700 border-amber-200 hover:bg-amber-50">
            <BellRing className="w-3.5 h-3.5 mr-1" /> Send {shown.length} reminders (mock)</Button>)}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-sm" data-testid="subscriptions-table">
          <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
            <th className="text-left px-3 py-2">Customer</th><th className="text-left px-3 py-2">Plan</th>
            <th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Cycle</th>
            <th className="text-right px-3 py-2">Price</th><th className="text-right px-3 py-2">MRR</th>
            <th className="text-left px-3 py-2">Next Renewal</th><th className="text-right px-3 py-2">Days</th>
            <th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {shown.map((s) => {
              const days = s.days_to_renewal ?? Math.ceil((new Date(s.next_renewal_on) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
              return (
                <tr key={s.id} data-testid={`subscription-row-${s.id}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                  <td className="px-3 py-2 font-medium text-slate-900">{s.customer_name}</td>
                  <td className="px-3 py-2 text-slate-700">{s.plan_name}</td>
                  <td className="px-3 py-2"><StatusBadge value={s.status} /></td>
                  <td className="px-3 py-2 text-xs capitalize">{s.billing_cycle.replace("_", " ")}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtINR(s.price)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtINR(s.mrr)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{fmtDate(s.next_renewal_on)}</td>
                  <td className={`px-3 py-2 text-right font-mono text-xs font-bold ${days < 0 ? "text-red-600" : days <= 7 ? "text-amber-600" : "text-slate-500"}`}>{days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}</td>
                  <td className="px-3 py-2 text-right">
                    {can("admin", "accountant", "ops") && (<>
                      <button data-testid={`remind-subscription-${s.id}`} onClick={() => sendReminder(s.id)}
                        title={s.reminder_sent_on ? `Reminder sent ${s.reminder_sent_on.slice(0, 10)}` : "Send renewal reminder (mock)"}
                        className={`p-1.5 rounded hover:bg-amber-50 ${s.reminder_sent_on ? "text-amber-500" : "text-slate-400 hover:text-amber-600"}`}>
                        <Bell className="w-3.5 h-3.5" /></button>
                      <button data-testid={`edit-subscription-${s.id}`} onClick={() => openEdit(s)}
                        className="p-1.5 rounded hover:bg-slate-100 text-slate-500"><Pencil className="w-3.5 h-3.5" /></button>
                    </>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows && !shown.length && <Empty label="No subscriptions in this view" />}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl bg-white" data-testid="subscription-dialog">
          <DialogHeader><DialogTitle className="font-heading">{editing ? "Edit Subscription" : "New Subscription"}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Customer *</Label>
              <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
                <SelectTrigger data-testid="sub-customer-select"><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent className="bg-white max-h-64">{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.legal_name}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="col-span-2"><Label>Product / plan</Label>
              <Select value={form.product_id || "none"} onValueChange={(v) => v !== "none" && pickProduct(v)}>
                <SelectTrigger data-testid="sub-product-select"><SelectValue placeholder="Select plan" /></SelectTrigger>
                <SelectContent className="bg-white max-h-64"><SelectItem value="none">Custom…</SelectItem>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} — {fmtINR(p.price)}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="col-span-2"><Label>Plan name *</Label>
              <Input data-testid="sub-plan-input" required value={form.plan_name} onChange={(e) => setForm({ ...form, plan_name: e.target.value })} /></div>
            <div><Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="sub-status-select"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white">{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label>Billing cycle</Label>
              <Select value={form.billing_cycle} onValueChange={(v) => setForm({ ...form, billing_cycle: v })}>
                <SelectTrigger data-testid="sub-cycle-select"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white">{Object.entries(CYCLES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label>Start date *</Label>
              <Input data-testid="sub-start-input" type="date" required value={form.start_on} onChange={(e) => setForm({ ...form, start_on: e.target.value })} /></div>
            <div><Label>Next renewal *</Label>
              <Input data-testid="sub-renewal-input" type="date" required value={form.next_renewal_on} onChange={(e) => setForm({ ...form, next_renewal_on: e.target.value })} /></div>
            <div><Label>Price per cycle (₹)</Label>
              <Input data-testid="sub-price-input" type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="font-mono" /></div>
            <div className="flex items-end gap-2 pb-1">
              <Switch data-testid="sub-autorenew-switch" checked={form.auto_renew} onCheckedChange={(v) => setForm({ ...form, auto_renew: v })} />
              <Label>Auto-renew</Label></div>
            <div className="col-span-2 flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button data-testid="sub-save-btn" type="submit" className="bg-[#0F284E] hover:bg-[#17386D] text-white">Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
