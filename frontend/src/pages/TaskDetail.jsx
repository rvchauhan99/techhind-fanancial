import React, { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Download, Loader2, Paperclip, Trash2 } from "lucide-react"
import { toast } from "sonner"
import api, { apiError, API } from "../lib/api"
import { fmtDate, fmtDateTime, TASK_STATUSES, taskStatusLabel } from "../lib/format"
import { MAX_TASK_ATTACHMENTS } from "../lib/uploadLimits"
import Layout, { StatusBadge } from "../components/Layout"
import WorkActivity from "../components/WorkActivity"
import FileDropzone from "../components/FileDropzone"
import { downloadStoredFile } from "../components/tickets/TicketAttachmentViewer"
import { useAuth } from "../context/AuthContext"
import { Label } from "../components/ui/label"
import { Input } from "../components/ui/input"
import { Button } from "../components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"

const TYPES = [
  "development", "uat", "testing", "customer_demo", "documentation",
  "training", "support_ops", "other",
]

export default function TaskDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { canCap, user } = useAuth()
  const [task, setTask] = useState(null)
  const [users, setUsers] = useState([])
  const [checkText, setCheckText] = useState("")
  const [descEdit, setDescEdit] = useState("")
  const [titleBaseline, setTitleBaseline] = useState("")
  const [reminderLocal, setReminderLocal] = useState("")
  const [uploading, setUploading] = useState(false)
  const [downloadingId, setDownloadingId] = useState(null)
  const [rejectReason, setRejectReason] = useState("")
  const [activityRefresh, setActivityRefresh] = useState(0)
  const bumpActivity = () => setActivityRefresh((n) => n + 1)

  const load = () => {
    api.get(`/work/tasks/${id}`).then((r) => {
      setTask(r.data)
      setDescEdit(r.data.description || "")
      setTitleBaseline(r.data.title || "")
      setReminderLocal(r.data.reminder_at ? r.data.reminder_at.slice(0, 16) : "")
    }).catch(() => setTask(null))
  }

  useEffect(() => { load() }, [id])

  useEffect(() => {
    api.get("/users", { params: { active_only: true } }).then((r) => setUsers(r.data || [])).catch(() => {})
  }, [])

  const patch = async (body) => {
    try {
      const { data } = await api.patch(`/work/tasks/${id}`, body)
      setTask(data)
      if (Object.prototype.hasOwnProperty.call(body, "title")) {
        setTitleBaseline(data.title || "")
      }
      bumpActivity()
      toast.success("Task updated")
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const handleTitleBlur = () => {
    const next = task?.title || ""
    if (next === titleBaseline) return
    patch({ title: next })
  }

  const handleStart = async () => {
    try {
      const { data } = await api.post(`/work/tasks/${id}/start`)
      setTask(data)
      bumpActivity()
      toast.success("Task started")
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const handleComplete = async () => {
    try {
      const { data } = await api.post(`/work/tasks/${id}/complete`)
      setTask(data)
      bumpActivity()
      toast.success("Task completed")
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const handleReject = async () => {
    const reason = rejectReason.trim()
    if (!reason) {
      toast.error("Rejection reason is required")
      return
    }
    try {
      const { data } = await api.post(`/work/tasks/${id}/reject-testing`, { reason })
      setTask(data)
      setRejectReason("")
      bumpActivity()
      toast.success("Testing rejected")
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const handleReady = async () => {
    try {
      const { data } = await api.post(`/work/tasks/${id}/ready-to-live`)
      setTask(data)
      bumpActivity()
      toast.success("Marked ready to live")
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const saveObservers = async (ids) => {
    try {
      const { data } = await api.put(`/work/tasks/${id}/observers`, { observer_ids: ids })
      setTask(data)
      bumpActivity()
      toast.success("Observers updated")
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const toggleObserver = (uid) => {
    const cur = new Set(task.observer_ids || [])
    if (cur.has(uid)) cur.delete(uid)
    else cur.add(uid)
    saveObservers([...cur])
  }

  const saveChecklist = async (items) => {
    try {
      const { data } = await api.put(`/work/tasks/${id}/checklist`, { items })
      setTask(data)
      bumpActivity()
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const addCheckItem = async (e) => {
    e.preventDefault()
    if (!checkText.trim()) return
    const items = [...(task.checklist || []), { text: checkText.trim(), done: false, sort_order: (task.checklist || []).length }]
    setCheckText("")
    await saveChecklist(items)
    toast.success("Checklist item added")
  }

  const toggleCheck = async (itemId) => {
    const items = (task.checklist || []).map((c) =>
      c.id === itemId ? { ...c, done: !c.done } : c
    )
    await saveChecklist(items)
  }

  const removeCheck = async (itemId) => {
    await saveChecklist((task.checklist || []).filter((c) => c.id !== itemId))
  }

  const handleUploadFiles = async (incoming) => {
    if (!incoming?.length) return
    setUploading(true)
    let ok = 0
    try {
      for (const file of incoming) {
        const fd = new FormData()
        fd.append("file", file)
        try {
          const { data } = await api.post(`/work/tasks/${id}/attachments`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          })
          setTask(data)
          ok += 1
        } catch (err) {
          toast.error(apiError(err))
          break
        }
      }
      if (ok) {
        bumpActivity()
        toast.success(ok === 1 ? "File attached" : `${ok} files attached`)
      }
    } finally {
      setUploading(false)
    }
  }

  const handleDownloadFile = async (file) => {
    setDownloadingId(file.id)
    try {
      await downloadStoredFile(file.storage_path, file.original_filename || "file")
    } catch (err) {
      toast.error(apiError(err) || "Download failed")
    } finally {
      setDownloadingId(null)
    }
  }

  const removeFile = async (fid) => {
    try {
      const { data } = await api.delete(`/work/tasks/${id}/attachments/${fid}`)
      setTask(data)
      bumpActivity()
      toast.success("Attachment removed")
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const saveReminder = async () => {
    try {
      const reminder_at = reminderLocal ? new Date(reminderLocal).toISOString() : null
      const { data } = await api.post(`/work/tasks/${id}/reminders`, { reminder_at })
      setTask(data)
      bumpActivity()
      toast.success(reminder_at ? "Reminder set" : "Reminder cleared")
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  if (!task) {
    return <Layout title="Task"><div className="text-sm text-slate-500">Loading…</div></Layout>
  }

  const write = canCap("can_work_write")
  const canSignOff = canCap("can_work_manage") || ["qa", "business_analyst"].includes(user?.role)
  const overdue = task.due_date && !["done", "cancelled"].includes(task.status)
    && task.due_date < new Date().toISOString().slice(0, 10)

  return (
    <Layout
      title={task.title}
      actions={
        <div className="flex items-center gap-2">
          {write && task.status !== "in_progress" && task.status !== "done" && (
            <Button size="sm" data-testid="task-start-btn" onClick={handleStart}
              className="h-8 bg-[#0066CC] hover:bg-[#0055aa] text-white">Start</Button>
          )}
          {canSignOff && !["done", "cancelled", "testing_rejected"].includes(task.status) && (
            <Button size="sm" data-testid="task-reject-btn" variant="outline" onClick={handleReject} className="h-8">
              Reject testing
            </Button>
          )}
          {canSignOff && !["done", "cancelled", "ready_to_live"].includes(task.status) && (
            <Button size="sm" data-testid="task-ready-btn" variant="outline" onClick={handleReady} className="h-8">
              Ready to live
            </Button>
          )}
          {write && task.status !== "done" && (
            <Button size="sm" data-testid="task-complete-btn" variant="outline" onClick={handleComplete} className="h-8">
              Complete
            </Button>
          )}
          <button data-testid="back-tasks" onClick={() => navigate("/tasks")}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4" data-testid="task-detail-layout">
        <div className="xl:col-span-3 space-y-3">
          <div className="bg-white border border-slate-200 rounded-lg p-4" data-testid="task-header">
            <div className="font-mono text-xs text-[#0066CC]">{task.number}</div>
            {write ? (
              <Input
                className="mt-1 font-heading text-lg font-bold h-9"
                data-testid="task-title-edit"
                value={task.title}
                onChange={(e) => setTask({ ...task, title: e.target.value })}
                onBlur={handleTitleBlur}
              />
            ) : (
              <h2 className="font-heading text-lg font-bold text-slate-900 mt-0.5">{task.title}</h2>
            )}
            {task.project && (
              <div className="mt-2 text-xs">
                Project:{" "}
                <Link to={`/projects/${task.project.id}`} className="text-[#0066CC] font-medium">
                  {task.project.number} — {task.project.name}
                </Link>
              </div>
            )}
            {task.rejection_reason && (
              <div className="mt-2 text-xs font-medium text-red-700" data-testid="task-rejection-reason">
                Testing rejected: {task.rejection_reason}
              </div>
            )}
            {canSignOff && !["done", "cancelled", "testing_rejected"].includes(task.status) && (
              <div className="mt-2">
                <Label className="text-[10px]">Rejection reason</Label>
                <Input className="h-8 text-xs mt-1" data-testid="task-reject-reason" value={rejectReason}
                  placeholder="Why testing failed"
                  onChange={(e) => setRejectReason(e.target.value)} />
              </div>
            )}
            {overdue && (
              <div className="mt-2 text-xs font-semibold text-red-600" data-testid="task-overdue-badge">
                Overdue · due {fmtDate(task.due_date)}
              </div>
            )}
            {task.reminder_at && (
              <div className="mt-1 text-xs text-amber-700" data-testid="task-reminder-banner">
                Reminder: {fmtDateTime(task.reminder_at)}
              </div>
            )}

            <div className="mt-3">
              <Label className="text-[10px]">Description</Label>
              {write ? (
                <textarea
                  data-testid="task-desc-edit"
                  className="mt-1 w-full min-h-[80px] text-sm border border-slate-200 rounded-md p-2"
                  value={descEdit}
                  onChange={(e) => setDescEdit(e.target.value)}
                  onBlur={() => {
                    if (descEdit !== (task.description || "")) patch({ description: descEdit })
                  }}
                />
              ) : (
                <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap">{task.description || "No description"}</p>
              )}
            </div>

            {write ? (
              <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                <div>
                  <Label className="text-[10px]">Status</Label>
                  <Select value={task.status} onValueChange={(v) => {
                    if (v === "testing_rejected") {
                      handleReject()
                      return
                    }
                    patch({ status: v })
                  }}>
                    <SelectTrigger className="h-8 text-xs" data-testid="task-status"><SelectValue /></SelectTrigger>
                    <SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{taskStatusLabel(s)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Type</Label>
                  <Select value={task.task_type || task.category} onValueChange={(v) => patch({ task_type: v })}>
                    <SelectTrigger className="h-8 text-xs" data-testid="task-type-edit"><SelectValue /></SelectTrigger>
                    <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Priority</Label>
                  <Select value={task.priority} onValueChange={(v) => patch({ priority: v })}>
                    <SelectTrigger className="h-8 text-xs" data-testid="task-priority"><SelectValue /></SelectTrigger>
                    <SelectContent>{["low", "normal", "high", "urgent"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Assignee</Label>
                  <Select
                    value={task.assignee_id || "_none"}
                    onValueChange={(v) => patch({ assignee_id: v === "_none" ? null : v })}
                  >
                    <SelectTrigger className="h-8 text-xs" data-testid="task-assignee-edit"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Unassigned</SelectItem>
                      {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">BA</Label>
                  <Select
                    value={task.ba_id || "_none"}
                    onValueChange={(v) => patch({ ba_id: v === "_none" ? null : v })}
                  >
                    <SelectTrigger className="h-8 text-xs" data-testid="task-ba-edit"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Unassigned</SelectItem>
                      {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Due date</Label>
                  <Input type="date" className="h-8 text-xs" data-testid="task-due-edit"
                    value={task.due_date || ""} onChange={(e) => patch({ due_date: e.target.value || null })} />
                </div>
                <div>
                  <Label className="text-[10px]">Reminder</Label>
                  <div className="flex gap-1">
                    <Input type="datetime-local" className="h-8 text-xs" data-testid="task-reminder-edit"
                      value={reminderLocal} onChange={(e) => setReminderLocal(e.target.value)} />
                    <Button type="button" size="sm" className="h-8 shrink-0" onClick={saveReminder} data-testid="task-reminder-save">Set</Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-3 items-center text-xs">
                <StatusBadge value={task.status} />
                <span className="capitalize">{task.task_type}</span>
                <span className="uppercase text-slate-500">{task.priority}</span>
                <span>{task.assignee?.name || "Unassigned"}</span>
                <span>BA: {task.ba?.name || "—"}</span>
                <span className="font-mono">{fmtDate(task.due_date)}</span>
              </div>
            )}
            {(task.started_at || task.completed_at) && (
              <div className="mt-2 text-[11px] text-slate-500 font-mono">
                {task.started_at && <span>Started {fmtDateTime(task.started_at)} </span>}
                {task.completed_at && <span>· Completed {fmtDateTime(task.completed_at)}</span>}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3" data-testid="task-observers-panel">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Observers</div>
            {write ? (
              <div className="grid grid-cols-2 gap-1 max-h-32 overflow-y-auto">
                {users.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={(task.observer_ids || []).includes(u.id)}
                      onChange={() => toggleObserver(u.id)}
                      data-testid={`observer-${u.id}`}
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-600">
                {(task.observers || []).map((o) => o.name).join(", ") || "None"}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3" data-testid="task-checklist">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Checklist</div>
            <div className="space-y-1">
              {(task.checklist || []).map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!c.done} disabled={!write}
                    onChange={() => toggleCheck(c.id)} data-testid={`check-${c.id}`} />
                  <span className={c.done ? "line-through text-slate-400" : ""}>{c.text}</span>
                  {write && (
                    <button type="button" className="ml-auto text-slate-400 hover:text-red-600" onClick={() => removeCheck(c.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {!(task.checklist || []).length && <div className="text-xs text-slate-400">No checklist items</div>}
            </div>
            {write && (
              <form onSubmit={addCheckItem} className="mt-2 flex gap-2">
                <Input className="h-8 text-xs" data-testid="checklist-input" placeholder="Add item…"
                  value={checkText} onChange={(e) => setCheckText(e.target.value)} />
                <Button type="submit" size="sm" className="h-8" data-testid="checklist-add">Add</Button>
              </form>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3" data-testid="task-attachments">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2 flex items-center gap-1">
              <Paperclip className="w-3.5 h-3.5" /> Files
              <span className="normal-case tracking-normal font-medium text-slate-400">
                {(task.attachments || []).length} / {MAX_TASK_ATTACHMENTS}
              </span>
            </div>
            <ul className="space-y-1">
              {(task.attachments || []).map((f) => (
                <li key={f.id} className="flex items-center gap-2 text-xs">
                  <a
                    className="text-[#0066CC] hover:underline truncate"
                    href={`${API}/files/${f.storage_path}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {f.original_filename || f.id}
                  </a>
                  <button
                    type="button"
                    data-testid={`task-file-download-${f.id}`}
                    aria-label={`Download ${f.original_filename || "file"}`}
                    title="Download"
                    disabled={downloadingId === f.id}
                    onClick={() => handleDownloadFile(f)}
                    className="text-slate-500 hover:text-[#0066CC] disabled:opacity-50"
                  >
                    {downloadingId === f.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Download className="w-3.5 h-3.5" />}
                  </button>
                  {write && (
                    <button type="button" onClick={() => removeFile(f.id)} className="text-slate-400 hover:text-red-600" aria-label={`Remove ${f.original_filename || "file"}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              ))}
              {!(task.attachments || []).length && <li className="text-xs text-slate-400">No files</li>}
            </ul>
            {write && (
              <div className="mt-2">
                <FileDropzone
                  dropzoneTestId="task-file-dropzone"
                  inputTestId="task-file-input"
                  multiple
                  maxFiles={MAX_TASK_ATTACHMENTS}
                  already={(task.attachments || []).length}
                  busy={uploading}
                  onFiles={handleUploadFiles}
                />
              </div>
            )}
          </div>
        </div>

        <div className="xl:col-span-2">
          <WorkActivity entityType="task" entityId={id} refreshKey={activityRefresh} />
        </div>
      </div>
    </Layout>
  )
}
