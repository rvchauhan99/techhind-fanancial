import React, { useEffect, useState } from "react"
import api, { apiError } from "../lib/api"
import { fmtDateTime } from "../lib/format"
import { useAuth } from "../context/AuthContext"
import { Empty } from "./Layout"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { toast } from "sonner"

const SYSTEM_ACTIONS = new Set([
  "task_created", "task_updated", "task_assigned", "task_started", "task_completed",
  "status_changed", "assignee_changed", "observer_added", "observer_removed",
  "checklist_updated", "attachment_added", "attachment_removed",
  "reminder_set", "reminder_cleared", "project_created", "project_updated",
])

/**
 * Chat-style activity feed for project/task with polling.
 */
export default function WorkActivity({ entityType, entityId, canComment, pollMs = 20000 }) {
  const { canCap } = useAuth()
  const [rows, setRows] = useState(null)
  const [body, setBody] = useState("")
  const write = canComment ?? canCap("can_work_write")

  const load = () => {
    if (!entityType || !entityId) {
      setRows([])
      return
    }
    api
      .get("/work/activity", { params: { entity_type: entityType, entity_id: entityId, limit: 100 } })
      .then((r) => setRows((r.data || []).slice().reverse()))
      .catch(() => setRows([]))
  }

  useEffect(() => {
    load()
    if (!pollMs) return undefined
    const t = setInterval(load, pollMs)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, pollMs])

  const handleComment = async (e) => {
    e.preventDefault()
    if (!body.trim()) return
    try {
      const path = entityType === "project"
        ? `/work/projects/${entityId}/comments`
        : `/work/tasks/${entityId}/comments`
      await api.post(path, { body: body.trim() })
      setBody("")
      toast.success("Comment posted")
      load()
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg flex flex-col h-full min-h-[320px]" data-testid="work-activity-panel">
      <div className="px-3 py-2 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-500 font-semibold shrink-0">
        Activity / Chat
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-[55vh]" data-testid="activity-feed">
        {(rows || []).map((r) => {
          const isComment = r.action === "comment"
          const isSystem = SYSTEM_ACTIONS.has(r.action) && !isComment
          if (isSystem && !r.comment) {
            return (
              <div key={r.id} className="text-center text-[11px] text-slate-500 py-1" data-testid={`activity-sys-${r.id}`}>
                <span className="font-medium text-slate-600">{r.user_name}</span>
                {" · "}
                {r.summary || r.action}
                <span className="ml-1 font-mono text-[10px] text-slate-400">{fmtDateTime(r.ts)}</span>
              </div>
            )
          }
          return (
            <div key={r.id} className="flex flex-col gap-0.5" data-testid={`activity-msg-${r.id}`}>
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-slate-800">{r.user_name}</span>
                <span className="font-mono text-[10px] text-slate-400">{fmtDateTime(r.ts)}</span>
              </div>
              <div className="text-sm text-slate-700 bg-slate-50 border border-slate-100 rounded-md px-2.5 py-1.5 whitespace-pre-wrap">
                {r.comment || r.summary}
              </div>
            </div>
          )
        })}
        {rows && !rows.length && <Empty label="No activity yet" />}
      </div>
      {write && (
        <form onSubmit={handleComment} className="px-3 py-2 border-t border-slate-100 flex gap-2 shrink-0">
          <Input
            data-testid="work-comment-input"
            className="h-8 text-xs"
            placeholder="Write a comment… use @Name to mention"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button data-testid="work-comment-submit" type="submit" size="sm" className="h-8 bg-[#0F284E] hover:bg-[#17386D] text-white shrink-0">
            Send
          </Button>
        </form>
      )}
    </div>
  )
}
