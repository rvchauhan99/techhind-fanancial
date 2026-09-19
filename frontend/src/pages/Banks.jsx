import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Landmark, Wallet } from "lucide-react";
import { toast } from "sonner";
import api, { apiError } from "../lib/api";
import { fmtINR, fmtDate } from "../lib/format";
import Layout, { Empty } from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const emptyAcct = {
  account_type: "bank", bank_name: "", account_name: "TechHind Pvt Ltd",
  account_no: "", ifsc: "", branch: "", upi: "",
  opening_balance: "0", opening_date: new Date().toISOString().slice(0, 10), primary: false,
};

export default function Banks() {
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyAcct);
  const [cashTotal, setCashTotal] = useState(null);

  const load = () => {
    api.get("/banks", { params: { active_only: false } }).then((r) => setRows(r.data)).catch(() => setRows([]));
    api.get("/banks/cash-position").then((r) => setCashTotal(r.data.total)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post("/banks", {
        ...form,
        opening_balance: Number(form.opening_balance || 0),
        primary: !!form.primary,
      });
      toast.success("Bank account created");
      setOpen(false);
      setForm(emptyAcct);
      load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <Layout
      title="Bank Ledger"
      actions={can("admin", "accountant") && (
        <Button data-testid="new-bank-btn" size="sm" onClick={() => setOpen(true)}
          className="bg-[#0F284E] hover:bg-[#17386D] text-white">
          <Plus className="w-4 h-4 mr-1" /> Add Account
        </Button>
      )}
    >
      <div className="flex items-center gap-4 text-sm" data-testid="bank-cash-position">
        <span className="text-slate-500">Cash + bank position</span>
        <span className="font-mono font-bold text-lg text-emerald-700">{fmtINR(cashTotal ?? 0)}</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-sm" data-testid="banks-table">
          <thead>
            <tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
              <th className="text-left px-3 py-2">Account</th>
              <th className="text-left px-3 py-2">Type</th>
              <th className="text-left px-3 py-2">A/c No</th>
              <th className="text-left px-3 py-2">IFSC</th>
              <th className="text-left px-3 py-2">Opening</th>
              <th className="text-right px-3 py-2">Live Balance</th>
              <th className="text-left px-3 py-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((b) => (
              <tr key={b.id} data-testid={`bank-row-${b.id}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                <td className="px-3 py-2">
                  <Link to={`/banks/${b.id}`} className="font-semibold text-[#0066CC] hover:underline flex items-center gap-1.5"
                    data-testid={`bank-link-${b.id}`}>
                    {b.account_type === "cash" ? <Wallet className="w-3.5 h-3.5" /> : <Landmark className="w-3.5 h-3.5" />}
                    {b.bank_name}
                  </Link>
                  <div className="text-[10px] text-slate-400">{b.branch || b.account_name}</div>
                </td>
                <td className="px-3 py-2 text-xs uppercase">{b.account_type}</td>
                <td className="px-3 py-2 font-mono text-xs">{b.account_no || "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{b.ifsc || "—"}</td>
                <td className="px-3 py-2 text-xs">
                  <span className="font-mono">{fmtINR(b.opening_balance)}</span>
                  <span className="block text-[10px] text-slate-400">{fmtDate(b.opening_date)}</span>
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{fmtINR(b.live_balance)}</td>
                <td className="px-3 py-2 text-[10px]">
                  {b.primary && <span className="mr-1 px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold">PRIMARY</span>}
                  {b.is_active === false && <span className="px-1.5 py-0.5 rounded border border-slate-200 text-slate-500">INACTIVE</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty label="No bank accounts yet" />}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg bg-white" data-testid="bank-dialog">
          <DialogHeader><DialogTitle className="font-heading">Add Bank Account</DialogTitle></DialogHeader>
          <form onSubmit={save} className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={form.account_type} onValueChange={(v) => setForm({ ...form, account_type: v })}>
                <SelectTrigger data-testid="bank-type-select"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="bank">Bank</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Name *</Label>
              <Input data-testid="bank-name-input" required value={form.bank_name}
                onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
            </div>
            <div>
              <Label>A/c No</Label>
              <Input data-testid="bank-acno-input" className="font-mono" value={form.account_no}
                onChange={(e) => setForm({ ...form, account_no: e.target.value })} />
            </div>
            <div>
              <Label>IFSC</Label>
              <Input className="font-mono" value={form.ifsc}
                onChange={(e) => setForm({ ...form, ifsc: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label>Branch</Label>
              <Input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
            </div>
            <div>
              <Label>Opening balance</Label>
              <Input data-testid="bank-opening-input" type="number" step="0.01" className="font-mono"
                value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} />
            </div>
            <div>
              <Label>Opening date</Label>
              <Input type="date" value={form.opening_date}
                onChange={(e) => setForm({ ...form, opening_date: e.target.value })} />
            </div>
            <div className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" id="bank-primary" checked={!!form.primary}
                onChange={(e) => setForm({ ...form, primary: e.target.checked })}
                data-testid="bank-primary-check" />
              <label htmlFor="bank-primary">Primary (invoice PDF bank details)</label>
            </div>
            <div className="col-span-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button data-testid="bank-save-btn" type="submit"
                className="bg-[#0F284E] hover:bg-[#17386D] text-white">Create</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
