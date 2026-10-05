export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
export const MAX_TASK_ATTACHMENTS = 10
export const MAX_TICKET_ATTACHMENTS = 5
export const MAX_COMMENT_ATTACHMENTS = 5

export const ALLOWED_UPLOAD_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/markdown",
  "text/x-markdown",
]

export const UPLOAD_ACCEPT = [...ALLOWED_UPLOAD_MIME, ".md", ".markdown"].join(",")

const EXT_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  md: "text/markdown",
  markdown: "text/markdown",
}

const GENERIC_DECLARED_MIME = ["", "text/plain", "application/octet-stream", "text/x-markdown"]

export const mimeOf = (file) => {
  const declared = String(file?.type || "").split(";")[0].trim().toLowerCase()
  const ext = String(file?.name || "").split(".").pop()?.toLowerCase() || ""
  if ((ext === "md" || ext === "markdown") && GENERIC_DECLARED_MIME.includes(declared)) {
    return "text/markdown"
  }
  if (declared) return declared
  return EXT_MIME[ext] || ""
}

export const formatBytes = (n) => {
  const size = Number(n) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export const collectClipboardFiles = (clipboard) => {
  const files = []
  const seen = new Set()
  const push = (file) => {
    if (!file) return
    const key = `${file.name}|${file.size}|${file.lastModified}|${file.type}`
    if (seen.has(key)) return
    seen.add(key)
    files.push(file)
  }
  const items = clipboard?.items
  if (items && items.length) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (item.kind !== "file") continue
      push(item.getAsFile?.())
    }
  }
  Array.from(clipboard?.files || []).forEach(push)
  return files
}

export const nameClipboardFile = (file) => {
  const raw = String(file?.name || "").trim()
  if (raw && raw !== "blob") return file
  const subtype = String(file?.type || "image/png").split("/")[1] || "png"
  const ext = subtype === "jpeg" ? "jpg" : subtype.split("+")[0]
  return new File([file], `pasted-image.${ext}`, { type: file.type || "image/png" })
}

export const collectDroppedFiles = (dataTransfer) => {
  const files = []
  const items = dataTransfer?.items
  if (items && items.length) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (item.kind !== "file") continue
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) continue
      const file = item.getAsFile?.()
      if (file) files.push(file)
    }
    return files
  }
  return Array.from(dataTransfer?.files || [])
}

export const filterUploadFiles = (incoming, { maxFiles, maxBytes = MAX_UPLOAD_BYTES, already = 0 } = {}) => {
  const accepted = []
  const rejected = []
  const list = Array.from(incoming || []).filter(Boolean)
  const cap = maxFiles == null ? Infinity : Math.max(0, maxFiles - already)
  const maxMb = Math.round(maxBytes / (1024 * 1024))
  for (const file of list) {
    if (typeof file.size !== "number") continue
    if (accepted.length >= cap) {
      rejected.push({ file, reason: `Max ${maxFiles} files` })
      continue
    }
    if (file.size > maxBytes) {
      rejected.push({ file, reason: `${file.name} exceeds ${maxMb} MB` })
      continue
    }
    const mime = mimeOf(file)
    if (!ALLOWED_UPLOAD_MIME.includes(mime)) {
      rejected.push({ file, reason: `${file.name} type not allowed` })
      continue
    }
    accepted.push(file)
  }
  return { accepted, rejected }
}
