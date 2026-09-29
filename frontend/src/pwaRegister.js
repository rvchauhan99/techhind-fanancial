export function registerServiceWorker() {
  if (process.env.NODE_ENV !== "production") return
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").then((reg) => {
      const notify = (worker) => {
        window.dispatchEvent(new CustomEvent("pwa-update", { detail: { worker } }))
      }
      if (reg.waiting && navigator.serviceWorker.controller) notify(reg.waiting)
      reg.addEventListener("updatefound", () => {
        const next = reg.installing
        if (!next) return
        next.addEventListener("statechange", () => {
          if (next.state === "installed" && navigator.serviceWorker.controller) notify(next)
        })
      })
    }).catch(() => {})
  })
}

export function applyServiceWorkerUpdate(worker) {
  if (!worker) return
  const onControl = () => {
    navigator.serviceWorker.removeEventListener("controllerchange", onControl)
    window.location.reload()
  }
  navigator.serviceWorker.addEventListener("controllerchange", onControl)
  worker.postMessage({ type: "SKIP_WAITING" })
}
