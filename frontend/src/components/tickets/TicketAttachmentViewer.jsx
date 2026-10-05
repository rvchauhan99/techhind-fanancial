import React, { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Download, FileText, FileSpreadsheet, File, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import api, { apiError } from "../../lib/api"
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog"

export const isImageAttachment = (att) => {
  const mime = String(att?.mime || "")
  if (mime.startsWith("image/")) return true
  const name = String(att?.name || "").toLowerCase()
  return /\.(png|jpe?g|gif|webp|bmp)$/.test(name)
}

export const isPdfAttachment = (att) => {
  const mime = String(att?.mime || "")
  if (mime === "application/pdf") return true
  return String(att?.name || "").toLowerCase().endsWith(".pdf")
}

const fileIcon = (att) => {
  const name = String(att?.name || "").toLowerCase()
  const mime = String(att?.mime || "")
  if (mime.includes("sheet") || /\.(xlsx?|csv)$/.test(name)) return FileSpreadsheet
  if (isPdfAttachment(att) || mime.includes("pdf") || mime.includes("text") || /\.(md|markdown)$/.test(name)) return FileText
  return File
}

export const fetchTicketFileBlob = async (att) => {
  if (!att?.storage_path) {
    throw new Error("Missing file path")
  }
  const res = await api.get(`/files/${att.storage_path}`, { responseType: "blob" })
  const mime = att.mime || res.data?.type || "application/octet-stream"
  return new Blob([res.data], { type: mime })
}

const downloadBlob = (blob, name) => {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name || "attachment"
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

export const downloadStoredFile = async (storagePath, name) => {
  const blob = await fetchTicketFileBlob({ storage_path: storagePath })
  downloadBlob(blob, name || "attachment")
}

export const openBlobInTab = (blob) => {
  const url = window.URL.createObjectURL(blob)
  window.open(url, "_blank", "noopener,noreferrer")
  setTimeout(() => window.URL.revokeObjectURL(url), 120_000)
}

function ImageThumb({ att, onOpen, onDownload, loadingId }) {
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)
  const urlRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    setSrc(null)
    fetchTicketFileBlob(att)
      .then((blob) => {
        if (cancelled) return
        const url = window.URL.createObjectURL(blob)
        urlRef.current = url
        setSrc(url)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (urlRef.current) {
        window.URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [att])

  const busy = loadingId === att.file_id

  return (
    <div
      className="relative w-14 h-14 rounded border border-slate-200 overflow-hidden bg-slate-50 shrink-0 group"
      data-testid={`ticket-file-${att.file_id}`}
    >
      <button
        type="button"
        onClick={() => onOpen(att)}
        className="absolute inset-0 hover:ring-1 hover:ring-[#0066CC] focus:outline-none focus:ring-1 focus:ring-[#0066CC]"
        aria-label={`View ${att.name || "image"}`}
        data-testid={`ticket-file-view-${att.file_id}`}
        title={att.name}
      >
        {src && !failed ? (
          <img src={src} alt={att.name || "attachment"} className="w-full h-full object-cover" />
        ) : (
          <span className="flex items-center justify-center w-full h-full text-[10px] text-slate-400">
            {failed ? "!" : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onDownload(att)
        }}
        disabled={busy}
        className="absolute bottom-0.5 right-0.5 z-[1] p-0.5 rounded bg-black/55 text-white opacity-90 hover:opacity-100 disabled:opacity-50"
        aria-label={`Download ${att.name || "attachment"}`}
        title="Download"
        data-testid={`ticket-file-download-${att.file_id}`}
      >
        {busy ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Download className="w-2.5 h-2.5" />}
      </button>
    </div>
  )
}

function FileChip({ att, onView, onDownload, loadingId }) {
  const Icon = fileIcon(att)
  const busy = loadingId === att.file_id
  return (
    <div
      className="inline-flex items-center gap-0.5 text-[11px] border border-slate-200 rounded px-1 py-0.5 bg-white max-w-full"
      data-testid={`ticket-file-${att.file_id}`}
    >
      <Icon className="w-3 h-3 text-slate-400 shrink-0" />
      <button
        type="button"
        onClick={() => onView(att)}
        disabled={busy}
        className="max-w-[9rem] truncate text-[#0066CC] hover:underline px-0.5 disabled:opacity-50"
        title={`View ${att.name}`}
        data-testid={`ticket-file-view-${att.file_id}`}
      >
        {att.name || "file"}
      </button>
      <button
        type="button"
        onClick={() => onDownload(att)}
        disabled={busy}
        className="p-0.5 rounded text-slate-500 hover:bg-slate-100 hover:text-[#0066CC] disabled:opacity-50"
        aria-label={`Download ${att.name || "attachment"}`}
        title="Download"
        data-testid={`ticket-file-download-${att.file_id}`}
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
      </button>
    </div>
  )
}

function AttachmentLightbox({ open, attachments, index, onClose, onIndex, onDownload, previewUrl, loading }) {
  useEffect(() => {
    if (!open) return undefined
    const handleKey = (e) => {
      if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1))
      if (e.key === "ArrowRight") onIndex(Math.min(attachments.length - 1, index + 1))
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [open, index, attachments.length, onIndex])

  const att = attachments[index]
  const canPrev = index > 0
  const canNext = index < attachments.length - 1

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="!fixed !inset-0 !left-0 !top-0 !flex !h-[100dvh] !max-h-[100dvh] !w-full !max-w-none !translate-x-0 !translate-y-0 !rounded-none border-none bg-black/95 p-0 gap-0 flex-col overflow-hidden text-white ring-0 [&>button]:hidden"
        data-testid="ticket-attachment-lightbox"
      >
        <div className="p-2 sm:p-3 shrink-0 flex items-center justify-between gap-2 border-b border-white/10 bg-black/60">
          <DialogTitle className="text-white text-xs sm:text-sm font-medium pr-2 line-clamp-2 m-0">
            {att?.name || "Attachment"}
            {attachments.length > 1 && (
              <span className="text-white/60 font-normal ml-2 whitespace-nowrap">
                {index + 1} / {attachments.length}
              </span>
            )}
          </DialogTitle>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => att && onDownload(att)}
              className="h-7 px-2 rounded text-[11px] font-semibold text-white hover:bg-white/10 inline-flex items-center gap-1"
              data-testid="lightbox-download"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-7 w-7 rounded text-white hover:bg-white/10 inline-flex items-center justify-center"
              aria-label="Close"
              data-testid="lightbox-close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="relative flex-1 min-h-0 w-full flex items-center justify-center px-10 sm:px-14 py-2">
          {canPrev && (
            <button
              type="button"
              aria-label="Previous"
              onClick={() => onIndex(index - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-2 h-10 w-10 rounded-full bg-white/15 hover:bg-white/25 text-white inline-flex items-center justify-center"
              data-testid="lightbox-prev"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}
          {canNext && (
            <button
              type="button"
              aria-label="Next"
              onClick={() => onIndex(index + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-2 h-10 w-10 rounded-full bg-white/15 hover:bg-white/25 text-white inline-flex items-center justify-center"
              data-testid="lightbox-next"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
          {loading || !previewUrl ? (
            <Loader2 className="w-8 h-8 animate-spin text-white/70" />
          ) : (
            <img
              src={previewUrl}
              alt={att?.name || "attachment"}
              className="max-w-full max-h-full object-contain"
              data-testid="lightbox-image"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Mime-aware attachment list: image thumbs + lightbox, PDF/other view-in-tab, download.
 */
export default function TicketAttachmentList({ attachments }) {
  const list = Array.isArray(attachments) ? attachments : []
  const images = list.filter(isImageAttachment)
  const others = list.filter((a) => !isImageAttachment(a))
  const [loadingId, setLoadingId] = useState(null)
  const [lightbox, setLightbox] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [lightboxLoading, setLightboxLoading] = useState(false)
  const previewRef = useRef(null)

  const revokePreview = useCallback(() => {
    if (previewRef.current) {
      window.URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    }
    setPreviewUrl(null)
  }, [])

  useEffect(() => () => revokePreview(), [revokePreview])

  const loadLightboxPreview = useCallback(
    async (att) => {
      setLightboxLoading(true)
      revokePreview()
      try {
        const blob = await fetchTicketFileBlob(att)
        const url = window.URL.createObjectURL(blob)
        previewRef.current = url
        setPreviewUrl(url)
      } catch (err) {
        toast.error(apiError(err) || "Unable to open image")
        setLightbox(null)
      } finally {
        setLightboxLoading(false)
      }
    },
    [revokePreview]
  )

  useEffect(() => {
    if (!lightbox) return
    const att = lightbox.attachments[lightbox.index]
    if (att) loadLightboxPreview(att)
  }, [lightbox, loadLightboxPreview])

  const handleOpenImage = (att) => {
    const idx = images.findIndex((a) => a.file_id === att.file_id)
    setLightbox({ attachments: images, index: Math.max(0, idx) })
  }

  const handleView = async (att) => {
    if (isImageAttachment(att)) {
      handleOpenImage(att)
      return
    }
    setLoadingId(att.file_id)
    try {
      const blob = await fetchTicketFileBlob(att)
      openBlobInTab(blob)
    } catch (err) {
      toast.error(apiError(err) || "Unable to open file")
    } finally {
      setLoadingId(null)
    }
  }

  const handleDownload = async (att) => {
    setLoadingId(att.file_id)
    try {
      const blob = await fetchTicketFileBlob(att)
      downloadBlob(blob, att.name)
    } catch (err) {
      toast.error(apiError(err) || "Download failed")
    } finally {
      setLoadingId(null)
    }
  }

  const handleCloseLightbox = () => {
    setLightbox(null)
    revokePreview()
  }

  if (!list.length) return null

  return (
    <>
      <div className="mt-1.5 flex flex-wrap gap-1.5 items-start">
        {images.map((a) => (
          <ImageThumb
            key={a.file_id}
            att={a}
            onOpen={handleOpenImage}
            onDownload={handleDownload}
            loadingId={loadingId}
          />
        ))}
        {others.map((a) => (
          <FileChip
            key={a.file_id}
            att={a}
            onView={handleView}
            onDownload={handleDownload}
            loadingId={loadingId}
          />
        ))}
      </div>
      <AttachmentLightbox
        open={Boolean(lightbox)}
        attachments={lightbox?.attachments || []}
        index={lightbox?.index || 0}
        onClose={handleCloseLightbox}
        onIndex={(i) => setLightbox((g) => (g ? { ...g, index: i } : g))}
        onDownload={handleDownload}
        previewUrl={previewUrl}
        loading={lightboxLoading}
      />
    </>
  )
}

export function PriorityBadge({ value }) {
  const v = value || "normal"
  const styles = {
    low: "bg-slate-50 text-slate-600 border-slate-200",
    normal: "bg-blue-50 text-blue-700 border-blue-200",
    high: "bg-red-50 text-red-700 border-red-200",
    urgent: "bg-red-100 text-red-900 border-red-400",
  }
  return (
    <span
      data-testid={`priority-${v}`}
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${
        styles[v] || styles.normal
      }`}
    >
      {v}
    </span>
  )
}
