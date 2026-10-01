import React, { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Plus, LayoutList, Columns3, CalendarClock } from "lucide-react"
import { toast } from "sonner"
import api, { apiError } from "../lib/api"
import { fmtDate, TASK_KANBAN, TASK_STATUSES, taskStatusLabel } from "../lib/format"
import Layout, { Empty, StatusBadge } from "../components/Layout"
import { PriorityBadge } from "../components/tickets/TicketAttachmentViewer"
import { useAuth } from "../context/AuthContext"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import { Switch } from "../components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import FilterBar, { FIELD } from "../components/filters/FilterBar"
import { useListFilters } from "../hooks/useListFilters"

const TYPES = [
  "development", "uat", "testing", "customer_demo", "documentation",
  "training", "support_ops", "other",
]

const emptyForm = (userId) => ({
  title: "",
  description: "",
  status: "todo",
  priority: "normal",
  task_type: "development",
  project_id: "",
  assignee_id: userId || "",
  ba_id: "",
  observer_ids: [],
  due_date: "",
  reminder_at: "",
  quick_testing: false,
})

const BASE_SCHEMA = [
  { key: "q", type: FIELD.TEXT, label: "Search", placeholder: "Title…", width: "w-36" },
  { key: "status", type: FIELD.SELECT, label: "Status", width: "w-32",
    options: TASK_STATUSES.map((s) => ({ value: s, label: taskStatusLabel(s) })) },
  { key: "priority", type: FIELD.SELECT, label: "Priority", width: "w-28",
    options: ["low", "normal", "high", "urgent"].map((s) => ({ value: s, label: s })) },
  { key: "task_type", type: FIELD.SELECT, label: "Type", width: "w-36",
    options: TYPES.map((t) => ({ value: t, label: t })) },
  { key: "mine", type: FIELD.TOGGLE, label: "Mine", placeholder: "Assigned to me" },
  { key: "overdue", type: FIELD.TOGGLE, label: "Overdue", placeholder: "Overdue" },
  { key: "project_id", type: FIELD.SELECT, label: "Project", width: "w-40", options: [] },
  { key: "assignee_id", type: FIELD.SELECT, label: "Assignee", width: "w-40", options: [] },
  { key: "dates", type: FIELD.DATE_RANGE, label: "Due", fromKey: "date_from", toKey: "date_to" },
]

export default function Tasks() {
  const { canCap, user } = useAuth()
  const isFreelancer = user?.role === "freelancer"
  const canCreate = canCap("can_work_write") && !isFreelancer
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [board, setBoard] = useState(null)
  const [deadline, setDeadline] = useState(null)
  const [open, setOpen] = useState(false)
  const [quickTesting, setQuickTesting] = useState(false)
  const [projects, setProjects] = useState([])
  const [users, setUsers] = useState([])
  const [form, setForm] = useState(() => emptyForm(user?.id))
  const { values, setFilter, setMany, clearFilters, activeCount, apiParams } = useListFilters(BASE_SCHEMA, {
    preserve: ["view"],
  })
  const view = values.view || "list"

  const schema = useMemo(() => {
    let fields = BASE_SCHEMA
    if (isFreelancer) {
      fields = BASE_SCHEMA.filter((f) => !["assignee_id", "mine", "project_id"].includes(f.key))
    }
    return fields.map((f) => {
      if (f.key === "project_id") return { ...f, options: projects.map((p) => ({ value: p.id, label: p.name || p.number })) }
      if (f.key === "assignee_id") return { ...f, options: users.map((u) => ({ value: u.id, label: u.name })) }
      return f
    })
  }, [projects, users, isFreelancer])

  const setView = (v) => setMany({ view: v })

  const load = () => {
    const common = { ...apiParams }
    delete common.view
    if (common.mine) common.mine = true
    if (common.overdue) common.overdue = true

    if (view === "kanban") {
      api.get("/work/tasks/board", { params: common })
        .then((r) => setBoard(r.data))
        .catch(() => setBoard({ columns: [] }))
      return
    }
    if (view === "deadline") {
      api.get("/work/tasks/deadline", { params: common })
        .then((r) => setDeadline(r.data))
        .catch(() => setDeadline({ buckets: [] }))
      return
    }
    api.get("/work/tasks", { params: common })
      .then((r) => setRows(r.data))
      .catch(() => setRows([]))
  }

  useEffect(() => { load() }, [view, apiParams]) // eslint-disable-line

  useEffect(() => {
    api.get("/work/projects").then((r) => setProjects(r.data || [])).catch(() => {})
    api.get("/users", { params: { active_only: true } }).then((r) => setUsers(r.data || [])).catch(() => {})
  }, [])

  const handleOpenCreate = (testing = false) => {
    setQuickTesting(testing)
    setForm({
      ...emptyForm(user?.id),
      quick_testing: testing,
      task_type: testing ? "testing" : "development",
      priority: testing ? "high" : "normal",
      assignee_id: user?.id || "",
    })
    setOpen(true)
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      const payload = {
        title: form.title,
        description: form.description,
        status: form.status,
        priority: form.priority,
        task_type: form.task_type,
        project_id: form.project_id || null,
        assignee_id: form.assignee_id || null,
        ba_id: form.ba_id || null,
        observer_ids: form.observer_ids || [],
        due_date: form.due_date || null,
        reminder_at: form.reminder_at ? new Date(form.reminder_at).toISOString() : null,
        quick_testing: form.quick_testing || quickTesting,
      }
      const { data } = await api.post("/work/tasks", payload)
      toast.success(`Task ${data.number} created`)
      setOpen(false)
      navigate(`/tasks/${data.id}`)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  const moveStatus = async (taskId, newStatus) => {
    try {
      if (newStatus === "testing_rejected") {
        const reason = window.prompt("Rejection reason")
        if (!reason || !reason.trim()) {
          toast.error("Rejection reason is required")
          load()
          return
        }
        await api.post(`/work/tasks/${taskId}/reject-testing`, { reason: reason.trim() })
      } else {
        await api.patch(`/work/tasks/${taskId}`, { status: newStatus })
      }
      toast.success("Status updated")
      load()
    } catch (err) {
      toast.error(apiError(err))
      load()
    }
  }

  const toggleObserver = (uid) => {
    setForm((f) => {
      const set = new Set(f.observer_ids || [])
      if (set.has(uid)) set.delete(uid)
      else set.add(uid)
      return { ...f, observer_ids: [...set] }
    })
  }

  const viewBtns = useMemo(() => [
    { key: "list", label: "List", icon: LayoutList },
    { key: "kanban", label: "Kanban", icon: Columns3 },
    { key: "deadline", label: "Deadline", icon: CalendarClock },
  ], [])

  return (
    <Layout
      title="My Work"
      actions={
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex border border-slate-200 rounded-md overflow-x-auto shrink-0" data-testid="tasks-view-switcher">
            {viewBtns.map((v) => (
              <button
                key={v.key}
                type="button"
                data-testid={`view-${v.key}`}
                onClick={() => setView(v.key)}
                className={`h-8 shrink-0 px-2.5 text-xs font-semibold flex items-center gap-1 ${
                  view === v.key ? "bg-[#0F284E] text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <v.icon className="w-3.5 h-3.5" />
                {v.label}
              </button>
            ))}
          </div>
          {canCreate && (
            <>
              <Button size="sm" data-testid="quick-testing-btn" variant="outline"
                onClick={() => handleOpenCreate(true)} className="h-8 text-xs">
                Quick testing
              </Button>
              <Button size="sm" data-testid="new-task-btn" onClick={() => handleOpenCreate(false)}
                className="bg-[#0F284E] hover:bg-[#17386D] text-white h-8">
                <Plus className="w-3.5 h-3.5 mr-1" /> New
              </Button>
            </>
          )}
        </div>
      }
    >
      <FilterBar schema={schema} values={values} setFilter={setFilter}
        clearFilters={clearFilters} activeCount={activeCount} testId="tasks-filters" />
      {view === "list" && (
        <div className="bg-white border border-slate-200 rounded-lg" data-testid="tasks-table">
          <table className="w-full text-sm pwa-table">
            <thead>
              <tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider">
                <th className="text-left px-3 py-2">Number</th>
                <th className="text-left px-3 py-2">Title</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Priority</th>
                <th className="text-left px-3 py-2">Project</th>
                <th className="text-left px-3 py-2">Assignee</th>
                <th className="text-left px-3 py-2">BA</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Due</th>
              </tr>
            </thead>
            <tbody>
              {(rows || []).map((t) => {
                const overdue = t.due_date && t.status !== "done" && t.status !== "cancelled"
                  && t.due_date < new Date().toISOString().slice(0, 10)
                return (
                  <tr key={t.id} data-testid={`task-row-${t.id}`}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => navigate(`/tasks/${t.id}`)}>
                    <td className="px-3 py-2 font-mono text-xs text-[#0066CC]" data-label="Number">{t.number}</td>
                    <td className="px-3 py-2 font-medium" data-label="Title">{t.title}</td>
                    <td className="px-3 py-2 text-xs capitalize" data-label="Type">{t.task_type || t.category}</td>
                    <td className="px-3 py-2" data-label="Priority"><PriorityBadge value={t.priority} /></td>
                    <td className="px-3 py-2 text-xs text-slate-600" data-label="Project">{t.project?.name || "—"}</td>
                    <td className="px-3 py-2 text-xs" data-label="Assignee">{t.assignee?.name || "—"}</td>
                    <td className="px-3 py-2 text-xs" data-label="BA">{t.ba?.name || "—"}</td>
                    <td className="px-3 py-2" data-label="Status"><StatusBadge value={t.status} /></td>
                    <td className={`px-3 py-2 font-mono text-[11px] ${overdue ? "text-red-600 font-semibold" : "text-slate-500"}`} data-label="Due">
                      {fmtDate(t.due_date)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows && !rows.length && <Empty label="No tasks" />}
        </div>
      )}

      {view === "kanban" && (
        <div className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory" data-testid="tasks-kanban">
          {(board?.columns || TASK_KANBAN.map((s) => ({ status: s, tasks: [] }))).map((col) => (
            <div key={col.status} className="w-56 shrink-0 snap-start bg-slate-50 border border-slate-200 rounded-lg" data-testid={`kanban-${col.status}`}>
              <div className="px-2.5 py-2 border-b border-slate-200 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">{taskStatusLabel(col.status)}</span>
                <span className="font-mono text-xs text-slate-500">{(col.tasks || []).length}</span>
              </div>
              <div className="p-1.5 space-y-1.5 max-h-[70vh] overflow-y-auto">
                {(col.tasks || []).map((t) => (
                  <div key={t.id}
                    className="bg-white border border-slate-200 rounded p-2 cursor-pointer hover:border-[#0066CC]/50"
                    data-testid={`kanban-card-${t.id}`}
                    onClick={() => navigate(`/tasks/${t.id}`)}
                  >
                    <div className="font-mono text-[10px] text-[#0066CC]">{t.number}</div>
                    <div className="text-xs font-medium text-slate-800 leading-snug mt-0.5">{t.title}</div>
                    <div className="mt-1.5 flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-[10px] capitalize text-slate-500">{t.task_type}</span>
                        <PriorityBadge value={t.priority} />
                      </div>
                      <span className="text-[10px] text-slate-500 truncate">{t.ba?.name || t.assignee?.name || "—"}</span>
                    </div>
                    {canCap("can_work_write") && (
                      <select
                        className="mt-1.5 w-full h-6 text-[10px] border border-slate-200 rounded"
                        value={t.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => moveStatus(t.id, e.target.value)}
                        data-testid={`kanban-move-${t.id}`}
                      >
                        {TASK_KANBAN.map((s) => <option key={s} value={s}>{taskStatusLabel(s)}</option>)}
                      </select>
                    )}
                  </div>
                ))}
                {!(col.tasks || []).length && <div className="text-[11px] text-slate-400 px-1 py-3 text-center">Empty</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === "deadline" && (
        <div className="space-y-3" data-testid="tasks-deadline">
          {(deadline?.buckets || []).map((b) => (
            <div key={b.key} className="bg-white border border-slate-200 rounded-lg" data-testid={`deadline-${b.key}`}>
              <div className="px-3 py-2 border-b border-slate-200 text-sm font-semibold flex justify-between">
                <span className="capitalize">{b.key.replace("_", " ")}</span>
                <span className="font-mono text-xs text-slate-500">{(b.tasks || []).length}</span>
              </div>
              <table className="w-full text-sm pwa-table">
                <tbody>
                  {(b.tasks || []).map((t) => (
                    <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                      onClick={() => navigate(`/tasks/${t.id}`)}>
                      <td className="px-3 py-1.5 font-mono text-xs text-[#0066CC] w-36">{t.number}</td>
                      <td className="px-3 py-1.5">{t.title}</td>
                      <td className="px-3 py-1.5"><PriorityBadge value={t.priority} /></td>
                      <td className="px-3 py-1.5"><StatusBadge value={t.status} /></td>
                      <td className="px-3 py-1.5 text-xs">{t.assignee?.name || "—"}</td>
                      <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">{fmtDate(t.due_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!(b.tasks || []).length && <Empty label="No tasks" />}
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg bg-white max-h-[90vh] overflow-y-auto" data-testid="task-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {form.quick_testing || quickTesting ? "Quick testing task" : "New Task"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-2.5">
            {canCap("can_work_write") && (
              <div className="flex items-center justify-between border border-slate-100 rounded px-2 py-1.5">
                <Label className="text-xs">Quick testing task</Label>
                <Switch
                  data-testid="quick-testing-toggle"
                  checked={form.quick_testing || quickTesting}
                  onCheckedChange={(v) => {
                    setQuickTesting(v)
                    setForm((f) => ({
                      ...f,
                      quick_testing: v,
                      task_type: v ? "testing" : f.task_type === "testing" ? "development" : f.task_type,
                      priority: v ? "high" : f.priority,
                    }))
                  }}
                />
              </div>
            )}
            <div><Label>Title *</Label>
              <Input required data-testid="task-title-input" value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label>Description</Label>
              <Input data-testid="task-desc-input" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><Label>Type</Label>
                <Select value={form.task_type} onValueChange={(v) => setForm({ ...form, task_type: v })}>
                  <SelectTrigger className="h-9" data-testid="task-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{["low", "normal", "high", "urgent"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select></div>
            </div>
            <div><Label>Project</Label>
              <Select value={form.project_id || "_none"} onValueChange={(v) => setForm({ ...form, project_id: v === "_none" ? "" : v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.number} — {p.name}</SelectItem>)}
                </SelectContent>
              </Select></div>
            <div><Label>Assignee</Label>
              <Select value={form.assignee_id || "_none"} onValueChange={(v) => setForm({ ...form, assignee_id: v === "_none" ? "" : v })}>
                <SelectTrigger className="h-9" data-testid="task-assignee-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Unassigned</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>)}
                </SelectContent>
              </Select></div>
            <div><Label>BA</Label>
              <Select value={form.ba_id || "_none"} onValueChange={(v) => setForm({ ...form, ba_id: v === "_none" ? "" : v })}>
                <SelectTrigger className="h-9" data-testid="task-ba-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Unassigned</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>)}
                </SelectContent>
              </Select></div>
            <div>
              <Label>Observers</Label>
              <div className="mt-1 max-h-28 overflow-y-auto border border-slate-200 rounded p-2 space-y-1" data-testid="task-observers">
                {users.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={(form.observer_ids || []).includes(u.id)}
                      onChange={() => toggleObserver(u.id)}
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><Label>Due date</Label>
                <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
              <div><Label>Reminder</Label>
                <Input type="datetime-local" data-testid="task-reminder"
                  value={form.reminder_at} onChange={(e) => setForm({ ...form, reminder_at: e.target.value })} /></div>
            </div>
            <Button type="submit" data-testid="task-save" className="w-full bg-[#0F284E] hover:bg-[#17386D] text-white">Create</Button>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  )
}
