import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, Landmark, ReceiptIndianRupee, AlertTriangle, Repeat, Percent, ListTodo, FolderKanban } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell } from "recharts";
import api from "../lib/api";
import { fmtINR } from "../lib/format";
import Layout from "../components/Layout";
import { useAuth } from "../context/AuthContext";

const AGING_COLORS = { current: "#94a3b8", "0-30": "#2563EB", "31-60": "#D97706", "61-90": "#EA580C", "90+": "#DC2626" };

function Kpi({ tid, title, value, sub, icon: Icon, tone = "text-slate-900" }) {
  return (
    <div data-testid={tid} className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</span>
        <Icon className="w-4 h-4 text-slate-400" />
      </div>
      <div className={`mt-2 font-mono font-bold tracking-tight text-xl ${tone}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

export default function Dashboard() {
  const { hasMenu, menus } = useAuth();
  const [data, setData] = useState(null);
  const [work, setWork] = useState(null);
  const showFinance = !menus?.length || hasMenu("invoices");
  const showWork = !menus?.length || hasMenu("projects") || hasMenu("tasks") || hasMenu("work_report");

  useEffect(() => {
    if (showFinance) {
      api.get("/dashboard/summary").then((r) => setData(r.data)).catch(() => setData(null));
    } else {
      setData(null);
    }
    if (showWork) {
      api.get("/work/dashboard").then((r) => setWork(r.data)).catch(() => setWork(null));
    }
  }, [showFinance, showWork]);

  if ((showFinance && data === null && work === null) || (!showFinance && showWork && work === null && data === null))
    return (
      <Layout title="Dashboard">
        <div className="text-sm text-slate-500" data-testid="dashboard-loading">Loading dashboard…</div>
      </Layout>
    );

  // Wait for at least one successful load when both requested
  if (showFinance && !data && showWork && !work) {
    return (
      <Layout title="Dashboard">
        <div className="text-sm text-slate-500" data-testid="dashboard-loading">Loading dashboard…</div>
      </Layout>
    );
  }

  const kpis = data?.kpis;

  return (
    <Layout title="Dashboard">
      {work && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="work-kpi-grid">
          <Kpi tid="kpi-my-open" title="My Open Tasks" value={work.my_open} sub="Assigned to me" icon={ListTodo} />
          <Kpi tid="kpi-my-overdue" title="My Overdue" value={work.my_overdue} sub="Past due date" icon={AlertTriangle} tone="text-amber-700" />
          <Kpi tid="kpi-all-overdue" title="Team Overdue" value={work.all_overdue} sub="All open overdue" icon={AlertTriangle} tone="text-red-700" />
          <Kpi tid="kpi-reminders" title="Reminders Due" value={work.reminders_due || 0} sub={<Link to="/tasks?view=deadline" className="text-[#0066CC]">Deadline view →</Link>} icon={ListTodo} />
          <Kpi tid="kpi-active-projects" title="Active Projects" value={work.active_projects} sub="Planned + active" icon={FolderKanban} />
        </div>
      )}

      {work?.workload?.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4" data-testid="workload-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-800">Open workload by assignee</h3>
            <Link to="/work-report" className="text-xs font-semibold text-[#0066CC]">Work report →</Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
            {work.workload.map((w) => (
              <div key={w.assignee_id || "none"} className="border border-slate-100 rounded px-2.5 py-1.5 text-xs">
                <div className="text-slate-600 truncate">{w.assignee?.name || "Unassigned"}</div>
                <div className="font-mono font-bold text-slate-900">{w.open}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {kpis && (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-3" data-testid="kpi-grid">
        <Kpi tid="kpi-mrr-card" title="SaaS MRR" value={fmtINR(kpis.mrr)} sub={`ARR ${fmtINR(kpis.arr)}`} icon={Repeat} />
        <Kpi tid="kpi-billed-card" title="Net Billed (Month)" value={fmtINR(kpis.billed_month)} sub="Approved invoices less CN" icon={TrendingUp} />
        <Kpi tid="kpi-collected-card" title="Collected (Month)" value={fmtINR(kpis.collected_month)} sub="Receipts this month" icon={ReceiptIndianRupee} tone="text-emerald-700" />
        <Kpi tid="kpi-outstanding-card" title="AR Outstanding" value={fmtINR(kpis.outstanding)} sub="Open invoice balances" icon={AlertTriangle} tone="text-amber-700" />
        <Kpi tid="kpi-cash-bank-card" title="Cash + Bank" value={fmtINR(kpis.cash_bank_position || 0)} sub={<Link to="/banks" className="text-[#0066CC]">Bank ledger →</Link>} icon={Landmark} tone="text-emerald-700" />
        <Kpi tid="kpi-gst-card" title="Net GST Liability" value={fmtINR(kpis.gst_liability)} sub={`Output ${fmtINR(kpis.output_tax_month)} − ITC ${fmtINR(kpis.itc_month)}`} icon={Percent} />
        <Kpi tid="kpi-subs-card" title="Active Subscriptions" value={kpis.active_subscriptions} sub={`FY ${data.fy}`} icon={Landmark} />
      </div>
      )}

      {data && (
      <>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-lg p-4" data-testid="trend-chart">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Billed vs Collected — last 6 months</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.trend} barGap={2}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v) => fmtINR(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="billed" name="Billed" fill="#0F284E" radius={[3, 3, 0, 0]} />
              <Bar dataKey="collected" name="Collected" fill="#10B981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4" data-testid="ar-aging-card">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">AR Aging</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.ar_aging} layout="vertical">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="bucket" width={56} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => fmtINR(v)} />
              <Bar dataKey="amount" radius={[0, 3, 3, 0]}>
                {data.ar_aging.map((a) => (
                  <Cell key={a.bucket} fill={AGING_COLORS[a.bucket]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4" data-testid="top-customers-card">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Top Customers (FY billed)</h3>
          <div className="space-y-2">
            {data.top_customers.map((c, i) => (
              <div key={c.name} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 truncate"><span className="font-mono text-xs text-slate-400 mr-2">{i + 1}</span>{c.name}</span>
                <span className="font-mono font-semibold text-slate-900 ml-2">{fmtINR(c.billed)}</span>
              </div>
            ))}
            {!data.top_customers.length && <div className="text-xs text-slate-400">No billing yet this FY</div>}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4" data-testid="expense-category-card">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Expenses by Category (FY)</h3>
          <div className="space-y-2">
            {data.expense_by_category.slice(0, 6).map((c) => (
              <div key={c.category} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 truncate">{c.category}</span>
                <span className="font-mono font-semibold text-slate-900 ml-2">{fmtINR(c.total)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4" data-testid="subscription-health-card">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Subscription Health</h3>
          <div className="flex flex-wrap gap-2">
            {data.subscription_health.map((s) => (
              <span key={s.status} className="border border-slate-200 rounded px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50">
                {s.status} <span className="font-mono font-bold ml-1">{s.count}</span>
              </span>
            ))}
          </div>
          <Link to="/subscriptions" data-testid="view-subscriptions-link" className="inline-block mt-4 text-xs font-semibold text-[#0066CC]">
            Open renewals workspace →
          </Link>
        </div>
      </div>
      </>
      )}
    </Layout>
  );
}
