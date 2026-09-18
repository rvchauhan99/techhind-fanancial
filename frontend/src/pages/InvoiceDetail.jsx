import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, XCircle, Download, Mail, FileDiff, Trash2, Pencil, QrCode } from "lucide-react";
import { toast } from "sonner";
import api, { apiError, pdfUrl } from "../lib/api";
import { fmtINR, fmtDate, fmtDateTime, DOC_TYPE_LABELS } from "../lib/format";
import Layout, { StatusBadge } from "../components/Layout";
import ActivityHistory from "../components/ActivityHistory";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [inv, setInv] = useState(null);
  const [emails, setEmails] = useState([]);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [cnOpen, setCnOpen] = useState(false);
  const [cnType, setCnType] = useState("CN");
  const [cnReason, setCnReason] = useState("");

  const load = () => {
    api.get(`/invoices/${id}`).then((r) => {
      setInv(r.data);
      setSendTo((r.data.customer_snapshot || {}).contact_email || "");
    }).catch(() => {});
    api.get(`/invoices/${id}/emails`).then((r) => setEmails(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, [id]); // eslint-disable-line

  if (!inv) return <Layout title="Document"><div className="text-sm text-slate-500">Loading…</div></Layout>;

  const act = async (path, successMsg) => {
    try {
      await api.post(`/invoices/${id}${path}`);
      toast.success(successMsg);
      load();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const del = async () => {
    if (!window.confirm("Delete this draft? This cannot be undone.")) return;
    try {
      await api.delete(`/invoices/${id}`);
      toast.success("Draft deleted");
      navigate("/invoices");
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const send = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/invoices/${id}/send`, { to: sendTo });
      toast.success("Email logged (MOCKED — Brevo not configured)");
      setSendOpen(false);
      load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const createNote = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post("/invoices", {
        doc_type: cnType, customer_id: inv.customer_id, invoice_date: new Date().toISOString().slice(0, 10),
        reference_invoice_id: inv.id, reason: cnReason,
        lines: inv.lines.map((l) => ({ description: `${cnType === "CN" ? "Credit" : "Debit"}: ${l.description}`,
          hsn_sac: l.hsn_sac, qty: l.qty, unit: l.unit, rate: l.rate, discount: 0, tax_rate: l.tax_rate })),
      });
      toast.success(`${DOC_TYPE_LABELS[cnType]} draft created`);
      setCnOpen(false);
      navigate(`/invoices/${data.id}/edit`);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const cust = inv.customer_snapshot || {};
  const title = DOC_TYPE_LABELS[inv.doc_type] || "Invoice";

  return (
    <Layout title={`${title} ${inv.invoice_no || "(Draft)"}`}
      actions={
        <div className="flex items-center gap-2">
          <button data-testid="back-to-invoices" onClick={() => navigate("/invoices")}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 mr-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Back</button>
          {inv.status === "draft" && can("admin", "accountant", "ops") && (
            <Button data-testid="edit-invoice-btn" size="sm" variant="outline" onClick={() => navigate(`/invoices/${id}/edit`)}>
              <Pencil className="w-3.5 h-3.5 mr-1" /> Edit</Button>)}
          {inv.status === "draft" && can("admin", "accountant") && (
            <Button data-testid="approve-invoice-btn" size="sm" onClick={() => act("/approve", "Approved & numbered — now immutable")}
              className="bg-emerald-700 hover:bg-emerald-800 text-white"><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve & Lock</Button>)}
          {inv.status === "draft" && can("admin", "accountant", "ops") && (
            <Button data-testid="delete-invoice-btn" size="sm" variant="outline" onClick={del}
              className="text-red-600 border-red-200 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5 mr-1" /> Delete</Button>)}
          {["approved", "partially_paid"].includes(inv.status) && can("admin", "accountant") && (
            <Button data-testid="cancel-invoice-btn" size="sm" variant="outline" onClick={() => act("/cancel", "Document cancelled (number retired)")}
              className="text-red-600 border-red-200 hover:bg-red-50"><XCircle className="w-3.5 h-3.5 mr-1" /> Cancel</Button>)}
          {["approved", "partially_paid"].includes(inv.status) && can("admin", "accountant", "ops") && (
            <Button data-testid="create-note-btn" size="sm" variant="outline" onClick={() => setCnOpen(true)}>
              <FileDiff className="w-3.5 h-3.5 mr-1" /> CN / DN</Button>)}
          {inv.status !== "draft" && !inv.irn && can("admin", "accountant") && (
            <Button data-testid="generate-irn-btn" size="sm" variant="outline" onClick={() => act("/generate-irn", "IRN generated (mock sandbox)")}>
              <QrCode className="w-3.5 h-3.5 mr-1" /> IRN</Button>)}
          {inv.status !== "draft" && can("admin", "accountant", "ops") && (
            <Button data-testid="send-invoice-btn" size="sm" variant="outline" onClick={() => setSendOpen(true)}>
              <Mail className="w-3.5 h-3.5 mr-1" /> Email</Button>)}
          <a data-testid="download-pdf-btn" href={pdfUrl(`/invoices/${id}/pdf`)} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold bg-[#0F284E] hover:bg-[#17386D] text-white rounded-md px-3 h-8 transition-colors">
            <Download className="w-3.5 h-3.5" /> PDF</a>
        </div>
      }>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5" data-testid="invoice-meta">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-lg font-bold text-slate-900" data-testid="invoice-number">{inv.invoice_no || "DRAFT — not numbered"}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {title} · {fmtDate(inv.invoice_date)} {inv.due_date && `· Due ${fmtDate(inv.due_date)}`}</div>
              </div>
              <StatusBadge value={inv.status} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">
              <div><div className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold">Place of Supply</div>
                <div className="mt-0.5 font-medium">{inv.place_of_supply?.state} ({inv.place_of_supply?.code})</div>
                {inv.pos_override_reason && <div className="text-amber-600 mt-0.5">Override: {inv.pos_override_reason}</div>}</div>
              <div><div className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold">Tax Scheme</div>
                <div className="mt-0.5 font-medium">{inv.tax_scheme === "intra_state" ? "Intra-state (CGST+SGST)" : inv.tax_scheme === "zero_rated" ? "Zero-rated" : "Inter-state (IGST)"}</div></div>
              <div><div className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold">Flags</div>
                <div className="mt-0.5 font-medium">{[inv.is_export_sez && (inv.lut_flag ? "Export/SEZ (LUT)" : "Export/SEZ"), inv.reverse_charge && "RCM"].filter(Boolean).join(" · ") || "—"}</div></div>
              {inv.reference_invoice_no && (
                <div><div className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold">Against Invoice</div>
                  <div className="mt-0.5 font-mono font-medium">{inv.reference_invoice_no}</div>
                  {inv.reason && <div className="text-slate-500 mt-0.5">{inv.reason}</div>}</div>)}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5" data-testid="invoice-customer">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Billed To</div>
            <div className="font-semibold text-slate-900">{cust.legal_name}</div>
            <div className="text-xs text-slate-500 mt-1">{cust.billing_address}</div>
            <div className="text-xs text-slate-500 mt-1 font-mono">GSTIN: {cust.gstin || "Unregistered"} · {cust.state} ({cust.state_code})</div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden" data-testid="invoice-lines">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
                <th className="text-left px-3 py-2">#</th><th className="text-left px-3 py-2">Description</th>
                <th className="text-left px-3 py-2">HSN/SAC</th><th className="text-right px-3 py-2">Qty</th>
                <th className="text-right px-3 py-2">Rate</th><th className="text-right px-3 py-2">Disc</th>
                <th className="text-right px-3 py-2">Taxable</th><th className="text-right px-3 py-2">GST%</th>
                {inv.tax_scheme === "intra_state" ? (<><th className="text-right px-3 py-2">CGST</th><th className="text-right px-3 py-2">SGST</th></>)
                  : (<th className="text-right px-3 py-2">IGST</th>)}
                <th className="text-right px-3 py-2">Total</th></tr></thead>
              <tbody>
                {inv.lines.map((l, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-xs text-slate-400">{i + 1}</td>
                    <td className="px-3 py-2">{l.description}</td>
                    <td className="px-3 py-2 font-mono text-xs">{l.hsn_sac}</td>
                    <td className="px-3 py-2 text-right font-mono">{l.qty} {l.unit}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtINR(l.rate)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtINR(l.discount)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtINR(l.taxable)}</td>
                    <td className="px-3 py-2 text-right font-mono">{l.tax_rate}%</td>
                    {inv.tax_scheme === "intra_state" ? (<>
                      <td className="px-3 py-2 text-right font-mono">{fmtINR(l.cgst)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtINR(l.sgst)}</td></>)
                      : (<td className="px-3 py-2 text-right font-mono">{fmtINR(l.igst)}</td>)}
                    <td className="px-3 py-2 text-right font-mono font-semibold">{fmtINR(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5" data-testid="invoice-totals">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-3">Totals</div>
            {[["Sub Total", inv.sub_total], ["Discount", -inv.total_discount], ["Taxable Value", inv.total_taxable],
              ["CGST", inv.total_cgst], ["SGST", inv.total_sgst], ["IGST", inv.total_igst],
              [`Round Off`, inv.round_off]].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm py-1">
                <span className="text-slate-600">{k}</span>
                <span className="font-mono">{fmtINR(v)}</span></div>
            ))}
            <div className="flex justify-between py-2 mt-1 border-t border-slate-200">
              <span className="font-semibold text-slate-900">Grand Total</span>
              <span className="font-mono font-bold text-lg text-slate-900" data-testid="invoice-grand-total">{fmtINR(inv.grand_total)}</span>
            </div>
            <div className="flex justify-between text-sm py-1"><span className="text-slate-600">Paid</span>
              <span className="font-mono text-emerald-700">{fmtINR(inv.amount_paid)}</span></div>
            <div className="flex justify-between text-sm py-1"><span className="text-slate-600">Balance</span>
              <span className="font-mono font-semibold text-amber-700" data-testid="invoice-balance">{fmtINR(inv.balance)}</span></div>
          </div>

          {inv.irn && (
            <div className="bg-white border border-slate-200 rounded-lg p-5" data-testid="irn-card">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2 flex items-center gap-1.5">
                <QrCode className="w-3.5 h-3.5" /> e-Invoice (sandbox)</div>
              <div className="font-mono text-[11px] break-all text-slate-700" data-testid="irn-value">{inv.irn}</div>
              <div className="text-xs text-slate-500 mt-1.5">Ack {inv.irn_ack_no} · {fmtDate(inv.irn_ack_date)}</div>
              <div className="text-[10px] text-amber-600 mt-1 font-semibold">Mock IRN — QR embedded in PDF. Real NIC integration is a Phase-2 follow-up.</div>
            </div>
          )}

          {inv.status !== "draft" && (
            <div className="bg-white border border-slate-200 rounded-lg p-5" data-testid="invoice-lifecycle">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-3">Lifecycle</div>
              <div className="space-y-2 text-xs text-slate-600">
                <div>Created: {fmtDateTime(inv.created_at)}</div>
                {inv.approved_at && <div>Approved & locked: {fmtDateTime(inv.approved_at)}</div>}
                {inv.sent_on && <div>Emailed: {fmtDateTime(inv.sent_on)} <span className="text-amber-600 font-semibold">(mocked)</span></div>}
                {inv.cancelled_at && <div className="text-red-600">Cancelled: {fmtDateTime(inv.cancelled_at)}</div>}
              </div>
              {emails.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Email log</div>
                  {emails.map((e) => (
                    <div key={e.id} className="text-xs text-slate-600 font-mono">{e.to} · {e.status} · {fmtDateTime(e.sent_on)}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <ActivityHistory entityType="invoice" entityId={inv.id} />
        </div>
      </div>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="max-w-md bg-white" data-testid="send-dialog">
          <DialogHeader><DialogTitle className="font-heading">Email {title}</DialogTitle></DialogHeader>
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-2">
            Email delivery is currently <b>mocked</b> (Brevo not configured). The send is tracked with timestamp &amp; status; PDF download remains the fallback.</div>
          <form onSubmit={send} className="space-y-3">
            <div><Label>To *</Label>
              <Input data-testid="send-to-input" type="email" required value={sendTo} onChange={(e) => setSendTo(e.target.value)} /></div>
            <Button data-testid="send-confirm-btn" type="submit" className="w-full bg-[#0F284E] hover:bg-[#17386D] text-white">Send (mock)</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cnOpen} onOpenChange={setCnOpen}>
        <DialogContent className="max-w-md bg-white" data-testid="note-dialog">
          <DialogHeader><DialogTitle className="font-heading">Create Credit / Debit Note</DialogTitle></DialogHeader>
          <form onSubmit={createNote} className="space-y-3">
            <div className="flex gap-2">
              {["CN", "DN"].map((t) => (
                <button type="button" key={t} data-testid={`note-type-${t}`} onClick={() => setCnType(t)}
                  className={`flex-1 text-xs font-semibold border rounded px-2 py-1.5 ${cnType === t ? "bg-[#0F284E] text-white border-[#0F284E]" : "bg-white text-slate-600 border-slate-200"}`}>
                  {DOC_TYPE_LABELS[t]}</button>
              ))}
            </div>
            <div><Label>Reason *</Label>
              <Input data-testid="note-reason-input" required value={cnReason} onChange={(e) => setCnReason(e.target.value)}
                placeholder="e.g. Post-sale discount, rate revision…" /></div>
            <p className="text-xs text-slate-500">Lines are mirrored from {inv.invoice_no} into a draft {DOC_TYPE_LABELS[cnType]} you can adjust before approval.</p>
            <Button data-testid="note-create-btn" type="submit" className="w-full bg-[#0F284E] hover:bg-[#17386D] text-white">Create draft note</Button>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
