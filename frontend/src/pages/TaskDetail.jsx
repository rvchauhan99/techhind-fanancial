import React, { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Paperclip, Trash2 } from "lucide-react"
import { toast } from "sonner"
import api, { apiError, API } from "../lib/api"
import { fmtDate, fmtDateTime } from "../lib/format"
import Layout, { StatusBadge } from "../components/Layout"
import WorkActivity from "../components/WorkActivity"
import { useAuth } from "../context/AuthContext"
import { Label } from "../components/ui/label"
import { Input } from "../components/ui/input"
import { Button } from "../components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"

const STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"]
const TYPES = [
  "development", "uat", "testing", "customer_demo", "documentation",
  "training", "support_ops", "other",
]

export default function TaskDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { canCap } = useAuth()
  const [task, setTask] = useState(null)
  const [users, setUsers] = useState([])
  const [checkText, setCheckText] = useState("")
  const [descEdit, setDescEdit] = useState("")
  const [reminderLocal, setReminderLocal] = useState("")

  const load = () => {
    api.get(`/work/tasks/${id}`).then((r) => {
      setTask(r.data)
      setDescEdit(r.data.description || "")
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
      toast.success("Task updated")
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const handleStart = async () => {
    try {
      const { data } = await api.post(`/work/tasks/${id}/start`)
      setTask(data)
      toast.success("Task started")
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const handleComplete = async () => {
    try {
      const { data } = await api.post(`/work/tasks/${id}/complete`)
      setTask(data)
      toast.success("Task completed")
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const saveObservers = async (ids) => {
    try {
      const { data } = await api.put(`/work/tasks/${id}/observers`, { observer_ids: ids })
      setTask(data)
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

  const uploadFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append("file", file)
    try {
      const { data } = await api.post(`/work/tasks/${id}/attachments`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      setTask(data)
      toast.success("File attached")
    } catch (err) {
      toast.error(apiError(err))
    }
    e.target.value = ""
  }

  const removeFile = async (fid) => {
    try {
      const { data } = await api.delete(`/work/tasks/${id}/attachments/${fid}`)
      setTask(data)
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
      toast.success(reminder_at ? "Reminder set" : "Reminder cleared")
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  if (!task) {
    return <Layout title="Task"><div className="text-sm text-slate-500">Loading…</div></Layout>
  }

  const write = canCap("can_work_write")
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
                onBlur={() => patch({ title: task.title })}
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
                  <Select value={task.status} onValueChange={(v) => patch({ status: v })}>
                    <SelectTrigger className="h-8 text-xs" data-testid="task-status"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
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
                  {write && (
                    <button type="button" onClick={() => removeFile(f.id)} className="text-slate-400 hover:text-red-600">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              ))}
              {!(task.attachments || []).length && <li className="text-xs text-slate-400">No files</li>}
            </ul>
            {write && (
              <Input type="file" className="mt-2 h-8 text-xs" data-testid="task-file-input" onChange={uploadFile} />
            )}
          </div>
        </div>

        <div className="xl:col-span-2">
          <WorkActivity entityType="task" entityId={id} />
        </div>
      </div>
    </Layout>
  )
}
