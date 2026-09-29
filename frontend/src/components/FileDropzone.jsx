import React, { useRef, useState } from "react"
import { Paperclip, X } from "lucide-react"
import { toast } from "sonner"
import {
  collectDroppedFiles,
  filterUploadFiles,
  formatBytes,
  MAX_UPLOAD_BYTES,
  UPLOAD_ACCEPT,
} from "../lib/uploadLimits"

export const FileChipList = ({ files, onRemove, disabled }) => {
  if (!files?.length) return null
  return (
    <ul className="flex flex-wrap gap-1" data-testid="file-chip-list">
      {files.map((file, index) => (
        <li
          key={`${file.name}-${file.size}-${index}`}
          className="inline-flex items-center gap-1 max-w-full text-[11px] border border-slate-200 rounded px-1.5 py-0.5 bg-slate-50"
        >
          <Paperclip className="w-3 h-3 shrink-0 text-slate-400" />
          <span className="truncate max-w-[140px]">{file.name}</span>
          <span className="text-slate-400 shrink-0">{formatBytes(file.size)}</span>
          {onRemove && !disabled && (
            <button
              type="button"
              aria-label={`Remove ${file.name}`}
              data-testid={`file-chip-remove-${index}`}
              className="text-slate-400 hover:text-red-600"
              onClick={() => onRemove(index)}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export default function FileDropzone({
  onFiles,
  disabled = false,
  busy = false,
  multiple = true,
  maxFiles,
  already = 0,
  maxBytes = MAX_UPLOAD_BYTES,
  inputTestId,
  dropzoneTestId,
  hint,
  children,
  className = "",
}) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)
  const remaining = maxFiles == null ? Infinity : Math.max(0, maxFiles - already)
  const blocked = disabled || busy || remaining <= 0
  const wrapped = Boolean(children)

  const handleIncoming = (list) => {
    if (blocked) return
    const { accepted, rejected } = filterUploadFiles(list, { maxFiles, maxBytes, already })
    rejected.forEach((row) => toast.error(row.reason))
    if (accepted.length) onFiles(accepted)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    if (blocked) return
    handleIncoming(collectDroppedFiles(e.dataTransfer))
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (blocked) return
    e.dataTransfer.dropEffect = "copy"
    setOver(true)
  }

  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return
    setOver(false)
  }

  const handlePaste = (e) => {
    if (blocked) return
    const pasted = Array.from(e.clipboardData?.files || [])
    if (!pasted.length) return
    e.preventDefault()
    handleIncoming(pasted)
  }

  const handleChange = (e) => {
    handleIncoming(Array.from(e.target.files || []))
    e.target.value = ""
  }

  const handleOpenPicker = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (blocked) return
    inputRef.current?.click()
  }

  const handleKeyDown = (e) => {
    if (blocked) return
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      inputRef.current?.click()
    }
  }

  const defaultHint = remaining <= 0
    ? "Attachment limit reached"
    : multiple
      ? "Drop files, paste, or click to attach"
      : "Drop a file, paste, or click to attach"

  const label = hint || defaultHint
  const boxClass = over
    ? "border-[#0066CC] bg-blue-50 text-[#0066CC]"
    : blocked
      ? "border-slate-200 bg-slate-50 text-slate-400"
      : "border-slate-300 bg-slate-50/60 text-slate-500 hover:border-slate-400"

  const picker = (
    <input
      ref={inputRef}
      type="file"
      multiple={multiple}
      accept={UPLOAD_ACCEPT}
      className="hidden"
      disabled={blocked}
      data-testid={inputTestId}
      onChange={handleChange}
      onClick={(e) => e.stopPropagation()}
    />
  )

  const trigger = (
    <button
      type="button"
      disabled={blocked}
      onClick={handleOpenPicker}
      onKeyDown={handleKeyDown}
      aria-label={label}
      className={`w-full rounded-md border border-dashed px-2 py-1.5 text-[11px] ${boxClass} ${
        blocked ? "cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <span className="flex items-center justify-center gap-1">
        <Paperclip className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </span>
    </button>
  )

  return (
    <div
      data-testid={dropzoneTestId}
      aria-disabled={blocked}
      aria-busy={busy}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onPaste={handlePaste}
      className={`relative ${wrapped ? className : ""} ${over && wrapped ? "ring-1 ring-[#0066CC] rounded-md" : ""}`}
    >
      {wrapped ? children : null}
      {wrapped ? <div className="mt-2">{trigger}</div> : trigger}
      {picker}
      {busy && (
        <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-[11px] font-medium text-slate-600 rounded-md">
          Uploading…
        </div>
      )}
    </div>
  )
}
