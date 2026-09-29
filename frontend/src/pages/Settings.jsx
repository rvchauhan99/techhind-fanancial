import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2, Upload, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import api, { apiError, pdfUrl } from "../lib/api";
import { fmtDateTime, INDIAN_STATES } from "../lib/format";
import Layout, { Empty } from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import FilterBar, { FIELD } from "../components/filters/FilterBar";
import { useListFilters } from "../hooks/useListFilters";

function CompanyTab() {
  const { can } = useAuth();
  const [form, setForm] = useState(null);
  const logoRef = useRef(null);
  const stampRef = useRef(null);
  const signatureRef = useRef(null);

  const load = () => api.get("/settings/company").then((r) => setForm(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  if (!form) return <div className="text-sm text-slate-500">Loading…</div>;
  const ro = !can("admin");
  const bank = form.bank || {};
  const setBank = (k, v) => setForm({ ...form, bank: { ...bank, [k]: v } });

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.put("/settings/company", form);
      toast.success("Company profile saved");
    } catch (err) { toast.error(apiError(err)); }
  };

  const uploadAsset = async (kind, file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api.post(`/settings/company/assets/${kind}`, fd);
      toast.success(`${kind.charAt(0).toUpperCase() + kind.slice(1)} updated — applies to newly approved documents`);
      load();
    } catch (err) { toast.error(apiError(err)); }
  };

  const AssetCard = ({ kind, pathKey, label, testId, inputRef }) => (
    <div className="flex flex-col gap-1.5 min-w-0" data-testid={testId}>
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        {form[pathKey]
          ? <img src={pdfUrl(`/files/${form[pathKey]}`)} alt={label}
              className="h-12 max-w-[7rem] object-contain border border-slate-200 rounded p-1 bg-white" />
          : <div className="h-12 w-24 border border-dashed border-slate-300 rounded flex items-center justify-center text-[10px] text-slate-400">None</div>}
        {!ro && (<>
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" ref={inputRef}
            onChange={(e) => uploadAsset(kind, e.target.files?.[0])} />
          <Button type="button" data-testid={`upload-${kind}-btn`} variant="outline" size="sm"
            onClick={() => inputRef.current?.click()}>
            <Upload className="w-3.5 h-3.5 mr-1" /> Upload</Button>
        </>)}
      </div>
    </div>
  );

  return (
    <form onSubmit={save} className="grid grid-cols-1 xl:grid-cols-2 gap-4" data-testid="company-form">
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">Legal & Tax</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Legal name</Label>
            <Input data-testid="company-name-input" disabled={ro} value={form.legal_name || ""} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} /></div>
          <div><Label>GSTIN</Label><Input disabled={ro} value={form.gstin || ""} onChange={(e) => setForm({ ...form, gstin: e.target.value })} className="font-mono" /></div>
          <div><Label>PAN</Label><Input disabled={ro} value={form.pan || ""} onChange={(e) => setForm({ ...form, pan: e.target.value })} className="font-mono" /></div>
          <div><Label>CIN</Label><Input disabled={ro} value={form.cin || ""} onChange={(e) => setForm({ ...form, cin: e.target.value })} className="font-mono" /></div>
          <div><Label>State (GST)</Label>
            <Select
              value={form.state_code || ""}
              disabled={ro}
              onValueChange={(v) => {
                const s = INDIAN_STATES.find(([c]) => c === v)
                setForm({ ...form, state_code: v, state: s ? s[1] : form.state || "" })
              }}
            >
              <SelectTrigger data-testid="company-state-select" disabled={ro}><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent className="bg-white max-h-64">
                {INDIAN_STATES.map(([code, name]) => (
                  <SelectItem key={code} value={code}>{code} — {name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>State code</Label>
            <Input disabled value={form.state_code || ""} className="font-mono bg-slate-50" data-testid="company-state-code" /></div>
          <div className="col-span-2"><Label>Registered address</Label>
            <Input disabled={ro} value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div><Label>Email</Label><Input disabled={ro} value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label>Phone</Label><Input disabled={ro} value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        </div>
        <h3 className="text-sm font-semibold text-slate-800 pt-2">Bank & UPI</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>Bank</Label><Input disabled={ro} value={bank.bank_name || ""} onChange={(e) => setBank("bank_name", e.target.value)} /></div>
          <div><Label>Branch</Label><Input disabled={ro} value={bank.branch || ""} onChange={(e) => setBank("branch", e.target.value)} /></div>
          <div><Label>Account no</Label><Input disabled={ro} value={bank.account_no || ""} onChange={(e) => setBank("account_no", e.target.value)} className="font-mono" /></div>
          <div><Label>IFSC</Label><Input disabled={ro} value={bank.ifsc || ""} onChange={(e) => setBank("ifsc", e.target.value)} className="font-mono" /></div>
          <div className="col-span-2"><Label>UPI ID</Label><Input disabled={ro} value={bank.upi || ""} onChange={(e) => setBank("upi", e.target.value)} className="font-mono" /></div>
        </div>
      </div>
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">Branding & Terms</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <AssetCard kind="logo" pathKey="logo_path" label="Logo" testId="company-logo-preview" inputRef={logoRef} />
            <AssetCard kind="signature" pathKey="signature_path" label="Signature" testId="company-signature-preview" inputRef={signatureRef} />
            <AssetCard kind="stamp" pathKey="stamp_path" label="Stamp / Seal" testId="company-stamp-preview" inputRef={stampRef} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Brand primary</Label>
              <div className="flex gap-2 items-center">
                <input type="color" disabled={ro} value={(form.brand || {}).primary || "#0F284E"}
                  onChange={(e) => setForm({ ...form, brand: { ...(form.brand || {}), primary: e.target.value } })}
                  className="w-9 h-9 border border-slate-200 rounded cursor-pointer" data-testid="brand-color-input" />
                <span className="font-mono text-xs">{(form.brand || {}).primary}</span></div></div>
            <div><Label>Brand accent</Label>
              <div className="flex gap-2 items-center">
                <input type="color" disabled={ro} value={(form.brand || {}).accent || "#0066CC"}
                  onChange={(e) => setForm({ ...form, brand: { ...(form.brand || {}), accent: e.target.value } })}
                  className="w-9 h-9 border border-slate-200 rounded cursor-pointer" />
                <span className="font-mono text-xs">{(form.brand || {}).accent}</span></div></div>
          </div>
          <div><Label>Invoice terms</Label>
            <Input disabled={ro} value={form.terms || ""} onChange={(e) => setForm({ ...form, terms: e.target.value })} /></div>
          <p className="text-xs text-slate-500">Logo, signature and stamp are snapshotted onto each invoice at approval — approved documents never change appearance.</p>
        </div>
        {!ro && (
          <Button data-testid="company-save-btn" type="submit" className="bg-[#0F284E] hover:bg-[#17386D] text-white">Save Company Profile</Button>)}
      </div>
    </form>
  );
}

function MastersSection({ tid, title, section, fields, items, onChange, ro }) {
  const add = () => onChange([...items, Object.fromEntries(fields.map(([k]) => [k, ""]))]);
  const setItem = (i, k, v) => onChange(items.map((it, x) => (x === i ? { ...it, [k]: v } : it)));
  return (
    <div className="bg-white border border-slate-200 rounded-lg" data-testid={tid}>
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {!ro && <Button type="button" size="sm" variant="outline" data-testid={`${tid}-add`} onClick={add}><Plus className="w-3.5 h-3.5 mr-1" /> Add</Button>}
      </div>
      <div className="p-3 space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2 items-center">
            {fields.map(([k, ph]) => (
              <Input key={k} disabled={ro} placeholder={ph} value={it[k] ?? ""} onChange={(e) => setItem(i, k, e.target.value)}
                className="h-8 text-xs font-mono" data-testid={`${tid}-item-${i}-${k}`} />
            ))}
            {!ro && (
              <button type="button" onClick={() => onChange(items.filter((_, x) => x !== i))}
                className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>)}
          </div>
        ))}
        {!items.length && <div className="text-xs text-slate-400 px-1 py-2">Empty</div>}
      </div>
    </div>
  );
}

function MastersTab() {
  const { can } = useAuth();
  const [m, setM] = useState(null);
  useEffect(() => { api.get("/settings/masters").then((r) => setM(r.data)).catch(() => {}); }, []);
  if (!m) return <div className="text-sm text-slate-500">Loading…</div>;
  const ro = !can("admin");

  const save = async (section, items) => {
    try {
      const cleaned = section === "tax_rates" ? items.map((x) => ({ ...x, rate: Number(x.rate) })) :
        section === "hsn_codes" ? items.map((x) => ({ ...x, default_rate: Number(x.default_rate || 18) })) : items;
      await api.put(`/settings/masters/${section}`, cleaned);
      toast.success("Master updated");
    } catch (err) { toast.error(apiError(err)); }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {[["hsn", "HSN / SAC Codes", "hsn_codes", [["code", "Code"], ["description", "Description"], ["default_rate", "GST%"]]],
        ["rates", "Tax Rates", "tax_rates", [["rate", "Rate %"], ["label", "Label"]]],
        ["cats", "Expense Categories", "expense_categories", [["name", "Category name"]]],
      ].map(([tid, title, section, fields]) => (
        <div key={section} className="space-y-2">
          <MastersSection tid={`master-${tid}`} title={title} section={section} fields={fields}
            items={m[section] || []} onChange={(items) => setM({ ...m, [section]: items })} ro={ro} />
          {!ro && <Button size="sm" data-testid={`master-${tid}-save`} onClick={() => save(section, m[section] || [])}
            className="bg-[#0F284E] hover:bg-[#17386D] text-white">Save {title}</Button>}
        </div>
      ))}
      <div className="space-y-2" data-testid="master-banks-panel">
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Bank Accounts</h3>
          <p className="text-xs text-slate-500 mb-2">
            Bank books, opening balances, and statement import live under Bank Ledger.
            Company PDF bank details stay on the Company tab (synced from the primary account).
          </p>
          <Link to="/banks" data-testid="master-banks-link"
            className="inline-flex text-xs font-semibold text-[#0066CC] hover:underline">
            Open Bank Ledger →
          </Link>
        </div>
      </div>
    </div>
  );
}

function UsersTab() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "ops" });
  const [roleOptions, setRoleOptions] = useState(["admin", "accountant", "ops", "viewer"]);
  const userSchema = useMemo(() => [
    { key: "q", type: FIELD.TEXT, label: "Search", placeholder: "Name / email…", width: "w-40" },
    { key: "role", type: FIELD.SELECT, label: "Role", width: "w-36",
      options: roleOptions.map((r) => ({ value: r, label: r })) },
    { key: "active", type: FIELD.SELECT, label: "Active", width: "w-28",
      options: [{ value: "1", label: "Active" }, { value: "0", label: "Inactive" }] },
  ], [roleOptions]);
  const { values, setFilter, clearFilters, activeCount, apiParams } = useListFilters(userSchema);

  const load = () => api.get("/users", { params: apiParams }).then((r) => setRows(r.data)).catch((e) => setRows([]));
  useEffect(() => { load(); }, [apiParams]); // eslint-disable-line
  useEffect(() => {
    api.get("/rbac/role-options").then((r) => {
      const keys = (r.data || []).map((x) => x.key);
      if (keys.length) setRoleOptions(keys);
    }).catch(() => {});
  }, []);

  const create = async (e) => {
    e.preventDefault();
    try {
      await api.post("/users", form);
      toast.success("User created — they must set a new password on first login");
      setOpen(false);
      setForm({ name: "", email: "", password: "", role: "ops" });
      load();
    } catch (err) { toast.error(apiError(err)); }
  };

  const patch = async (uid, body) => {
    try {
      await api.patch(`/users/${uid}`, body);
      toast.success("User updated");
      load();
    } catch (err) { toast.error(apiError(err)); }
  };

  return (
    <div>
      <FilterBar schema={userSchema} values={values} setFilter={setFilter}
        clearFilters={clearFilters} activeCount={activeCount} testId="user-filters" />
      <div className="bg-white border border-slate-200 rounded-lg">
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">Users & Roles</h3>
        <Button size="sm" data-testid="new-user-btn" onClick={() => setOpen(true)} className="bg-[#0F284E] hover:bg-[#17386D] text-white">
          <Plus className="w-3.5 h-3.5 mr-1" /> New User</Button>
      </div>
      <table className="w-full text-sm pwa-table" data-testid="users-table">
        <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
          <th className="text-left px-3 py-2">Name</th><th className="text-left px-3 py-2">Email</th>
          <th className="text-left px-3 py-2">Role</th><th className="text-left px-3 py-2">2FA</th>
          <th className="text-left px-3 py-2">First login</th>
          <th className="text-left px-3 py-2">Active</th><th className="px-3 py-2"></th></tr></thead>
        <tbody>
          {(rows || []).map((u) => (
            <tr key={u.id} data-testid={`user-row-${u.id}`} className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium">{u.name}</td>
              <td className="px-3 py-2 text-xs">{u.email}</td>
              <td className="px-3 py-2">
                <Select value={u.role} onValueChange={(v) => patch(u.id, { role: v })}>
                  <SelectTrigger data-testid={`user-role-${u.id}`} className="w-40 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">{roleOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select></td>
              <td className="px-3 py-2 text-xs">{u.totp_enabled ? <span className="text-emerald-700 font-semibold">On</span> : <span className="text-slate-400">Off</span>}</td>
              <td className="px-3 py-2 text-xs" data-testid={`user-first-login-${u.id}`}>
                {(u.must_change_password || u.first_login)
                  ? <span className="text-amber-700 font-semibold">Pending</span>
                  : <span className="text-slate-400">Done</span>}
              </td>
              <td className="px-3 py-2"><Switch data-testid={`user-active-${u.id}`} checked={u.active} onCheckedChange={(v) => patch(u.id, { active: v })} /></td>
              <td className="px-3 py-2 text-right">
                <button data-testid={`user-reset-${u.id}`} onClick={async () => {
                    const pw = window.prompt("New temporary password (min 8 chars):");
                    if (!pw) return;
                    try {
                      await api.post(`/users/${u.id}/reset-password`, { password: pw });
                      toast.success("Password reset — user must change this password on next login");
                      load();
                    }
                    catch (e) { toast.error(apiError(e)); }
                  }} className="p-1.5 rounded hover:bg-slate-100 text-slate-500" title="Reset password"><KeyRound className="w-3.5 h-3.5" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows && !rows.length && <Empty label="No users (or insufficient permission)" />}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md bg-white" data-testid="user-dialog">
          <DialogHeader><DialogTitle className="font-heading">New User</DialogTitle></DialogHeader>
          <form onSubmit={create} className="space-y-3">
            <p className="text-xs text-slate-500" data-testid="user-temp-password-hint">
              Password is temporary. The user will be required to set their own password on first login.
            </p>
            <div><Label>Name *</Label><Input data-testid="user-name-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Email *</Label><Input data-testid="user-email-input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Temporary password *</Label><Input data-testid="user-password-input" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <div><Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger data-testid="user-role-select"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white">{roleOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select></div>
            <Button data-testid="user-save-btn" type="submit" className="w-full bg-[#0F284E] hover:bg-[#17386D] text-white">Create User</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SecurityTab() {
  const { user } = useAuth();

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 max-w-xl" data-testid="security-tab">
      <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
        {user?.totp_enabled ? <ShieldCheck className="w-4 h-4 text-emerald-600" /> : <ShieldOff className="w-4 h-4 text-slate-400" />}
        Two-factor authentication (TOTP)</h3>
      <p className="text-xs text-slate-500 mt-1">
        Status: {user?.totp_enabled ? <b className="text-emerald-700">Enabled</b> : "Disabled"} — manage authenticator setup on your profile.
      </p>
      <Link to="/profile" data-testid="security-profile-link"
        className="inline-flex mt-3 text-xs font-semibold text-[#0066CC] hover:underline">
        Manage on Profile →
      </Link>
    </div>
  );
}

export default function Settings() {
  const { can } = useAuth();
  const [tab, setTab] = useState("company");
  const [series, setSeries] = useState([]);
  const isAdmin = can("admin");

  useEffect(() => {
    if (isAdmin && tab === "series") api.get("/settings/number-series").then((r) => setSeries(r.data)).catch(() => {});
  }, [tab, isAdmin]);

  const tabs = [
    ...(isAdmin ? [["company", "Company"], ["masters", "Masters & Tax"], ["series", "Number Series"], ["users", "Users"]] : []),
    ["security", "Security (2FA)"],
  ];

  return (
    <Layout title="Settings & Masters">
      <div className="flex border border-slate-200 rounded-md overflow-x-auto bg-white w-full max-w-full" data-testid="settings-tabs">
        {tabs.map(([k, label]) => (
          <button key={k} data-testid={`settings-tab-${k}`} onClick={() => setTab(k)}
            className={`shrink-0 px-3 py-1.5 text-xs font-semibold transition-colors ${tab === k ? "bg-[#0F284E] text-white" : "text-slate-600 hover:bg-slate-50"}`}>{label}</button>
        ))}
      </div>
      {tab === "company" && isAdmin && <CompanyTab />}
      {tab === "masters" && isAdmin && <MastersTab />}
      {tab === "users" && isAdmin && <UsersTab />}
      {tab === "series" && isAdmin && (
        <div className="bg-white border border-slate-200 rounded-lg max-w-2xl">
          <div className="px-4 py-2.5 border-b border-slate-200 text-sm font-semibold text-slate-800">Number Series (TH/{"{FY}"}/{"{SEQ:4}"})</div>
          <table className="w-full text-sm pwa-table" data-testid="series-table">
            <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
              <th className="text-left px-3 py-2">Document</th><th className="text-left px-3 py-2">Fiscal Year</th>
              <th className="text-right px-3 py-2">Next Sequence</th></tr></thead>
            <tbody>
              {series.map((s) => (
                <tr key={`${s.kind}-${s.fy}`} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs font-semibold">{s.kind}</td>
                  <td className="px-3 py-2 font-mono text-xs">{s.fy}</td>
                  <td className="px-3 py-2 text-right font-mono">{String(s.next_seq).padStart(4, "0")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === "security" && <SecurityTab />}
    </Layout>
  );
}
