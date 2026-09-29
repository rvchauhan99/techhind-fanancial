import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { apiError } from "../lib/api";
import { fmtINR, INDIAN_STATES } from "../lib/format";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";

const emptyLine = () => ({
  description: "", product_id: null, hsn_sac: "", qty: 1, unit: "Nos",
  rate: 0, discount: 0, tax_rate: 18, rate_includes_gst: false,
});

export default function InvoiceForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [company, setCompany] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({
    customer_id: "", invoice_date: new Date().toISOString().slice(0, 10), due_date: "",
    is_export_sez: false, lut_flag: false, reverse_charge: false,
    pos_state_code: "", pos_state: "", pos_override_reason: "", notes: "",
  });
  const [lines, setLines] = useState([emptyLine()]);
  const [docType, setDocType] = useState("INV");
  const [refInvoice, setRefInvoice] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/settings/company").then((r) => setCompany(r.data)).catch(() => {});
    api.get("/customers").then((r) => setCustomers(r.data)).catch(() => {});
    api.get("/products").then((r) => setProducts(r.data.filter((p) => p.active))).catch(() => {});
    if (id) {
      api.get(`/invoices/${id}`).then((r) => {
        const inv = r.data;
        if (inv.status !== "draft") {
          toast.error("Only drafts can be edited");
          navigate(`/invoices/${id}`);
          return;
        }
        setDocType(inv.doc_type);
        setRefInvoice(inv.reference_invoice_id);
        setReason(inv.reason || "");
        setForm({
          customer_id: inv.customer_id, invoice_date: inv.invoice_date, due_date: inv.due_date || "",
          is_export_sez: inv.is_export_sez, lut_flag: inv.lut_flag, reverse_charge: inv.reverse_charge,
          pos_state_code: inv.place_of_supply?.code || "", pos_state: inv.place_of_supply?.state || "",
          pos_override_reason: inv.pos_override_reason || "", notes: inv.notes || "",
        });
        setLines(inv.lines.map((l) => ({ description: l.description, product_id: l.product_id,
          hsn_sac: l.hsn_sac, qty: l.qty, unit: l.unit, rate: l.rate, discount: l.discount, tax_rate: l.tax_rate })));
      }).catch(() => {});
    }
  }, [id]); // eslint-disable-line

  const customer = customers.find((c) => c.id === form.customer_id);
  const posCode = form.pos_state_code || customer?.state_code || "";
  const zeroRated = form.reverse_charge || (form.is_export_sez && form.lut_flag);
  const intra = company && posCode === company.state_code && !form.is_export_sez;

  const totals = useMemo(() => {
    let taxable = 0, tax = 0;
    for (const l of lines) {
      const taxRate = Number(l.tax_rate || 0);
      let rate = Number(l.rate || 0);
      if (l.rate_includes_gst && taxRate > 0) {
        rate = rate / (1 + taxRate / 100);
      }
      const t = Number(l.qty || 0) * rate - Number(l.discount || 0);
      taxable += t;
      tax += zeroRated ? 0 : (t * taxRate) / 100;
    }
    const raw = taxable + tax;
    const grand = Math.round(raw);
    return { taxable, tax, grand, roundOff: grand - raw };
  }, [lines, zeroRated]);

  const setLine = (i, patch) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const pickProduct = (i, pid) => {
    const p = products.find((x) => x.id === pid);
    if (p) setLine(i, {
      product_id: pid, description: p.name, hsn_sac: p.hsn_sac, rate: p.price,
      tax_rate: p.tax_rate, unit: p.unit,
      rate_includes_gst: p.price_includes_gst !== false,
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!lines.length || lines.some((l) => !l.description)) {
      toast.error("Every line needs a description");
      return;
    }
    setBusy(true);
    const payload = {
      doc_type: docType, customer_id: form.customer_id, invoice_date: form.invoice_date,
      due_date: form.due_date || null, lines: lines.map((l) => ({
        ...l, qty: Number(l.qty), rate: Number(l.rate), discount: Number(l.discount),
        tax_rate: Number(l.tax_rate), rate_includes_gst: !!l.rate_includes_gst,
      })),
      is_export_sez: form.is_export_sez, lut_flag: form.lut_flag, reverse_charge: form.reverse_charge,
      pos_state_code: form.pos_state_code || null, pos_state: form.pos_state || null,
      pos_override_reason: form.pos_override_reason, reference_invoice_id: refInvoice,
      reason, notes: form.notes,
    };
    try {
      const res = id ? await api.patch(`/invoices/${id}`, payload) : await api.post("/invoices", payload);
      toast.success(id ? "Draft updated" : "Draft invoice created");
      navigate(`/invoices/${res.data.id}`);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout title={id ? `Edit Draft ${docType !== "INV" ? docType : "Invoice"}` : "New Invoice"}>
      <form onSubmit={submit} className="space-y-4" data-testid="invoice-form">
        <div className="bg-white border border-slate-200 rounded-lg p-3 md:p-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div className="sm:col-span-2"><Label>Customer *</Label>
            <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
              <SelectTrigger data-testid="invoice-customer-select"><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent className="bg-white max-h-64">{customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.legal_name} ({c.state_code})</SelectItem>))}</SelectContent>
            </Select></div>
          <div><Label>Invoice date *</Label>
            <Input data-testid="invoice-date-input" type="date" required value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} /></div>
          <div><Label>Due date</Label>
            <Input data-testid="invoice-due-input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label>Place of supply override</Label>
            <Select value={form.pos_state_code || "auto"} onValueChange={(v) => {
              if (v === "auto") setForm({ ...form, pos_state_code: "", pos_state: "" });
              else { const s = INDIAN_STATES.find(([c]) => c === v); setForm({ ...form, pos_state_code: v, pos_state: s ? s[1] : "" }); }
            }}>
              <SelectTrigger data-testid="invoice-pos-select"><SelectValue placeholder="Auto (customer state)" /></SelectTrigger>
              <SelectContent className="bg-white max-h-64">
                <SelectItem value="auto">Auto — customer state{customer ? ` (${customer.state})` : ""}</SelectItem>
                {INDIAN_STATES.map(([code, name]) => <SelectItem key={code} value={code}>{code} — {name}</SelectItem>)}
              </SelectContent>
            </Select></div>
          {form.pos_state_code && customer && form.pos_state_code !== customer.state_code && (
            <div className="sm:col-span-2"><Label>Override reason *</Label>
              <Input data-testid="invoice-pos-reason-input" value={form.pos_override_reason} onChange={(e) => setForm({ ...form, pos_override_reason: e.target.value })} /></div>)}
          <div className="col-span-full flex flex-wrap gap-4 md:gap-6 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <Switch data-testid="invoice-export-switch" checked={form.is_export_sez} onCheckedChange={(v) => setForm({ ...form, is_export_sez: v })} />
              Export / SEZ supply</label>
            {form.is_export_sez && (
              <label className="flex items-center gap-2 text-sm">
                <Switch data-testid="invoice-lut-switch" checked={form.lut_flag} onCheckedChange={(v) => setForm({ ...form, lut_flag: v })} />
                Under LUT (zero-rated)</label>)}
            <label className="flex items-center gap-2 text-sm">
              <Switch data-testid="invoice-rcm-switch" checked={form.reverse_charge} onCheckedChange={(v) => setForm({ ...form, reverse_charge: v })} />
              Reverse charge (RCM)</label>
            <span data-testid="invoice-tax-scheme" className={`ml-auto text-[11px] font-semibold px-2 py-1 rounded border ${zeroRated ? "text-sky-700 bg-sky-50 border-sky-200" : intra ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-indigo-700 bg-indigo-50 border-indigo-200"}`}>
              {zeroRated ? "ZERO-RATED" : intra ? "INTRA-STATE · CGST+SGST" : "INTER-STATE · IGST"}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden" data-testid="invoice-lines-editor">
          <table className="w-full text-sm pwa-table">
            <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
              <th className="text-left px-2 py-2 w-56">Product (autofill)</th><th className="text-left px-2 py-2">Description *</th>
              <th className="text-left px-2 py-2 w-24">HSN/SAC</th><th className="text-right px-2 py-2 w-16">Qty</th>
              <th className="text-left px-2 py-2 w-16">Unit</th><th className="text-right px-2 py-2 w-24">Rate</th>
              <th className="text-right px-2 py-2 w-20">Disc</th><th className="text-left px-2 py-2 w-20">GST%</th>
              <th className="text-right px-2 py-2 w-24">Amount</th><th className="w-8"></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-slate-100" data-testid={`line-row-${i}`}>
                  <td className="px-1.5 py-1">
                    <Select value={l.product_id || "none"} onValueChange={(v) => v !== "none" && pickProduct(i, v)}>
                      <SelectTrigger data-testid={`line-product-${i}`} className="h-8 text-xs"><SelectValue placeholder="Pick…" /></SelectTrigger>
                      <SelectContent className="bg-white max-h-64"><SelectItem value="none">—</SelectItem>
                        {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                    </Select></td>
                  <td className="px-1.5 py-1"><Input data-testid={`line-desc-${i}`} className="h-8" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                  <td className="px-1.5 py-1"><Input className="h-8 font-mono text-xs" value={l.hsn_sac} onChange={(e) => setLine(i, { hsn_sac: e.target.value })} /></td>
                  <td className="px-1.5 py-1"><Input data-testid={`line-qty-${i}`} type="number" step="0.01" className="h-8 text-right font-mono" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                  <td className="px-1.5 py-1"><Input className="h-8" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} /></td>
                  <td className="px-1.5 py-1"><Input data-testid={`line-rate-${i}`} type="number" step="0.01" className="h-8 text-right font-mono" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></td>
                  <td className="px-1.5 py-1"><Input type="number" step="0.01" className="h-8 text-right font-mono" value={l.discount} onChange={(e) => setLine(i, { discount: e.target.value })} /></td>
                  <td className="px-1.5 py-1">
                    <Select value={String(l.tax_rate)} onValueChange={(v) => setLine(i, { tax_rate: Number(v) })}>
                      <SelectTrigger data-testid={`line-tax-${i}`} className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-white">{[0, 5, 12, 18, 28].map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}</SelectContent>
                    </Select></td>
                  <td className="px-1.5 py-1 text-right font-mono text-xs">{fmtINR(Number(l.qty || 0) * Number(l.rate || 0) - Number(l.discount || 0))}</td>
                  <td className="px-1.5 py-1 text-center">
                    {lines.length > 1 && (
                      <button type="button" aria-label="Remove line" data-testid={`line-remove-${i}`} onClick={() => setLines(lines.filter((_, x) => x !== i))}
                        className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-2 border-t border-slate-100">
            <Button type="button" data-testid="add-line-btn" variant="outline" size="sm" onClick={() => setLines([...lines, emptyLine()])}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add line</Button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3 md:p-5 flex flex-wrap items-center justify-between gap-3 md:gap-4 max-md:sticky max-md:bottom-0 max-md:z-20" data-testid="invoice-totals-preview">
          <div className="flex gap-8 text-sm">
            <div><div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Taxable</div>
              <div className="font-mono font-semibold" data-testid="preview-taxable">{fmtINR(totals.taxable)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">GST</div>
              <div className="font-mono font-semibold" data-testid="preview-tax">{fmtINR(totals.tax)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Round-off</div>
              <div className="font-mono font-semibold" data-testid="preview-roundoff">{totals.roundOff >= 0 ? "+" : ""}{fmtINR(totals.roundOff)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Grand Total</div>
              <div className="font-mono font-bold text-lg text-slate-900" data-testid="preview-grand">{fmtINR(totals.grand)}</div></div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
            <Button data-testid="invoice-save-btn" type="submit" disabled={busy || !form.customer_id}
              className="bg-[#0F284E] hover:bg-[#17386D] text-white">{busy ? "Saving…" : id ? "Update Draft" : "Create Draft"}</Button>
          </div>
        </div>
      </form>
    </Layout>
  );
}
