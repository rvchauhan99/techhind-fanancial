import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import api, { apiError } from "../lib/api";
import { INDIAN_STATES } from "../lib/format";
import Layout, { Empty } from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import FilterBar, { FIELD } from "../components/filters/FilterBar";
import { useListFilters } from "../hooks/useListFilters";

const emptyForm = { legal_name: "", trade_name: "", gstin: "", pan: "", state: "", state_code: "",
  billing_address: "", contact_name: "", contact_email: "", contact_phone: "", crm_tenant_key: "", notes: "" };

const SCHEMA = [
  { key: "q", type: FIELD.TEXT, label: "Search", placeholder: "Name / GSTIN…", width: "w-48" },
  { key: "state_code", type: FIELD.SELECT, label: "State", width: "w-48",
    options: INDIAN_STATES.map(([code, name]) => ({ value: code, label: `${code} — ${name}` })) },
  { key: "has_gstin", type: FIELD.TOGGLE, label: "GSTIN", placeholder: "Has GSTIN" },
];

export default function Customers() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const { values, setFilter, clearFilters, activeCount, apiParams } = useListFilters(SCHEMA);

  const load = () => api.get("/customers", { params: apiParams }).then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); }, [apiParams]); // eslint-disable-line

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/customers", {
        ...form,
        contacts: [{ name: form.contact_name, email: form.contact_email, phone: form.contact_phone }],
      });
      toast.success("Customer created");
      setOpen(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout
      title="Customers 360"
      actions={can("admin", "accountant", "ops") && (
        <Button data-testid="new-customer-btn" onClick={() => setOpen(true)} className="bg-[#0F284E] hover:bg-[#17386D] text-white" size="sm">
          <Plus className="w-4 h-4 mr-1" /> New Customer
        </Button>
      )}
    >
      <FilterBar schema={SCHEMA} values={values} setFilter={setFilter}
        clearFilters={clearFilters} activeCount={activeCount} testId="customer-filters" />
      <div className="bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-sm" data-testid="customers-table">
          <thead>
            <tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
              <th className="text-left px-3 py-2 font-semibold">Customer</th>
              <th className="text-left px-3 py-2 font-semibold">GSTIN</th>
              <th className="text-left px-3 py-2 font-semibold">State</th>
              <th className="text-left px-3 py-2 font-semibold">Contact</th>
              <th className="text-left px-3 py-2 font-semibold">CRM Ref</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((c) => (
              <tr key={c.id} data-testid={`customer-row-${c.id}`} onClick={() => navigate(`/customers/${c.id}`)}
                className="border-t border-slate-100 hover:bg-slate-50/80 cursor-pointer transition-colors">
                <td className="px-3 py-2"><div className="font-medium text-slate-900">{c.legal_name}</div>
                  <div className="text-xs text-slate-500">{c.trade_name}</div></td>
                <td className="px-3 py-2 font-mono text-xs">{c.gstin || "—"}</td>
                <td className="px-3 py-2 text-slate-600">{c.state} ({c.state_code})</td>
                <td className="px-3 py-2 text-xs text-slate-600">{(c.contacts || [])[0]?.name}<br />{(c.contacts || [])[0]?.email}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{c.crm_tenant_key || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty label="No customers found" />}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl bg-white" data-testid="customer-dialog">
          <DialogHeader><DialogTitle className="font-heading">New Customer</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Legal name *</Label>
              <Input data-testid="customer-legal-name-input" required value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} /></div>
            <div><Label>Trade name</Label><Input value={form.trade_name} onChange={(e) => setForm({ ...form, trade_name: e.target.value })} /></div>
            <div><Label>GSTIN</Label><Input data-testid="customer-gstin-input" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} className="font-mono" /></div>
            <div className="col-span-2"><Label>State (place of supply) *</Label>
              <Select value={form.state_code} onValueChange={(v) => { const s = INDIAN_STATES.find(([c]) => c === v); setForm({ ...form, state_code: v, state: s ? s[1] : "" }); }}>
                <SelectTrigger data-testid="customer-state-select"><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent className="bg-white max-h-64">{INDIAN_STATES.map(([code, name]) => (
                  <SelectItem key={code} value={code}>{code} — {name}</SelectItem>))}</SelectContent>
              </Select></div>
            <div className="col-span-2"><Label>Billing address</Label>
              <Input value={form.billing_address} onChange={(e) => setForm({ ...form, billing_address: e.target.value })} /></div>
            <div><Label>Contact name</Label><Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></div>
            <div><Label>Contact email</Label><Input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
            <div><Label>Contact phone</Label><Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></div>
            <div>
              <Label>Solar tenant key (crm_tenant_key)</Label>
              <Input
                value={form.crm_tenant_key}
                onChange={(e) => setForm({ ...form, crm_tenant_key: e.target.value })}
                className="font-mono"
                placeholder="Must match Solar tenant_key for support bridge"
              />
              <p className="text-[10px] text-slate-500 mt-0.5">
                Required for Solar support tickets. Set to the tenant&apos;s Solar tenant_key — unmatched creates return 422.
              </p>
            </div>
            <div className="col-span-2 flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button data-testid="customer-save-btn" type="submit" disabled={busy} className="bg-[#0F284E] hover:bg-[#17386D] text-white">
                {busy ? "Saving…" : "Create Customer"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
