import React, { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Paperclip } from "lucide-react"
import { toast } from "sonner"
import api, { apiError } from "../lib/api"
import { fmtDateTime } from "../lib/format"
import Layout, { StatusBadge } from "../components/Layout"
import { useAuth } from "../context/AuthContext"
import { Button } from "../components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"

const MAX_FILES = 5
const MAX_BYTES = 5 * 1024 * 1024

export default function TicketDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [data, setData] = useState(null)
  const [body, setBody] = useState("")
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .get(`/tickets/${id}`)
      .then((r) => setData(r.data))
      .catch(() => toast.error("Ticket not found"))
  }, [id])

  const load = () =>
    api
      .get(`/tickets/${id}`)
      .then((r) => setData(r.data))
      .catch(() => toast.error("Ticket not found"))

  const ticket = data?.ticket
  const messages = data?.messages || []

  const handleStatus = async (status) => {
    try {
      await api.patch(`/tickets/${id}`, { status })
      toast.success(`Status → ${status}`)
      load()
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const handleReply = async (e) => {
    e.preventDefault()
    if (!body.trim()) return
    if (files.length > MAX_FILES) {
      toast.error(`Max ${MAX_FILES} files`)
      return
    }
    for (const f of files) {
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} exceeds 5 MB`)
        return
      }
    }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append("body", body.trim())
      files.forEach((f) => fd.append("files", f))
      await api.post(`/tickets/${id}/messages`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      toast.success("Reply sent")
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
      <div className="bg-white border border-slate-200 rounded-lg p-4" data-testid="ticket-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-bold text-slate-900">{ticket.subject}</h2>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>{ticket.customer_name}</span>
              {ticket.crm_tenant_key && <span className="font-mono">Tenant: {ticket.crm_tenant_key}</span>}
              <span className="capitalize">Source: {ticket.source}</span>
              <span className="capitalize">Priority: {ticket.priority}</span>
              {ticket.requester_email && <span>{ticket.requester_email}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge value={ticket.status} />
            {can("admin", "accountant", "ops") && (
              <Select value={ticket.status} onValueChange={handleStatus}>
                <SelectTrigger className="h-8 w-32 text-xs" data-testid="ticket-status-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg" data-testid="ticket-thread">
        <div className="px-3 py-2 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
          Conversation
        </div>
        <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
          {messages.map((m) => (
            <div key={m.id} className="px-3 py-2.5" data-testid={`ticket-msg-${m.id}`}>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 mb-1">
                <span
                  className={`uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded border ${
                    m.author_type === "support"
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : "bg-slate-50 text-slate-600 border-slate-200"
                  }`}
                >
                  {m.author_type}
                </span>
                <span className="font-medium text-slate-700">{m.author_name}</span>
                <span className="font-mono">{fmtDateTime(m.created_at)}</span>
              </div>
              <div className="text-sm text-slate-800 whitespace-pre-wrap">{m.body}</div>
              {(m.attachments || []).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {m.attachments.map((a) => (
                    <a
                      key={a.file_id}
                      href={`/api/files/${a.storage_path}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-[#0066CC] border border-slate-200 rounded px-1.5 py-0.5"
                    >
                      <Paperclip className="w-3 h-3" />
                      {a.name}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {can("admin", "accountant", "ops") && (
        <form
          onSubmit={handleReply}
          className="bg-white border border-slate-200 rounded-lg p-3 space-y-2"
          data-testid="ticket-reply-form"
        >
          <textarea
            className="w-full border rounded-md px-2 py-1.5 text-sm min-h-[72px]"
            placeholder="Write a support reply…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            data-testid="ticket-reply-body"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs text-slate-500 flex items-center gap-1.5 cursor-pointer">
              <Paperclip className="w-3.5 h-3.5" />
              <span>Attach (max 5 × 5MB)</span>
              <input
                type="file"
                multiple
                className="hidden"
                data-testid="ticket-reply-files"
                onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, MAX_FILES))}
              />
              {files.length > 0 && <span className="text-slate-700">{files.length} file(s)</span>}
            </label>
            <Button
              type="submit"
              size="sm"
              disabled={busy || !body.trim()}
              className="bg-[#0F284E] text-white"
              data-testid="ticket-reply-submit"
            >
              Send reply
            </Button>
          </div>
        </form>
      )}
    </Layout>
  )
}
