import React, { useEffect, useState } from "react";
import { Lock, LockOpen, FileCheck2, Eye } from "lucide-react";
import { toast } from "sonner";
import api, { apiError } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import Layout from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import FilterBar, { FIELD } from "../components/filters/FilterBar";
import { useListFilters } from "../hooks/useListFilters";

const STATE_META = {
  open: { label: "Open", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: LockOpen },
  in_review: { label: "In Review", cls: "bg-amber-50 text-amber-700 border-amber-200", icon: Eye },
  gst_filed: { label: "GST Filed", cls: "bg-blue-50 text-blue-700 border-blue-200", icon: FileCheck2 },
  closed: { label: "Closed", cls: "bg-slate-100 text-slate-600 border-slate-300", icon: Lock },
};
const NEXT = { open: "in_review", in_review: "gst_filed", gst_filed: "closed" };

const SCHEMA = [
  { key: "fy", type: FIELD.SELECT, label: "FY", width: "w-36",
    options: ["2024-25", "2025-26", "2026-27", "2027-28"].map((fy) => ({ value: fy, label: `FY ${fy}` })) },
  { key: "state", type: FIELD.SELECT, label: "Status", width: "w-36",
    options: Object.entries(STATE_META).map(([v, m]) => ({ value: v, label: m.label })) },
];

export default function PeriodClose() {
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const { values, setFilter, clearFilters, activeCount, apiParams } = useListFilters(SCHEMA);

  const load = () => api.get("/periods", { params: apiParams }).then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); }, [apiParams]); // eslint-disable-line

  const transition = async (month, state) => {
    try {
      await api.post(`/periods/${month}/state`, { state });
      toast.success(`Period ${month} → ${state.replace("_", " ")}`);
      load();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const canWrite = can("admin", "accountant");
  const isAdmin = can("admin");

  return (
    <Layout title="Period Close & Lock">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 text-xs text-blue-800 max-w-4xl" data-testid="period-rules">
        Lock rules — <b>in review</b>: only Admin can post into the period · <b>GST filed / closed</b>: fully locked for everyone.
        Backward transitions and reopening a closed period require Admin.
      </div>
      <FilterBar schema={SCHEMA} values={values} setFilter={setFilter}
        clearFilters={clearFilters} activeCount={activeCount} testId="period-filters" />
      <div className="bg-white border border-slate-200 rounded-lg max-w-4xl">
        <table className="w-full text-sm" data-testid="periods-table">
          <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
            <th className="text-left px-3 py-2">Period</th><th className="text-left px-3 py-2">State</th>
            <th className="text-left px-3 py-2">Last change</th><th className="text-right px-3 py-2">Actions</th></tr></thead>
          <tbody>
            {(rows || []).map((p) => {
              const meta = STATE_META[p.state];
              const last = (p.history || []).slice(-1)[0];
              return (
                <tr key={p.month} data-testid={`period-row-${p.month}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                  <td className="px-3 py-2 font-mono font-semibold">{p.month}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${meta.cls}`} data-testid={`period-state-${p.month}`}>
                      <meta.icon className="w-3 h-3" />{meta.label}</span></td>
                  <td className="px-3 py-2 text-xs text-slate-500">{last ? `${last.from} → ${last.to} by ${last.by} · ${fmtDateTime(last.at)}` : "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {canWrite && NEXT[p.state] && (
                      <Button size="sm" variant="outline" data-testid={`period-advance-${p.month}`}
                        onClick={() => transition(p.month, NEXT[p.state])}
                        className="h-7 text-xs mr-1">Move to {STATE_META[NEXT[p.state]].label}</Button>)}
                    {isAdmin && p.state !== "open" && (
                      <Button size="sm" variant="outline" data-testid={`period-reopen-${p.month}`}
                        onClick={() => transition(p.month, "in_review")}
                        className="h-7 text-xs text-amber-700 border-amber-200 hover:bg-amber-50">Reopen</Button>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
