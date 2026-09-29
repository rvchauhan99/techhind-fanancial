export function labelPwaTables(root = document) {
  root.querySelectorAll("table.pwa-table").forEach((table) => {
    const headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
      (th.textContent || "").replace(/\s+/g, " ").trim()
    )
    table.querySelectorAll("tbody tr").forEach((tr) => {
      Array.from(tr.children).forEach((cell, index) => {
        if (cell.tagName !== "TD") return
        if (cell.hasAttribute("colspan") || cell.getAttribute("colSpan")) {
          cell.setAttribute("data-label", "")
          return
        }
        cell.setAttribute("data-label", headers[index] || "")
      })
    })
  })
}
