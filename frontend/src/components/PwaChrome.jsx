import React, { useEffect, useState } from "react"
import { applyServiceWorkerUpdate } from "../pwaRegister"

export default function PwaChrome() {
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false)
  const [waitingWorker, setWaitingWorker] = useState(null)

  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener("online", on)
    window.addEventListener("offline", off)
    const onUpdate = (event) => setWaitingWorker(event.detail?.worker || null)
    window.addEventListener("pwa-update", onUpdate)
    const blockSubmit = (event) => {
      if (navigator.onLine) return
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener("submit", blockSubmit, true)
    return () => {
      window.removeEventListener("online", on)
      window.removeEventListener("offline", off)
      window.removeEventListener("pwa-update", onUpdate)
      document.removeEventListener("submit", blockSubmit, true)
    }
  }, [])

  return (
    <>
      {offline && (
        <div
          data-testid="offline-banner"
          className="fixed top-0 inset-x-0 z-[80] bg-amber-700 text-white text-xs font-semibold px-3 py-2 text-center pt-[max(0.5rem,env(safe-area-inset-top))]"
          role="status"
        >
          You are offline. Finance actions need a connection.{" "}
          <a href="/offline.html" className="underline" data-testid="offline-help-link">Details</a>
        </div>
      )}
      {waitingWorker && (
        <div
          data-testid="pwa-update-banner"
          className="fixed bottom-0 inset-x-0 z-[80] bg-[#0F284E] text-white text-xs px-3 py-2 flex items-center justify-between gap-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          role="status"
        >
          <span>A new version of TechHind Finance is ready.</span>
          <button
            type="button"
            data-testid="pwa-update-reload"
            className="min-h-9 px-3 rounded bg-white text-[#0F284E] font-semibold"
            onClick={() => applyServiceWorkerUpdate(waitingWorker)}
          >
            Reload
          </button>
        </div>
      )}
    </>
  )
}
