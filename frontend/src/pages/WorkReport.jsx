import React, { useEffect, useState } from "react"
import api from "../lib/api"
import Layout, { Empty } from "../components/Layout"

export default function WorkReport() {
  const [data, setData] = useState(null)

  useEffect(() => {
    api.get("/work/report").then((r) => setData(r.data)).catch(() => setData(null))
  }, [])

  if (!data) {
    return (
      <Layout title="Work Report">
        <div className="text-sm text-slate-500">Loading…</div>
      </Layout>
    )
  }

  const { totals } = data

  return (
    <Layout title="Work Report">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="work-report-kpis">
        {[
          ["Tasks", totals.tasks],
          ["Open", totals.open_tasks],
          ["Done", totals.done_tasks],
          ["Projects", totals.projects],
        ].map(([label, val]) => (
          <div key={label} className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
            <div className="font-mono font-bold text-xl text-slate-900 mt-1">{val}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg" data-testid="report-by-category">
          <div className="px-3 py-2 border-b border-slate-200 text-sm font-semibold">By category</div>
          <table className="w-full text-sm">
            <tbody>
              {data.by_category.map((r) => (
                <tr key={r.category} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 capitalize">{r.category}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.by_category.length && <Empty label="No data" />}
        </div>
        <div className="bg-white border border-slate-200 rounded-lg" data-testid="report-by-status">
          <div className="px-3 py-2 border-b border-slate-200 text-sm font-semibold">By status</div>
          <table className="w-full text-sm">
            <tbody>
              {data.by_status.map((r) => (
                <tr key={r.status} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">{r.status}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.by_status.length && <Empty label="No data" />}
        </div>
        <div className="bg-white border border-slate-200 rounded-lg" data-testid="report-by-assignee">
          <div className="px-3 py-2 border-b border-slate-200 text-sm font-semibold">By assignee</div>
          <table className="w-full text-sm">
            <tbody>
              {data.by_assignee.map((r) => (
                <tr key={r.assignee_id || "u"} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.by_assignee.length && <Empty label="No data" />}
        </div>
      </div>
    </Layout>
  )
}
