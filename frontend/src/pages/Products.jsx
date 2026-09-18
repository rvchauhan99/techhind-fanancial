import React, { useEffect, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import api, { apiError } from "../lib/api";
import { fmtINR } from "../lib/format";
import Layout from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";

const TYPES = { saas_plan: "SaaS Plan", one_time: "One-time Sale", service: "Service", addon: "Add-on" };
const CYCLES = { monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half-yearly", yearly: "Yearly", one_time: "One-time" };

const emptyForm = { name: "", type: "saas_plan", hsn_sac: "998314", tax_rate: 18, price: 0,
  billing_cycle: "monthly", unit: "Nos", description: "", active: true };

export default function Products() {
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const load = () => api.get("/products").then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (p) => { setEditing(p); setForm({ ...p }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, price: Number(form.price), tax_rate: Number(form.tax_rate) };
      if (editing) await api.patch(`/products/${editing.id}`, payload);
      else await api.post("/products", payload);
      toast.success(editing ? "Product updated" : "Product created");
      setOpen(false);
      load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <Layout title="Products & Plans"
      actions={can("admin", "accountant", "ops") && (
        <Button data-testid="new-product-btn" size="sm" onClick={openNew} className="bg-[#0F284E] hover:bg-[#17386D] text-white">
          <Plus className="w-4 h-4 mr-1" /> New Product</Button>)}>
      <div className="bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-sm" data-testid="products-table">
          <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
            <th className="text-left px-3 py-2">Name</th><th className="text-left px-3 py-2">Type</th>
            <th className="text-left px-3 py-2">HSN/SAC</th><th className="text-left px-3 py-2">Cycle</th>
            <th className="text-right px-3 py-2">Price</th><th className="text-right px-3 py-2">GST</th>
            <th className="text-left px-3 py-2">Active</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {(rows || []).map((p) => (
              <tr key={p.id} data-testid={`product-row-${p.id}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                <td className="px-3 py-2"><div className="font-medium text-slate-900">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.description}</div></td>
                <td className="px-3 py-2 text-xs">{TYPES[p.type] || p.type}</td>
                <td className="px-3 py-2 font-mono text-xs">{p.hsn_sac}</td>
                <td className="px-3 py-2 text-xs">{CYCLES[p.billing_cycle] || p.billing_cycle}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtINR(p.price)}</td>
                <td className="px-3 py-2 text-right font-mono">{p.tax_rate}%</td>
                <td className="px-3 py-2">{p.active
                  ? <span className="text-[11px] font-semibold text-emerald-700">Yes</span>
                  : <span className="text-[11px] font-semibold text-slate-400">No</span>}</td>
                <td className="px-3 py-2 text-right">
                  {can("admin", "accountant", "ops") && (
                    <button data-testid={`edit-product-${p.id}`} onClick={() => openEdit(p)}
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-500"><Pencil className="w-3.5 h-3.5" /></button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl bg-white" data-testid="product-dialog">
          <DialogHeader><DialogTitle className="font-heading">{editing ? "Edit Product" : "New Product"}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Name *</Label>
              <Input data-testid="product-name-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger data-testid="product-type-select"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white">{Object.entries(TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label>Billing cycle</Label>
              <Select value={form.billing_cycle} onValueChange={(v) => setForm({ ...form, billing_cycle: v })}>
                <SelectTrigger data-testid="product-cycle-select"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white">{Object.entries(CYCLES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label>HSN/SAC</Label><Input value={form.hsn_sac} onChange={(e) => setForm({ ...form, hsn_sac: e.target.value })} className="font-mono" /></div>
            <div><Label>GST rate %</Label>
              <Select value={String(form.tax_rate)} onValueChange={(v) => setForm({ ...form, tax_rate: Number(v) })}>
                <SelectTrigger data-testid="product-tax-select"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white">{[0, 5, 12, 18, 28].map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label>Price (₹) *</Label>
              <Input data-testid="product-price-input" type="number" step="0.01" required value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })} className="font-mono" /></div>
            <div><Label>Unit</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
            <div className="col-span-2"><Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="col-span-2 flex items-center gap-2">
              <Switch data-testid="product-active-switch" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <Label>Active (visible for new invoices)</Label></div>
            <div className="col-span-2 flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button data-testid="product-save-btn" type="submit" className="bg-[#0F284E] hover:bg-[#17386D] text-white">Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
