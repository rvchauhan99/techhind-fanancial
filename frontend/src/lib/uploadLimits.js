export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
export const MAX_TASK_ATTACHMENTS = 10
export const MAX_TICKET_ATTACHMENTS = 5

export const ALLOWED_UPLOAD_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]

export const UPLOAD_ACCEPT = ALLOWED_UPLOAD_MIME.join(",")

const EXT_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

export const mimeOf = (file) => {
  const declared = String(file?.type || "").split(";")[0].trim().toLowerCase()
  if (declared) return declared
  const ext = String(file?.name || "").split(".").pop()?.toLowerCase() || ""
  return EXT_MIME[ext] || ""
}

export const formatBytes = (n) => {
  const size = Number(n) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
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
