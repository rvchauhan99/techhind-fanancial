import React, { useEffect, useState } from "react"
import api, { apiError } from "../lib/api"
import { fmtDateTime } from "../lib/format"
import { useAuth } from "../context/AuthContext"
import { Empty } from "./Layout"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { toast } from "sonner"

/**
 * Work activity (comments + field diffs) for project/task entities.
 */
export default function WorkActivity({ entityType, entityId, canComment }) {
  const { canCap } = useAuth()
  const [rows, setRows] = useState(null)
  const [body, setBody] = useState("")
  const [openDiff, setOpenDiff] = useState("")
  const write = canComment ?? canCap("can_work_write")

  const load = () => {
    if (!entityType || !entityId) {
      setRows([])
      return
    }
    api
      .get("/work/activity", { params: { entity_type: entityType, entity_id: entityId, limit: 80 } })
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
  }

  useEffect(() => { load() }, [entityType, entityId])

  const handleComment = async (e) => {
    e.preventDefault()
    if (!body.trim()) return
    try {
      const path = entityType === "project"
        ? `/work/projects/${entityId}/comments`
        : `/work/tasks/${entityId}/comments`
      await api.post(path, { body: body.trim() })
      setBody("")
      toast.success("Comment added")
      load()
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg" data-testid="work-activity-panel">
      <div className="px-3 py-2 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
        Activity
      </div>
      {write && (
        <form onSubmit={handleComment} className="px-3 py-2 border-b border-slate-100 flex gap-2">
          <Input
            data-testid="work-comment-input"
            className="h-8 text-xs"
            placeholder="Add a comment…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button data-testid="work-comment-submit" type="submit" size="sm" className="h-8 bg-[#0F284E] hover:bg-[#17386D] text-white shrink-0">
            Post
          </Button>
        </form>
      )}
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600 text-[10px] uppercase tracking-wider sticky top-0">
              <th className="text-left px-3 py-1.5">Time</th>
              <th className="text-left px-3 py-1.5">User</th>
              <th className="text-left px-3 py-1.5">Action</th>
              <th className="text-left px-3 py-1.5">Detail</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => (
              <React.Fragment key={r.id}>
                <tr className="border-t border-slate-100 hover:bg-slate-50/80">
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">{fmtDateTime(r.ts)}</td>
                  <td className="px-3 py-1.5 text-xs">{r.user_name}</td>
                  <td className="px-3 py-1.5 text-xs font-medium">{r.action}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-700">
                    {r.comment || r.summary}
                    {r.diff && Object.keys(r.diff).length > 0 && (
                      <button
                        type="button"
                        className="ml-2 text-[10px] text-[#0066CC] font-semibold"
                        onClick={() => setOpenDiff(openDiff === r.id ? "" : r.id)}
                      >
                        {openDiff === r.id ? "Hide diff" : "Diff"}
                      </button>
                    )}
                  </td>
                </tr>
                {openDiff === r.id && r.diff && (
                  <tr className="bg-slate-50">
                    <td colSpan={4} className="px-3 py-2">
                      <pre className="text-[10px] font-mono text-slate-600 whitespace-pre-wrap">{JSON.stringify(r.diff, null, 2)}</pre>
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
