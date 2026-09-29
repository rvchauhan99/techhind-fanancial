import React, { useEffect, useMemo, useState } from "react";
import { Plus, CheckCircle2, Trash2, IndianRupee, FileDown } from "lucide-react";
import { toast } from "sonner";
import api, { apiError, pdfUrl } from "../lib/api";
import { fmtINR, fmtDate, INDIAN_STATES } from "../lib/format";
import Layout, { StatusBadge, Empty } from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import FilterBar, { FIELD } from "../components/filters/FilterBar";
import { useListFilters } from "../hooks/useListFilters";

const emptyVendor = { name: "", gstin: "", state: "", state_code: "", address: "", contact_name: "", contact_email: "", contact_phone: "" };
const emptyBillLine = () => ({ description: "", hsn_sac: "", qty: 1, rate: 0, tax_rate: 18 });

const BILL_SCHEMA = [
  { key: "q", type: FIELD.TEXT, label: "Search", placeholder: "Bill no…", width: "w-36" },
  { key: "status", type: FIELD.SELECT, label: "Status", width: "w-36",
    options: ["draft", "posted", "partially_paid", "paid", "cancelled"].map((s) => ({ value: s, label: s.replace("_", " ") })) },
  { key: "vendor_id", type: FIELD.SELECT, label: "Vendor", width: "w-44", options: [] },
  { key: "dates", type: FIELD.DATE_RANGE, label: "Bill date" },
  { key: "itc", type: FIELD.SELECT, label: "ITC", width: "w-28",
    options: [{ value: "eligible", label: "Eligible" }, { value: "blocked", label: "Blocked" }] },
  { key: "total", type: FIELD.NUMBER_RANGE, label: "Total", minKey: "min_total", maxKey: "max_total" },
];

const VENDOR_SCHEMA = [
  { key: "vq", type: FIELD.TEXT, label: "Search", placeholder: "Name / GSTIN…", width: "w-40" },
  { key: "state_code", type: FIELD.SELECT, label: "State", width: "w-44",
    options: INDIAN_STATES.map(([code, name]) => ({ value: code, label: `${code} — ${name}` })) },
  { key: "has_gstin", type: FIELD.TOGGLE, label: "GSTIN", placeholder: "Has GSTIN" },
];

const VPAY_SCHEMA = [
  { key: "pq", type: FIELD.TEXT, label: "Search", placeholder: "Ref / vendor…", width: "w-40" },
  { key: "pvendor_id", type: FIELD.SELECT, label: "Vendor", width: "w-44", options: [] },
  { key: "pdates", type: FIELD.DATE_RANGE, label: "Payment date", fromKey: "pdate_from", toKey: "pdate_to" },
  { key: "method", type: FIELD.SELECT, label: "Method", width: "w-28",
    options: ["upi", "neft", "rtgs", "cheque", "cash"].map((m) => ({ value: m, label: m.toUpperCase() })) },
  { key: "pamount", type: FIELD.NUMBER_RANGE, label: "Amount", minKey: "pmin_amount", maxKey: "pmax_amount" },
];

export default function Vendors() {
  const { can } = useAuth();
  const [vendors, setVendors] = useState([]);
  const [bills, setBills] = useState(null);
  const [vpays, setVpays] = useState([]);
  const [vOpen, setVOpen] = useState(false);
  const [bOpen, setBOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [vForm, setVForm] = useState(emptyVendor);
  const [bForm, setBForm] = useState({ vendor_id: "", bill_no: "", bill_date: new Date().toISOString().slice(0, 10), due_date: "", itc_eligible: true, notes: "" });
  const [bLines, setBLines] = useState([emptyBillLine()]);
  const [payBill, setPayBill] = useState(null);
  const [payForm, setPayForm] = useState({ payment_date: new Date().toISOString().slice(0, 10), amount: "", method: "neft", reference_no: "", bank_id: "" });
  const [banks, setBanks] = useState([]);
  const [tick, setTick] = useState(0);

  const allSchema = useMemo(() => [...BILL_SCHEMA, ...VENDOR_SCHEMA, ...VPAY_SCHEMA], []);
  const { values, setFilter, setMany, clearFilters, activeCount, apiParams } = useListFilters(allSchema, { preserve: ["tab"] });
  const tab = values.tab || "bills";

  const billSchema = useMemo(() => BILL_SCHEMA.map((f) => {
    if (f.key !== "vendor_id") return f;
    return { ...f, options: vendors.map((v) => ({ value: v.id, label: v.name })) };
  }), [vendors]);
  const vpaySchema = useMemo(() => VPAY_SCHEMA.map((f) => {
    if (f.key !== "pvendor_id") return f;
    return { ...f, options: vendors.map((v) => ({ value: v.id, label: v.name })) };
  }), [vendors]);

  const loadMasters = () => api.get("/vendors").then((r) => setVendors(r.data)).catch(() => {});

  useEffect(() => {
    loadMasters();
    api.get("/banks").then((r) => {
      setBanks(r.data || []);
      const primary = (r.data || []).find((b) => b.primary) || (r.data || []).find((b) => b.account_type === "bank");
      if (primary) setPayForm((f) => ({ ...f, bank_id: f.bank_id || primary.id }));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === "bills") {
      const params = {
        q: apiParams.q, status: apiParams.status, vendor_id: apiParams.vendor_id,
        date_from: apiParams.date_from, date_to: apiParams.date_to,
        itc: apiParams.itc, min_total: apiParams.min_total, max_total: apiParams.max_total,
      };
      Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
      api.get("/bills", { params }).then((r) => setBills(Array.isArray(r.data) ? r.data : r.data?.items || [])).catch(() => {});
    } else if (tab === "vendors") {
      const params = { q: apiParams.vq, state_code: apiParams.state_code, has_gstin: apiParams.has_gstin };
      Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
      api.get("/vendors", { params }).then((r) => setVendors(r.data)).catch(() => {});
    } else if (tab === "vpay") {
      const params = {
        q: apiParams.pq, vendor_id: apiParams.pvendor_id,
        date_from: apiParams.pdate_from, date_to: apiParams.pdate_to,
        method: apiParams.method, min_amount: apiParams.pmin_amount, max_amount: apiParams.pmax_amount,
      };
      Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
      api.get("/vendor-payments", { params }).then((r) => setVpays(r.data)).catch(() => {});
    }
  }, [tab, apiParams, tick]);

  const bump = () => setTick((t) => t + 1);

  const saveVendor = async (e) => {
    e.preventDefault();
    try {
      await api.post("/vendors", vForm);
      toast.success("Vendor created");
      setVOpen(false);
      setVForm(emptyVendor);
      bump();
    } catch (err) { toast.error(apiError(err)); }
  };

  const saveBill = async (e) => {
    e.preventDefault();
    try {
      await api.post("/bills", {
        ...bForm, due_date: bForm.due_date || null,
        lines: bLines.map((l) => ({ ...l, qty: Number(l.qty), rate: Number(l.rate), tax_rate: Number(l.tax_rate) })),
      });
      toast.success("Purchase bill created (draft)");
      setBOpen(false);
      setBForm({ vendor_id: "", bill_no: "", bill_date: new Date().toISOString().slice(0, 10), due_date: "", itc_eligible: true, notes: "" });
      setBLines([emptyBillLine()]);
      bump();
    } catch (err) { toast.error(apiError(err)); }
  };

  const postBill = async (bid) => {
    try {
      await api.post(`/bills/${bid}/post`);
      toast.success("Bill posted — now in AP");
      bump();
    } catch (e) { toast.error(apiError(e)); }
  };

  const delBill = async (bid) => {
    if (!window.confirm("Delete this draft bill?")) return;
    try {
      await api.delete(`/bills/${bid}`);
      toast.success("Draft bill deleted");
      bump();
    } catch (e) { toast.error(apiError(e)); }
  };

  const recordPay = async (e) => {
    e.preventDefault();
    try {
      await api.post("/vendor-payments", {
        vendor_id: payBill.vendor_id, ...payForm, amount: Number(payForm.amount),
        allocations: [{ bill_id: payBill.id, amount: Number(payForm.amount) }],
      });
      toast.success("Vendor payment recorded");
      setPayOpen(false);
      bump();
    } catch (err) { toast.error(apiError(err)); }
  };

  const tabs = [["bills", "Purchase Bills"], ["vendors", "Vendors"], ["vpay", "Vendor Payments"]];

  const tabClear = () => {
    const keys = tab === "bills" ? BILL_SCHEMA : tab === "vendors" ? VENDOR_SCHEMA : VPAY_SCHEMA;
    const patch = { tab };
    keys.forEach((f) => {
      if (f.type === FIELD.DATE_RANGE) {
        patch[f.fromKey || "date_from"] = "";
        patch[f.toKey || "date_to"] = "";
      } else if (f.type === FIELD.NUMBER_RANGE) {
        patch[f.minKey] = "";
        patch[f.maxKey] = "";
      } else {
        patch[f.key] = "";
      }
    });
    setMany(patch);
  };

  const tabActive = (() => {
    const keys = tab === "bills" ? BILL_SCHEMA : tab === "vendors" ? VENDOR_SCHEMA : VPAY_SCHEMA;
    let n = 0;
    keys.forEach((f) => {
      if (f.type === FIELD.DATE_RANGE) {
        if (values[f.fromKey || "date_from"]) n += 1;
        if (values[f.toKey || "date_to"]) n += 1;
      } else if (f.type === FIELD.NUMBER_RANGE) {
        if (values[f.minKey]) n += 1;
        if (values[f.maxKey]) n += 1;
      } else if (values[f.key]) n += 1;
    });
    return n;
  })();

  return (
    <Layout title="Vendors & Bills (ITC)"
      actions={can("admin", "accountant", "ops") && (
        <div className="flex gap-2">
          <Button data-testid="new-vendor-btn" size="sm" variant="outline" onClick={() => setVOpen(true)}><Plus className="w-4 h-4 mr-1" /> Vendor</Button>
          <Button data-testid="new-bill-btn" size="sm" onClick={() => setBOpen(true)} className="bg-[#0F284E] hover:bg-[#17386D] text-white"><Plus className="w-4 h-4 mr-1" /> Purchase Bill</Button>
        </div>)}>
      <div className="flex border border-slate-200 rounded-md overflow-hidden bg-white w-fit mb-1" data-testid="vendor-tabs">
        {tabs.map(([k, label]) => (
          <button key={k} data-testid={`vtab-${k}`} onClick={() => setMany({ tab: k })}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${tab === k ? "bg-[#0F284E] text-white" : "text-slate-600 hover:bg-slate-50"}`}>{label}</button>
        ))}
      </div>

      {tab === "bills" && (
        <FilterBar schema={billSchema} values={values} setFilter={setFilter}
          clearFilters={tabClear} activeCount={tabActive} testId="bill-filters" />
      )}
      {tab === "vendors" && (
        <FilterBar schema={VENDOR_SCHEMA} values={values} setFilter={setFilter}
          clearFilters={tabClear} activeCount={tabActive} testId="vendor-filters" />
      )}
      {tab === "vpay" && (
        <FilterBar schema={vpaySchema} values={values} setFilter={setFilter}
          clearFilters={tabClear} activeCount={tabActive} testId="vpay-filters" />
      )}

      {tab === "bills" && (
        <div className="bg-white border border-slate-200 rounded-lg">
          <table className="w-full text-sm pwa-table" data-testid="bills-table">
            <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
              <th className="text-left px-3 py-2">Bill No</th><th className="text-left px-3 py-2">Vendor</th>
              <th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Due</th>
              <th className="text-left px-3 py-2">ITC</th><th className="text-right px-3 py-2">GST</th>
              <th className="text-right px-3 py-2">Total</th><th className="text-right px-3 py-2">Balance</th>
              <th className="text-left px-3 py-2">Status</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {(bills || []).map((b) => (
                <tr key={b.id} data-testid={`bill-row-${b.id}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                  <td className="px-3 py-2 font-mono text-xs font-semibold">{b.bill_no}</td>
                  <td className="px-3 py-2">{b.vendor_snapshot?.name}</td>
                  <td className="px-3 py-2 text-xs">{fmtDate(b.bill_date)}</td>
                  <td className="px-3 py-2 text-xs">{fmtDate(b.due_date)}</td>
                  <td className="px-3 py-2">{b.itc_eligible
                    ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border text-emerald-700 bg-emerald-50 border-emerald-200">ITC</span>
                    : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border text-slate-500 bg-slate-50 border-slate-200">BLOCKED</span>}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtINR(b.total_tax)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{fmtINR(b.grand_total)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtINR(b.balance)}</td>
                  <td className="px-3 py-2"><StatusBadge value={b.status} /></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {b.status !== "draft" && (
                      <a data-testid={`download-bill-pdf-${b.id}`} href={pdfUrl(`/bills/${b.id}/pdf`)}
                        target="_blank" rel="noreferrer" title="Download bill PDF"
                        className="inline-flex p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#0F284E]">
                        <FileDown className="w-3.5 h-3.5" /></a>)}
                    {b.status === "draft" && can("admin", "accountant") && (
                      <button data-testid={`post-bill-${b.id}`} onClick={() => postBill(b.id)} title="Post bill"
                        className="p-1.5 rounded hover:bg-emerald-50 text-slate-500 hover:text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /></button>)}
                    {b.status === "draft" && can("admin", "accountant", "ops") && (
                      <button data-testid={`delete-bill-${b.id}`} onClick={() => delBill(b.id)} title="Delete draft"
                        className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>)}
                    {["posted", "partially_paid"].includes(b.status) && can("admin", "accountant") && (
                      <button data-testid={`pay-bill-${b.id}`} onClick={() => { setPayBill(b); setPayForm({ ...payForm, amount: b.balance }); setPayOpen(true); }} title="Record payment"
                        className="p-1.5 rounded hover:bg-blue-50 text-slate-500 hover:text-[#0066CC]"><IndianRupee className="w-3.5 h-3.5" /></button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {bills && !bills.length && <Empty label="No purchase bills" />}
        </div>
      )}

      {tab === "vendors" && (
        <div className="bg-white border border-slate-200 rounded-lg">
          <table className="w-full text-sm pwa-table" data-testid="vendors-table">
            <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
              <th className="text-left px-3 py-2">Vendor</th><th className="text-left px-3 py-2">GSTIN</th>
              <th className="text-left px-3 py-2">State</th><th className="text-left px-3 py-2">Contact</th></tr></thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id} data-testid={`vendor-row-${v.id}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                  <td className="px-3 py-2 font-medium text-slate-900">{v.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{v.gstin || "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{v.state} ({v.state_code})</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{v.contact_name}<br />{v.contact_email}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!vendors.length && <Empty label="No vendors" />}
        </div>
      )}

      {tab === "vpay" && (
        <div className="bg-white border border-slate-200 rounded-lg">
          <table className="w-full text-sm pwa-table" data-testid="vpay-table">
            <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
              <th className="text-left px-3 py-2">Ref</th><th className="text-left px-3 py-2">Date</th>
              <th className="text-left px-3 py-2">Vendor</th><th className="text-left px-3 py-2">Method</th>
              <th className="text-right px-3 py-2">Amount</th><th className="text-left px-3 py-2">Allocated To</th>
              <th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {vpays.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs font-semibold text-[#0066CC]">{p.payment_ref}</td>
                  <td className="px-3 py-2 text-xs">{fmtDate(p.payment_date)}</td>
                  <td className="px-3 py-2">{p.vendor_name}</td>
                  <td className="px-3 py-2 text-xs uppercase">{p.method}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{fmtINR(p.amount)}</td>
                  <td className="px-3 py-2 text-xs font-mono">{(p.allocations || []).map((a) => a.bill_no).join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <a data-testid={`download-vpay-pdf-${p.id}`} href={pdfUrl(`/vendor-payments/${p.id}/pdf`)}
                      target="_blank" rel="noreferrer" title="Download payment advice PDF"
                      className="inline-flex p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#0F284E]">
                      <FileDown className="w-3.5 h-3.5" /></a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!vpays.length && <Empty label="No vendor payments" />}
        </div>
      )}

      <Dialog open={vOpen} onOpenChange={setVOpen}>
        <DialogContent className="max-w-xl bg-white" data-testid="vendor-dialog">
          <DialogHeader><DialogTitle className="font-heading">New Vendor</DialogTitle></DialogHeader>
          <form onSubmit={saveVendor} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Name *</Label>
              <Input data-testid="vendor-name-input" required value={vForm.name} onChange={(e) => setVForm({ ...vForm, name: e.target.value })} /></div>
            <div><Label>GSTIN</Label><Input value={vForm.gstin} onChange={(e) => setVForm({ ...vForm, gstin: e.target.value.toUpperCase() })} className="font-mono" /></div>
            <div><Label>State</Label>
              <Select value={vForm.state_code} onValueChange={(v) => { const s = INDIAN_STATES.find(([c]) => c === v); setVForm({ ...vForm, state_code: v, state: s ? s[1] : "" }); }}>
                <SelectTrigger data-testid="vendor-state-select"><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent className="bg-white max-h-64">{INDIAN_STATES.map(([code, name]) => <SelectItem key={code} value={code}>{code} — {name}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="col-span-2"><Label>Address</Label><Input value={vForm.address} onChange={(e) => setVForm({ ...vForm, address: e.target.value })} /></div>
            <div><Label>Contact name</Label><Input value={vForm.contact_name} onChange={(e) => setVForm({ ...vForm, contact_name: e.target.value })} /></div>
            <div><Label>Contact email</Label><Input value={vForm.contact_email} onChange={(e) => setVForm({ ...vForm, contact_email: e.target.value })} /></div>
            <div className="col-span-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setVOpen(false)}>Cancel</Button>
              <Button data-testid="vendor-save-btn" type="submit" className="bg-[#0F284E] hover:bg-[#17386D] text-white">Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={bOpen} onOpenChange={setBOpen}>
        <DialogContent className="max-w-3xl bg-white" data-testid="bill-dialog">
          <DialogHeader><DialogTitle className="font-heading">New Purchase Bill</DialogTitle></DialogHeader>
          <form onSubmit={saveBill} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="col-span-2"><Label>Vendor *</Label>
                <Select value={bForm.vendor_id} onValueChange={(v) => setBForm({ ...bForm, vendor_id: v })}>
                  <SelectTrigger data-testid="bill-vendor-select"><SelectValue placeholder="Select vendor" /></SelectTrigger>
                  <SelectContent className="bg-white max-h-64">{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><Label>Vendor bill no *</Label>
                <Input data-testid="bill-no-input" required value={bForm.bill_no} onChange={(e) => setBForm({ ...bForm, bill_no: e.target.value })} className="font-mono" /></div>
              <div><Label>Bill date *</Label>
                <Input data-testid="bill-date-input" type="date" required value={bForm.bill_date} onChange={(e) => setBForm({ ...bForm, bill_date: e.target.value })} /></div>
              <div><Label>Due date</Label>
                <Input type="date" value={bForm.due_date} onChange={(e) => setBForm({ ...bForm, due_date: e.target.value })} /></div>
              <div className="col-span-2 flex items-end gap-2 pb-1">
                <Switch data-testid="bill-itc-switch" checked={bForm.itc_eligible} onCheckedChange={(v) => setBForm({ ...bForm, itc_eligible: v })} />
                <Label>ITC eligible (claim input credit)</Label></div>
            </div>
            <div className="border border-slate-200 rounded-md">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-600">Lines</div>
              {bLines.map((l, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-12 gap-2 px-3 py-2 border-b border-slate-100 last:border-0" data-testid={`bill-line-${i}`}>
                  <Input className="col-span-2 sm:col-span-5 h-8" placeholder="Description *" value={l.description} onChange={(e) => setBLines(bLines.map((x, xi) => xi === i ? { ...x, description: e.target.value } : x))} />
                  <Input className="col-span-1 sm:col-span-2 h-8 font-mono text-xs" placeholder="HSN/SAC" value={l.hsn_sac} onChange={(e) => setBLines(bLines.map((x, xi) => xi === i ? { ...x, hsn_sac: e.target.value } : x))} />
                  <Input className="col-span-1 sm:col-span-1 h-8 text-right font-mono" type="number" placeholder="Qty" value={l.qty} onChange={(e) => setBLines(bLines.map((x, xi) => xi === i ? { ...x, qty: e.target.value } : x))} />
                  <Input className="col-span-1 sm:col-span-2 h-8 text-right font-mono" type="number" step="0.01" placeholder="Rate" value={l.rate} onChange={(e) => setBLines(bLines.map((x, xi) => xi === i ? { ...x, rate: e.target.value } : x))} />
                  <Input className="col-span-1 sm:col-span-1 h-8 text-right font-mono" type="number" placeholder="GST%" value={l.tax_rate} onChange={(e) => setBLines(bLines.map((x, xi) => xi === i ? { ...x, tax_rate: e.target.value } : x))} />
                  <button type="button" aria-label="Remove line" className="col-span-2 sm:col-span-1 p-1 text-slate-400 hover:text-red-600 min-h-8" onClick={() => bLines.length > 1 && setBLines(bLines.filter((_, xi) => xi !== i))}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <div className="p-2"><Button type="button" data-testid="bill-add-line-btn" variant="outline" size="sm" onClick={() => setBLines([...bLines, emptyBillLine()])}><Plus className="w-3.5 h-3.5 mr-1" /> Line</Button></div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setBOpen(false)}>Cancel</Button>
              <Button data-testid="bill-save-btn" type="submit" disabled={!bForm.vendor_id || !bForm.bill_no}
                className="bg-[#0F284E] hover:bg-[#17386D] text-white">Create Draft Bill</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md bg-white" data-testid="vpay-dialog">
          <DialogHeader><DialogTitle className="font-heading">Pay {payBill?.bill_no}</DialogTitle></DialogHeader>
          <form onSubmit={recordPay} className="space-y-3">
            <div className="text-xs text-slate-600">Balance on bill: <span className="font-mono font-semibold">{fmtINR(payBill?.balance)}</span></div>
            <div><Label>Amount (₹) *</Label>
              <Input data-testid="vpay-amount-input" type="number" step="0.01" max={payBill?.balance} required value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} className="font-mono" /></div>
            <div><Label>Date *</Label>
              <Input type="date" required value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} /></div>
            <div><Label>Bank / Cash *</Label>
              <Select value={payForm.bank_id} onValueChange={(v) => setPayForm({ ...payForm, bank_id: v })}>
                <SelectTrigger data-testid="vpay-bank-select"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent className="bg-white">
                  {banks.map((b) => <SelectItem key={b.id} value={b.id}>{b.label || b.bank_name}</SelectItem>)}
                </SelectContent>
              </Select></div>
            <div><Label>Reference</Label>
              <Input value={payForm.reference_no} onChange={(e) => setPayForm({ ...payForm, reference_no: e.target.value })} className="font-mono" /></div>
            <Button data-testid="vpay-save-btn" type="submit" disabled={!payForm.bank_id}
              className="w-full bg-[#0F284E] hover:bg-[#17386D] text-white">Record Payment</Button>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
