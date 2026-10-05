import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Paperclip } from "lucide-react"
import api, { apiError } from "../lib/api"
import { fmtDateTime, taskStatusLabel } from "../lib/format"
import {
  collectClipboardFiles,
  filterUploadFiles,
  MAX_COMMENT_ATTACHMENTS,
  nameClipboardFile,
  UPLOAD_ACCEPT,
} from "../lib/uploadLimits"
import { useAuth } from "../context/AuthContext"
import { Empty } from "./Layout"
import { FileChipList } from "./FileDropzone"
import TicketAttachmentList from "./tickets/TicketAttachmentViewer"
import { Button } from "./ui/button"
import { toast } from "sonner"

const SYSTEM_ACTIONS = new Set([
  "task_created", "task_updated", "task_assigned", "task_started", "task_completed",
  "status_changed", "assignee_changed", "observer_added", "observer_removed",
  "checklist_updated", "attachment_added", "attachment_removed",
  "reminder_set", "reminder_cleared", "project_created", "project_updated",
  "testing_rejected", "ready_to_live", "ba_changed",
])

const DIFF_LABELS = {
  title: "Title",
  description: "Description",
  status: "Status",
  priority: "Priority",
  task_type: "Type",
  category: "Type",
  project_id: "Project",
  assignee_id: "Assignee",
  ba_id: "BA",
  observer_ids: "Observers",
  due_date: "Due date",
  start_date: "Start date",
  tags: "Tags",
  reminder_at: "Reminder",
  rejection_reason: "Rejection reason",
  checklist: "Checklist",
}

const clipText = (value) => {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  if (!text) return "—"
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

const personName = (id, users, empty = "Unassigned") => {
  if (!id) return empty
  const match = (users || []).find((user) => user.id === id)
  return match?.name || "Unknown"
}

const titleCaseType = (value) => String(value).replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())

const formatDiffValue = (key, value, users) => {
  if (key === "status") return value ? taskStatusLabel(value) : "—"
  if (key === "task_type" || key === "category") return value ? titleCaseType(value) : "—"
  if (key === "priority") return value ? String(value) : "—"
  if (key === "assignee_id" || key === "ba_id") return personName(value, users)
  if (key === "observer_ids") {
    const ids = Array.isArray(value) ? value : []
    if (!ids.length) return "—"
    return ids.map((id) => personName(id, users, "Unknown")).join(", ")
  }
  if (key === "tags") {
    const tags = Array.isArray(value) ? value.filter(Boolean) : []
    return tags.length ? tags.join(", ") : "—"
  }
  if (key === "description" || key === "rejection_reason" || key === "title") return clipText(value)
  if (value == null || value === "") return "—"
  if (Array.isArray(value)) {
    const parts = value.map((item) => (typeof item === "string" ? item : "")).filter(Boolean)
    return parts.length ? parts.join(", ") : "—"
  }
  if (typeof value === "object") return "—"
  return clipText(value)
}

const checklistLine = (change) => {
  const bits = []
  if (change.added?.length) bits.push(`Added: ${change.added.join(", ")}`)
  if (change.removed?.length) bits.push(`Removed: ${change.removed.join(", ")}`)
  if (change.checked?.length) bits.push(`Checked: ${change.checked.join(", ")}`)
  if (change.unchecked?.length) bits.push(`Unchecked: ${change.unchecked.join(", ")}`)
  if (change.renamed?.length) bits.push(`Renamed: ${change.renamed.join("; ")}`)
  return bits.length ? `Checklist: ${bits.join(" · ")}` : ""
}

const diffLines = (diff, users) => {
  if (!diff || typeof diff !== "object") return []
  return Object.keys(diff).flatMap((key) => {
    if (key === "attachment_id" || key === "checklist_count") return []
    if (key === "category" && diff.task_type) return []
    const change = diff[key] || {}
    if (key === "checklist") {
      const special = checklistLine(change)
      if (special) return [special]
    }
    const label = DIFF_LABELS[key] || key
    return [`${label}: ${formatDiffValue(key, change.old, users)} → ${formatDiffValue(key, change.new, users)}`]
  })
}

const activityDisplayLines = (row, users) => {
  const summaryLines = String(row.summary || "").split("\n").map((line) => line.trim()).filter(Boolean)
  const summaryIsFields = summaryLines.some((line) => line.includes(":") && line.includes("→"))
  if (summaryIsFields) return summaryLines
  const fromDiff = diffLines(row.diff, users)
  if (fromDiff.length) return fromDiff
  if (summaryLines.length) return summaryLines
  return [row.action || "Updated"]
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const CommentBody = ({ text, mentions }) => {
  const names = (mentions || []).map((m) => m.name).filter(Boolean).sort((a, b) => b.length - a.length)
  if (!text || !names.length) return text || ""
  const pattern = new RegExp(`@(${names.map(escapeRegExp).join("|")})`, "gi")
  const parts = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) parts.push(text.slice(last, index))
    parts.push(
      <span key={`${index}-${match[1]}`} className="font-semibold text-[#0F284E]">
        @{match[1]}
      </span>
    )
    last = index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

const mentionTrigger = (value, caret) => {
  const upto = value.slice(0, caret)
  const at = upto.lastIndexOf("@")
  if (at < 0) return null
  if (at > 0 && /[A-Za-z0-9]/.test(upto[at - 1])) return null
  const frag = upto.slice(at + 1)
  if (frag.includes("\n")) return null
  return { at, frag }
}

/**
 * Chat-style activity feed for project/task with polling.
 */
export default function WorkActivity({ entityType, entityId, canComment, pollMs = 20000, refreshKey = 0 }) {
  const { canCap } = useAuth()
  const [rows, setRows] = useState(null)
  const [body, setBody] = useState("")
  const [users, setUsers] = useState([])
  const [usersReady, setUsersReady] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState("")
  const [mentionAt, setMentionAt] = useState(0)
  const [mentionIds, setMentionIds] = useState([])
  const [highlight, setHighlight] = useState(0)
  const [menuPos, setMenuPos] = useState(null)
  const [files, setFiles] = useState([])
  const [sending, setSending] = useState(false)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const listRef = useRef(null)
  const feedRef = useRef(null)
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
    api.get("/users", { params: { active_only: true } })
      .then((r) => setUsers(Array.isArray(r.data) ? r.data : []))
      .catch(() => setUsers([]))
      .finally(() => setUsersReady(true))
  }, [])

  useEffect(() => {
    if (!entityType || !entityId) {
      setRows([])
      return undefined
    }
    api.post("/notifications/seen", { entity_type: entityType, entity_id: entityId })
      .catch(() => {})
      .finally(load)
    if (!pollMs) return undefined
    const t = setInterval(load, pollMs)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, pollMs, refreshKey])

  const mentionMatches = users.filter((user) => {
    const name = (user.name || "").toLowerCase()
    const email = (user.email || "").toLowerCase()
    const query = mentionQuery.trim().toLowerCase()
    if (!name && !email) return false
    if (!query) return true
    return name.includes(query) || email.includes(query)
  }).slice(0, 8)

  useEffect(() => {
    setHighlight(0)
  }, [mentionQuery, mentionOpen])

  const updateMenuPos = () => {
    const el = inputRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setMenuPos({
      left: Math.max(8, rect.left),
      width: Math.max(rect.width, 220),
      bottom: Math.max(8, window.innerHeight - rect.top + 4),
    })
  }

  useLayoutEffect(() => {
    const el = feedRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [rows])

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [body])

  useLayoutEffect(() => {
    if (!mentionOpen) {
      setMenuPos(null)
      return undefined
    }
    updateMenuPos()
    const onMove = () => updateMenuPos()
    window.addEventListener("resize", onMove)
    window.addEventListener("scroll", onMove, true)
    return () => {
      window.removeEventListener("resize", onMove)
      window.removeEventListener("scroll", onMove, true)
    }
  }, [mentionOpen, body])

  useEffect(() => {
    if (!mentionOpen) return undefined
    const onDown = (e) => {
      if (listRef.current?.contains(e.target) || inputRef.current?.contains(e.target)) return
      setMentionOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [mentionOpen])

  const syncMention = (value, caret) => {
    const hit = mentionTrigger(value, caret)
    if (!hit) {
      setMentionOpen(false)
      return
    }
    setMentionAt(hit.at)
    setMentionQuery(hit.frag)
    setMentionOpen(true)
  }

  const handlePick = (user) => {
    if (!user) return
    const name = user.name || user.email || ""
    const before = body.slice(0, mentionAt)
    const after = body.slice(mentionAt + 1 + mentionQuery.length)
    const next = `${before}@${name} ${after.replace(/^\s+/, "")}`
    setBody(next)
    if (user.id) {
      setMentionIds((ids) => (ids.includes(user.id) ? ids : [...ids, user.id]))
    }
    setMentionOpen(false)
    setMentionQuery("")
    const pos = before.length + name.length + 2
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(pos, pos)
    })
  }

  const handleAt = () => {
    const el = inputRef.current
    const caret = el?.selectionStart ?? body.length
    const prefix = body.slice(0, caret)
    const needSpace = prefix.length > 0 && !/\s$/.test(prefix)
    const insert = `${needSpace ? " " : ""}@`
    const next = `${prefix}${insert}${body.slice(caret)}`
    const at = prefix.length + (needSpace ? 1 : 0)
    setBody(next)
    setMentionAt(at)
    setMentionQuery("")
    setMentionOpen(true)
    const pos = at + 1
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  const queueFiles = (incoming) => {
    const { accepted, rejected } = filterUploadFiles(incoming, {
      maxFiles: MAX_COMMENT_ATTACHMENTS,
      already: files.length,
    })
    rejected.forEach((row) => toast.error(row.reason))
    if (accepted.length) setFiles((prev) => [...prev, ...accepted])
  }

  const handlePaste = (e) => {
    const pasted = collectClipboardFiles(e.clipboardData).map(nameClipboardFile)
    if (!pasted.length) return
    e.preventDefault()
    const text = e.clipboardData?.getData("text/plain") || ""
    if (text) {
      const el = e.currentTarget
      const start = el.selectionStart ?? body.length
      const end = el.selectionEnd ?? body.length
      const next = `${body.slice(0, start)}${text}${body.slice(end)}`
      const pos = start + text.length
      setBody(next)
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(pos, pos)
        syncMention(next, pos)
      })
    }
    queueFiles(pasted)
  }

  const handlePickFiles = (e) => {
    queueFiles(Array.from(e.target.files || []))
    e.target.value = ""
  }

  const handleRemoveFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleKeyDown = (e) => {
    if (!mentionOpen) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        e.currentTarget.form?.requestSubmit()
      }
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      setMentionOpen(false)
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHighlight((i) => Math.min(i + 1, Math.max(mentionMatches.length - 1, 0)))
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setHighlight((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === "Enter" || e.key === "Tab") {
      if (mentionMatches[highlight]) {
        e.preventDefault()
        handlePick(mentionMatches[highlight])
      } else {
        e.preventDefault()
      }
    }
  }

  const idsStillInBody = (text) => mentionIds.filter((id) => {
    const user = users.find((u) => u.id === id)
    const token = (user?.name || user?.email || "").toLowerCase()
    if (!token) return false
    return text.toLowerCase().includes(`@${token}`)
  })

  const handleComment = async (e) => {
    e.preventDefault()
    const text = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
    if ((!text && !files.length) || sending) return
    const path = entityType === "project"
      ? `/work/projects/${entityId}/comments`
      : `/work/tasks/${entityId}/comments`
    setSending(true)
    try {
      if (files.length) {
        const fd = new FormData()
        fd.append("body", text)
        fd.append("mention_ids", JSON.stringify(idsStillInBody(text)))
        files.forEach((file) => fd.append("files", file))
        await api.post(path, fd)
      } else {
        await api.post(path, { body: text, mention_ids: idsStillInBody(text) })
      }
      setBody("")
      setFiles([])
      setMentionIds([])
      setMentionOpen(false)
      toast.success("Comment posted")
      load()
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSending(false)
    }
  }

  const mentionMenu = mentionOpen && menuPos && typeof document !== "undefined"
    ? createPortal(
      <div
        ref={listRef}
        data-testid="work-mention-list"
        role="listbox"
        aria-label="Mention a colleague"
        className="fixed max-h-40 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-md z-50"
        style={{ left: menuPos.left, width: menuPos.width, bottom: menuPos.bottom }}
      >
        {!usersReady && (
          <div className="px-2.5 py-1.5 text-[11px] text-slate-400">Loading people…</div>
        )}
        {usersReady && mentionMatches.length === 0 && (
          <div className="px-2.5 py-1.5 text-[11px] text-slate-400">No users match</div>
        )}
        {mentionMatches.map((user, idx) => (
          <button
            key={user.id}
            type="button"
            role="option"
            aria-selected={idx === highlight}
            data-testid="work-mention-option"
            className={`w-full text-left px-2.5 py-1.5 text-xs ${idx === highlight ? "bg-slate-100" : "hover:bg-slate-50"}`}
            onMouseEnter={() => setHighlight(idx)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              handlePick(user)
            }}
          >
            <span className="font-medium text-slate-800">{user.name}</span>
            {user.email ? <span className="ml-2 text-[10px] text-slate-400">{user.email}</span> : null}
            <span className="ml-2 text-[10px] uppercase text-slate-400">{user.role}</span>
          </button>
        ))}
      </div>,
      document.body,
    )
    : null

  return (
    <div className="bg-white border border-slate-200 rounded-lg flex flex-col h-full min-h-[320px]" data-testid="work-activity-panel">
      <div className="px-3 py-2 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-500 font-semibold shrink-0">
        Activity / Chat
      </div>
      <div ref={feedRef} className="flex-1 overflow-y-auto p-3 space-y-2 max-h-[55vh]" data-testid="activity-feed">
        {(rows || []).map((r) => {
          const isComment = r.action === "comment"
          const isSystem = SYSTEM_ACTIONS.has(r.action) && !isComment
          if (isSystem) {
            const lines = activityDisplayLines(r, users)
            const note = r.comment && !lines.some((line) => line.includes(r.comment)) ? r.comment : ""
            return (
              <div key={r.id} className="text-center text-[11px] text-slate-500 py-1" data-testid={`activity-sys-${r.id}`}>
                <div>
                  <span className="font-medium text-slate-600">{r.user_name}</span>
                  {" · "}
                  <span className="font-mono text-[10px] text-slate-400">{fmtDateTime(r.ts)}</span>
                </div>
                {lines.map((line, index) => (
                  <div key={`${r.id}-${index}`} data-testid="activity-change-line">{line}</div>
                ))}
                {note ? <div className="mt-0.5 whitespace-pre-wrap">{note}</div> : null}
              </div>
            )
          }
          const mentioned = (r.mentions || []).map((m) => m.name).filter(Boolean)
          const seen = (r.seen_by || []).map((m) => m.name).filter(Boolean)
          const commentText = r.comment || r.summary
          const showText = commentText && commentText !== "(attachment)"
          return (
            <div key={r.id} className="flex flex-col gap-0.5" data-testid={`activity-msg-${r.id}`}>
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-slate-800">{r.user_name}</span>
                <span className="font-mono text-[10px] text-slate-400">{fmtDateTime(r.ts)}</span>
              </div>
              <div className="text-sm text-slate-700 bg-slate-50 border border-slate-100 rounded-md px-2.5 py-1.5 whitespace-pre-wrap">
                {showText ? <CommentBody text={commentText} mentions={r.mentions} /> : null}
                {isComment && (r.attachments || []).length > 0 ? (
                  <TicketAttachmentList attachments={r.attachments} />
                ) : null}
              </div>
              {isComment && mentioned.length > 0 && (
                <div className="text-[10px] text-slate-500 px-0.5" data-testid={`mention-to-${r.id}`}>
                  To {mentioned.join(", ")}
                  {seen.length > 0 && (
                    <span data-testid={`mention-seen-${r.id}`}> · Seen by {seen.join(", ")}</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {rows && !rows.length && <Empty label="No activity yet" />}
      </div>
      {write && (
        <form onSubmit={handleComment} className="px-3 py-2 border-t border-slate-100 flex flex-col gap-1 shrink-0">
          <FileChipList files={files} onRemove={handleRemoveFile} disabled={sending} />
          <div className="flex gap-2 items-end">
            <button
              type="button"
              data-testid="work-mention-button"
              aria-label="Mention a user"
              onClick={handleAt}
              className="h-8 w-8 shrink-0 rounded-md border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              @
            </button>
            <button
              type="button"
              data-testid="work-comment-attach"
              aria-label="Attach a file"
              disabled={sending || files.length >= MAX_COMMENT_ATTACHMENTS}
              onClick={() => fileRef.current?.click()}
              className="h-8 w-8 shrink-0 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <Paperclip className="w-3.5 h-3.5 mx-auto" />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={UPLOAD_ACCEPT}
              className="hidden"
              data-testid="work-comment-file-input"
              onChange={handlePickFiles}
            />
            <textarea
              ref={inputRef}
              data-testid="work-comment-input"
              rows={1}
              className="min-h-8 max-h-[7.5rem] w-full resize-none overflow-y-auto rounded-md border border-slate-200 bg-transparent px-2 py-1.5 text-xs leading-4 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
              placeholder="Write a comment… use @Name to mention"
              value={body}
              disabled={sending}
              aria-autocomplete="list"
              aria-expanded={mentionOpen}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onChange={(e) => {
                setBody(e.target.value)
                syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
              }}
            />
            <Button
              data-testid="work-comment-submit"
              type="submit"
              size="sm"
              disabled={sending || (!body.trim() && !files.length)}
              className="h-8 bg-[#0F284E] hover:bg-[#17386D] text-white shrink-0"
            >
              Send
            </Button>
          </div>
          {mentionMenu}
        </form>
      )}
    </div>
  )
}
