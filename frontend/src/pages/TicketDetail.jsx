import React, { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import api, { apiError } from "../lib/api"
import { fmtDateTime } from "../lib/format"
import { MAX_TICKET_ATTACHMENTS, filterUploadFiles } from "../lib/uploadLimits"
import Layout, { StatusBadge } from "../components/Layout"
import FileDropzone, { FileChipList } from "../components/FileDropzone"
import TicketAttachmentList, { PriorityBadge } from "../components/tickets/TicketAttachmentViewer"
import { useAuth } from "../context/AuthContext"
import { Button } from "../components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"

function SlaHeader({ ticket }) {
  if (!ticket?.sla_due_at) return null
  const breached = ticket.sla_breached && !["resolved", "closed"].includes(ticket.status)
  const due = new Date(ticket.sla_due_at)
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
        breached
          ? "bg-red-50 text-red-700 border-red-200"
          : "bg-emerald-50 text-emerald-700 border-emerald-200"
      }`}
      data-testid="ticket-sla-badge"
    >
      {breached ? "SLA breached" : `SLA due ${fmtDateTime(ticket.sla_due_at)}`}
      {!breached && !Number.isNaN(due.getTime()) && (
        <span className="ml-1 opacity-70">({Math.max(0, Math.round((due - Date.now()) / 3600000))}h)</span>
      )}
    </span>
  )
}

export default function TicketDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { canCap } = useAuth()
  const canWrite = canCap("can_ticket_write")
  const [data, setData] = useState(null)
  const [meta, setMeta] = useState({ categories: [], assignees: [] })
  const [body, setBody] = useState("")
  const [visibility, setVisibility] = useState("public")
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const threadEndRef = useRef(null)

  const load = () =>
    api
      .get(`/tickets/${id}`)
      .then((r) => setData(r.data))
      .catch(() => toast.error("Ticket not found"))

  useEffect(() => {
    load()
    api.get("/tickets/meta").then((r) => setMeta(r.data || {})).catch(() => {})
  }, [id])

  const ticket = data?.ticket
  const messages = data?.messages || []

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages.length])

  const handlePatch = async (patch) => {
    try {
      await api.patch(`/tickets/${id}`, patch)
      toast.success("Updated")
      load()
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const handleQueueFiles = (incoming) => {
    if (!incoming?.length) return
    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_TICKET_ATTACHMENTS))
  }

  const handleRemoveQueued = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleReply = async (e) => {
    e.preventDefault()
    if (!body.trim() && !files.length) return
    if (files.length > MAX_TICKET_ATTACHMENTS) {
      toast.error(`Max ${MAX_TICKET_ATTACHMENTS} files`)
      return
    }
    const { rejected } = filterUploadFiles(files, { maxFiles: MAX_TICKET_ATTACHMENTS, already: 0 })
    if (rejected.length) {
      toast.error(rejected[0].reason)
      return
    }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append("body", body.trim())
      fd.append("visibility", visibility)
      files.forEach((f) => fd.append("files", f))
      await api.post(`/tickets/${id}/messages`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      toast.success(visibility === "internal" ? "Internal note added" : "Reply sent")
      setBody("")
      setFiles([])
      load()
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  if (!ticket) {
    return (
      <Layout title="Ticket">
        <div className="text-sm text-slate-500">Loading…</div>
      </Layout>
    )
  }

  return (
    <Layout
      title={ticket.number}
      actions={
        <button
          data-testid="back-to-tickets"
          onClick={() => navigate("/tickets")}
          className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
      }
    >
      <div className="flex flex-col gap-2 min-h-[calc(100dvh-8.5rem)] max-md:min-h-[calc(100dvh-11rem)]">
        <div className="bg-white border border-slate-200 rounded-lg p-3 shrink-0" data-testid="ticket-header">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="font-heading text-base font-bold text-slate-900">{ticket.subject}</h2>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                {ticket.customer_id ? (
                  <Link to={`/customers/${ticket.customer_id}`} className="text-[#0066CC] font-medium">
                    {ticket.customer_name}
                  </Link>
                ) : (
                  <span>{ticket.customer_name}</span>
                )}
                {ticket.crm_tenant_key && <span className="font-mono">Tenant: {ticket.crm_tenant_key}</span>}
                <span className="capitalize">Source: {ticket.source}</span>
                {ticket.requester_email && <span>{ticket.requester_email}</span>}
                <SlaHeader ticket={ticket} />
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <PriorityBadge value={ticket.priority} />
              <StatusBadge value={ticket.status} />
            </div>
          </div>

          {canWrite && (
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="ticket-actions">
              <Select value={ticket.status} onValueChange={(v) => handlePatch({ status: v })}>
                <SelectTrigger className="h-7 w-28 text-[11px]" data-testid="ticket-status-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={ticket.priority || "normal"} onValueChange={(v) => handlePatch({ priority: v })}>
                <SelectTrigger className="h-7 w-24 text-[11px]" data-testid="ticket-priority-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={ticket.category || "other"}
                onValueChange={(v) => handlePatch({ category: v })}
              >
                <SelectTrigger className="h-7 w-28 text-[11px]" data-testid="ticket-category-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(meta.categories || ["other"]).map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={ticket.assignee_id || "none"}
                onValueChange={(v) => handlePatch({ assignee_id: v === "none" ? "" : v })}
              >
                <SelectTrigger className="h-7 w-40 text-[11px]" data-testid="ticket-assignee-select">
                  <SelectValue placeholder="Assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {(meta.assignees || []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name || a.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!canWrite && (
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
              <span className="capitalize">Category: {ticket.category || "other"}</span>
              <span>Assignee: {ticket.assignee_name || "—"}</span>
            </div>
          )}
        </div>

        <div
          className="bg-white border border-slate-200 rounded-lg flex flex-col flex-1 min-h-[220px]"
          data-testid="ticket-thread"
        >
          <div className="px-3 py-1.5 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-500 font-semibold shrink-0">
            Conversation
            <span className="ml-1.5 normal-case tracking-normal font-normal text-slate-400">
              ({messages.length})
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 bg-slate-50/40">
            {messages.map((m) => {
              const isInternal = m.visibility === "internal"
              const isSupport = m.author_type === "support"
              const alignEnd = isSupport && !isInternal
              return (
                <div
                  key={m.id}
                  className={`flex ${alignEnd ? "justify-end" : "justify-start"}`}
                  data-testid={`ticket-msg-${m.id}`}
                  data-visibility={m.visibility || "public"}
                >
                  <div
                    className={`max-w-[min(100%,28rem)] rounded-lg px-2.5 py-1.5 border shadow-sm ${
                      isInternal
                        ? "bg-amber-50 border-amber-200 w-full max-w-full"
                        : isSupport
                          ? "bg-[#0F284E] border-[#0F284E] text-white"
                          : "bg-white border-slate-200"
                    }`}
                  >
                    <div
                      className={`flex flex-wrap items-center gap-1.5 text-[10px] mb-1 ${
                        isSupport && !isInternal ? "text-white/70" : "text-slate-500"
                      }`}
                    >
                      <span
                        className={`uppercase font-semibold tracking-wider px-1 py-0.5 rounded border ${
                          isInternal
                            ? "bg-amber-100 text-amber-800 border-amber-300"
                            : isSupport
                              ? "bg-white/15 text-white border-white/25"
                              : "bg-slate-50 text-slate-600 border-slate-200"
                        }`}
                      >
                        {isInternal ? "internal" : m.author_type}
                      </span>
                      <span className={`font-medium ${isSupport && !isInternal ? "text-white/90" : "text-slate-700"}`}>
                        {m.author_name}
                      </span>
                      <span className="font-mono">{fmtDateTime(m.created_at)}</span>
                    </div>
                    {m.body && m.body !== "(attachment)" && (
                      <div
                        className={`text-sm whitespace-pre-wrap ${
                          isSupport && !isInternal ? "text-white" : "text-slate-800"
                        }`}
                      >
                        {m.body}
                      </div>
                    )}
                    <TicketAttachmentList attachments={m.attachments} />
                  </div>
                </div>
              )
            })}
            <div ref={threadEndRef} />
          </div>
        </div>

        {canWrite && (
          <form
            onSubmit={handleReply}
            className="bg-white border border-slate-200 rounded-lg p-3 space-y-2 shrink-0 max-md:sticky max-md:bottom-0 max-md:z-20"
            data-testid="ticket-reply-form"
          >
            <FileDropzone
              dropzoneTestId="ticket-reply-dropzone"
              inputTestId="ticket-reply-files"
              multiple
              maxFiles={MAX_TICKET_ATTACHMENTS}
              already={files.length}
              disabled={busy}
              busy={busy}
              hint={`Drop, paste, or click (max ${MAX_TICKET_ATTACHMENTS} × 5MB)`}
              onFiles={handleQueueFiles}
              className="space-y-2"
            >
              <div className="flex gap-1" data-testid="reply-visibility-toggle">
                <button
                  type="button"
                  className={`h-7 px-2.5 rounded text-[11px] font-semibold border ${
                    visibility === "public"
                      ? "bg-[#0F284E] text-white border-[#0F284E]"
                      : "bg-white text-slate-600 border-slate-200"
                  }`}
                  onClick={() => setVisibility("public")}
                  data-testid="visibility-public"
                >
                  Public reply
                </button>
                <button
                  type="button"
                  className={`h-7 px-2.5 rounded text-[11px] font-semibold border ${
                    visibility === "internal"
                      ? "bg-amber-600 text-white border-amber-600"
                      : "bg-white text-slate-600 border-slate-200"
                  }`}
                  onClick={() => setVisibility("internal")}
                  data-testid="visibility-internal"
                >
                  Internal note
                </button>
              </div>
              <textarea
                className={`w-full border rounded-md px-2 py-1.5 text-sm min-h-[72px] ${
                  visibility === "internal" ? "bg-amber-50/50 border-amber-200" : ""
                }`}
                placeholder={visibility === "internal" ? "Internal note (Finance only)…" : "Write a support reply…"}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                data-testid="ticket-reply-body"
              />
              <FileChipList files={files} onRemove={handleRemoveQueued} disabled={busy} />
            </FileDropzone>
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={busy || (!body.trim() && !files.length)}
                className={visibility === "internal" ? "bg-amber-600 text-white" : "bg-[#0F284E] text-white"}
                data-testid="ticket-reply-submit"
              >
                {visibility === "internal" ? "Add note" : "Send reply"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Layout>
  )
}
