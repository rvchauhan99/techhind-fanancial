import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { fmtDateTime } from "../lib/format";
import Layout, { Empty } from "../components/Layout";
import FilterBar, { FIELD } from "../components/filters/FilterBar";
import { useListFilters } from "../hooks/useListFilters";

const ENTITY_TYPES = ["user", "company", "masters", "customer", "product", "subscription", "vendor",
  "invoice", "payment", "purchase_bill", "vendor_payment", "expense_voucher", "period", "import", "system"];

const SCHEMA = [
  { key: "q", type: FIELD.TEXT, label: "Search", placeholder: "Summary / user…", width: "w-44" },
  { key: "entity_type", type: FIELD.SELECT, label: "Entity", width: "w-44",
    options: ENTITY_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") })) },
  { key: "action", type: FIELD.TEXT, label: "Action", placeholder: "action…", width: "w-36" },
  { key: "dates", type: FIELD.DATE_RANGE, label: "Date" },
];

export default function Audit() {
  const [rows, setRows] = useState(null);
  const { values, setFilter, clearFilters, activeCount, apiParams } = useListFilters(SCHEMA);

  useEffect(() => {
    api.get("/audit", { params: apiParams }).then((r) => setRows(r.data)).catch(() => setRows([]));
  }, [apiParams]);

  return (
    <Layout title="Audit Trail">
      <FilterBar schema={SCHEMA} values={values} setFilter={setFilter}
        clearFilters={clearFilters} activeCount={activeCount} testId="audit-filters" />
      <div className="bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-sm" data-testid="audit-table">
          <thead><tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
            <th className="text-left px-3 py-2">Timestamp</th><th className="text-left px-3 py-2">User</th>
            <th className="text-left px-3 py-2">Role</th><th className="text-left px-3 py-2">IP</th>
            <th className="text-left px-3 py-2">Action</th>
            <th className="text-left px-3 py-2">Entity</th><th className="text-left px-3 py-2">Summary</th></tr></thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.id} data-testid={`audit-row-${r.id}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{fmtDateTime(r.ts)}</td>
                <td className="px-3 py-2 text-xs font-medium">{r.user_name}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{r.role}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500" data-testid={`audit-ip-${r.id}`}>{r.ip || "—"}</td>
                <td className="px-3 py-2"><span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border bg-slate-50 text-slate-600 border-slate-200">{r.action}</span></td>
                <td className="px-3 py-2 text-xs text-slate-500 font-mono">{r.entity_type}</td>
                <td className="px-3 py-2 text-xs text-slate-700">{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty label="No audit entries" />}
      </div>
    </Layout>
  );
}
