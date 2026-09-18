import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Mail, Phone, MapPin } from "lucide-react";
import api from "../lib/api";
import { fmtINR, fmtDate } from "../lib/format";
import Layout, { StatusBadge, Empty } from "../components/Layout";

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    api.get(`/customers/${id}/overview`).then((r) => setData(r.data)).catch(() => {});
    api.get("/tickets", { params: { customer_id: id, limit: 20 } }).then((r) => setTickets(r.data || [])).catch(() => {});
    api.get("/work/projects", { params: { customer_id: id, limit: 20 } }).then((r) => setProjects(r.data || [])).catch(() => {});
  }, [id]);

  if (!data) return <Layout title="Customer"><div className="text-sm text-slate-500">Loading…</div></Layout>;

  const { customer: c, subscriptions, invoices, payments, outstanding, total_billed } = data;
  const contact = (c.contacts || [])[0] || {};

  return (
    <Layout title={c.legal_name}
      actions={<button data-testid="back-to-customers" onClick={() => navigate("/customers")}
        className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> Back</button>}>
      <div className="bg-white border border-slate-200 rounded-lg p-5" data-testid="customer-360-header">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-xl font-bold text-slate-900">{c.legal_name}</h2>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span className="font-mono">GSTIN: {c.gstin || "Unregistered"}</span>
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.state} ({c.state_code})</span>
              {contact.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{contact.email}</span>}
              {contact.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{contact.phone}</span>}
              {c.crm_tenant_key && <span className="font-mono">CRM: {c.crm_tenant_key}</span>}
            </div>
            <div className="mt-2 text-xs text-slate-500 max-w-xl">{c.billing_address}</div>
          </div>
          <div className="flex gap-6">
            <div><div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Total Billed</div>
              <div className="font-mono font-bold text-lg text-slate-900" data-testid="customer-total-billed">{fmtINR(total_billed)}</div></div>
            <div><div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Outstanding</div>
              <div className={`font-mono font-bold text-lg ${outstanding > 0 ? "text-amber-700" : "text-emerald-700"}`} data-testid="customer-outstanding">{fmtINR(outstanding)}</div></div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg" data-testid="customer-projects">
        <div className="px-4 py-2.5 border-b border-slate-200 text-sm font-semibold text-slate-800 flex items-center justify-between">
          <span>Projects</span>
          <Link to="/projects" className="text-xs font-medium text-[#0066CC]">View all</Link>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
            <th className="text-left px-3 py-2">Number</th><th className="text-left px-3 py-2">Name</th>
            <th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Owner</th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/projects/${p.id}`)}>
                <td className="px-3 py-2 font-mono text-xs text-[#0066CC]">{p.number}</td>
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-2"><StatusBadge value={p.status} /></td>
                <td className="px-3 py-2 text-xs">{p.owner?.name || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!projects.length && <Empty label="No projects linked" />}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg" data-testid="customer-tickets">
        <div className="px-4 py-2.5 border-b border-slate-200 text-sm font-semibold text-slate-800 flex items-center justify-between">
          <span>Support tickets</span>
          <Link to="/tickets" className="text-xs font-medium text-[#0066CC]">View all</Link>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
            <th className="text-left px-3 py-2">Number</th><th className="text-left px-3 py-2">Subject</th>
            <th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Updated</th></tr></thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/tickets/${t.id}`)}>
                <td className="px-3 py-2 font-mono text-xs text-[#0066CC]">{t.number}</td>
                <td className="px-3 py-2">{t.subject}</td>
                <td className="px-3 py-2"><StatusBadge value={t.status} /></td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{fmtDate(t.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!tickets.length && <Empty label="No support tickets" />}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg" data-testid="customer-subscriptions">
        <div className="px-4 py-2.5 border-b border-slate-200 text-sm font-semibold text-slate-800">Subscriptions</div>
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
            <th className="text-left px-3 py-2">Plan</th><th className="text-left px-3 py-2">Status</th>
            <th className="text-left px-3 py-2">Cycle</th><th className="text-right px-3 py-2">Price</th>
            <th className="text-right px-3 py-2">MRR</th><th className="text-left px-3 py-2">Next Renewal</th></tr></thead>
          <tbody>
            {subscriptions.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{s.plan_name}</td>
                <td className="px-3 py-2"><StatusBadge value={s.status} /></td>
                <td className="px-3 py-2 text-slate-600 capitalize">{s.billing_cycle.replace("_", " ")}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtINR(s.price)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtINR(s.mrr)}</td>
                <td className="px-3 py-2 font-mono text-xs">{fmtDate(s.next_renewal_on)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!subscriptions.length && <Empty label="No subscriptions" />}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg" data-testid="customer-invoices">
        <div className="px-4 py-2.5 border-b border-slate-200 text-sm font-semibold text-slate-800">
          Invoices &amp; Notes {data.draft_count > 0 && <span className="text-xs font-normal text-slate-500">({data.draft_count} drafts not shown)</span>}</div>
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
            <th className="text-left px-3 py-2">Number</th><th className="text-left px-3 py-2">Type</th>
            <th className="text-left px-3 py-2">Date</th><th className="text-right px-3 py-2">Total</th>
            <th className="text-right px-3 py-2">Balance</th><th className="text-left px-3 py-2">Status</th></tr></thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                <td className="px-3 py-2"><Link to={`/invoices/${i.id}`} className="font-mono text-xs text-[#0066CC] hover:underline">{i.invoice_no || "DRAFT"}</Link></td>
                <td className="px-3 py-2 text-xs text-slate-600">{i.doc_type}</td>
                <td className="px-3 py-2 text-xs">{fmtDate(i.invoice_date)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtINR(i.grand_total)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtINR(i.balance)}</td>
                <td className="px-3 py-2"><StatusBadge value={i.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!invoices.length && <Empty label="No invoices yet" />}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg" data-testid="customer-payments">
        <div className="px-4 py-2.5 border-b border-slate-200 text-sm font-semibold text-slate-800">Payments</div>
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
            <th className="text-left px-3 py-2">Receipt</th><th className="text-left px-3 py-2">Date</th>
            <th className="text-left px-3 py-2">Method</th><th className="text-right px-3 py-2">Amount</th>
            <th className="text-right px-3 py-2">Unallocated</th></tr></thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{p.receipt_no}</td>
                <td className="px-3 py-2 text-xs">{fmtDate(p.payment_date)}</td>
                <td className="px-3 py-2 text-xs uppercase">{p.method}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtINR(p.amount)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtINR(p.unallocated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!payments.length && <Empty label="No payments recorded" />}
      </div>
    </Layout>
  );
}
