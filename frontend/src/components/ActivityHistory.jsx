import React, { useEffect, useState } from "react"
import api from "../lib/api"
import { fmtDateTime } from "../lib/format"
import { useAuth } from "../context/AuthContext"
import { Empty } from "./Layout"

/**
 * Dense entity activity history (audit_logs filtered by entity).
 * Visible to admin/accountant only (API enforces FINANCE_ROLES).
 */
export default function ActivityHistory({ entityType, entityId }) {
  const { user } = useAuth()
  const [rows, setRows] = useState(null)
  const [openDiff, setOpenDiff] = useState("")

  const canView = user?.role === "admin" || user?.role === "accountant"

  useEffect(() => {
    if (!canView || !entityType || !entityId) {
      setRows([])
      return
    }
    api
      .get("/activity", { params: { entity_type: entityType, entity_id: entityId, limit: 50 } })
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
  }, [canView, entityType, entityId])

  if (!canView) return null

  return (
    <div className="bg-white border border-slate-200 rounded-lg" data-testid="activity-panel">
      <div className="px-3 py-2 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
        Activity history
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm pwa-table">
          <thead>
            <tr className="bg-slate-50 text-slate-600 text-[10px] uppercase tracking-wider">
              <th className="text-left px-3 py-1.5">Time</th>
              <th className="text-left px-3 py-1.5">User</th>
              <th className="text-left px-3 py-1.5">IP</th>
              <th className="text-left px-3 py-1.5">Action</th>
              <th className="text-left px-3 py-1.5">Summary</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => (
              <React.Fragment key={r.id}>
                <tr
                  data-testid={`activity-row-${r.id}`}
                  className="border-t border-slate-100 hover:bg-slate-50/80 cursor-pointer"
                  onClick={() => setOpenDiff(openDiff === r.id ? "" : r.id)}
                >
                  <td className="px-3 py-1.5 font-mono text-[11px] whitespace-nowrap">{fmtDateTime(r.ts)}</td>
                  <td className="px-3 py-1.5 text-xs font-medium">{r.user_name}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">{r.ip || "—"}</td>
                  <td className="px-3 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-slate-50 text-slate-600 border-slate-200">
                      {r.action}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-slate-700">{r.summary}</td>
                </tr>
                {openDiff === r.id && r.diff && Object.keys(r.diff).length > 0 && (
                  <tr className="border-t border-slate-50 bg-slate-50/50">
                    <td colSpan={5} className="px-3 py-2">
                      <pre className="text-[11px] font-mono text-slate-600 whitespace-pre-wrap break-all max-h-40 overflow-y-auto" data-testid={`activity-diff-${r.id}`}>
                        {JSON.stringify(r.diff, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty label="No activity yet" />}
      </div>
    </div>
  )
}
