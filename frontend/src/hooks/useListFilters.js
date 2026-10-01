import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { FIELD } from "../components/filters/types"

const DEBOUNCE_MS = 300

function keysForField(f) {
  if (f.type === FIELD.DATE_RANGE) return [f.fromKey || "date_from", f.toKey || "date_to"]
  if (f.type === FIELD.NUMBER_RANGE) return [f.minKey || `min_${f.key}`, f.maxKey || `max_${f.key}`]
  return [f.key]
}

/**
 * URL-synced list filters from a schema.
 * Preserves keys listed in `preserve` (e.g. doc_type, view, tab).
 */
export function useListFilters(schema, { preserve = [] } = {}) {
  const [params, setParams] = useSearchParams()
  const debounceTimers = useRef({})

  const values = useMemo(() => {
    const out = {}
    for (const f of schema) {
      for (const k of keysForField(f)) {
        out[k] = params.get(k) || ""
      }
      if (f.type === FIELD.TOGGLE) {
        out[f.key] = params.get(f.key) || ""
      }
    }
    for (const k of preserve) {
      out[k] = params.get(k) || ""
    }
    return out
  }, [params, schema, preserve])

  const setFilter = useCallback((key, value, { debounce = false } = {}) => {
    const apply = () => {
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        if (value === "" || value === null || value === undefined || value === "all") {
          next.delete(key)
        } else {
          next.set(key, String(value))
        }
        return next
      }, { replace: true })
    }
    if (debounce) {
      clearTimeout(debounceTimers.current[key])
      debounceTimers.current[key] = setTimeout(apply, DEBOUNCE_MS)
    } else {
      apply()
    }
  }, [setParams])

  const setMany = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      Object.entries(patch).forEach(([k, v]) => {
        if (v === "" || v === null || v === undefined || v === "all") next.delete(k)
        else next.set(k, String(v))
      })
      return next
    }, { replace: true })
  }, [setParams])

  const clearFilters = useCallback(() => {
    setParams((prev) => {
      const next = new URLSearchParams()
      for (const k of preserve) {
        const v = prev.get(k)
        if (v) next.set(k, v)
      }
      return next
    }, { replace: true })
  }, [setParams, preserve])

  const activeCount = useMemo(() => {
    let n = 0
    for (const f of schema) {
      for (const k of keysForField(f)) {
        if (params.get(k)) n += 1
      }
    }
    return n
  }, [params, schema])

  /** Params object suitable for axios `params` (omits empty). */
  const apiParams = useMemo(() => {
    const out = {}
    for (const f of schema) {
      for (const k of keysForField(f)) {
        const v = params.get(k)
        if (v) out[k] = v
      }
    }
    for (const k of preserve) {
      const v = params.get(k)
      if (v) out[k] = v
    }
    return out
  }, [params, schema, preserve])

  useEffect(() => () => {
    Object.values(debounceTimers.current).forEach(clearTimeout)
  }, [])

  return { values, setFilter, setMany, clearFilters, activeCount, apiParams, params, setParams }
}

/** Local draft state for debounced text that mirrors URL after debounce. */
export function useDebouncedDraft(urlValue, onCommit) {
  const [draft, setDraft] = useState(urlValue)
  const lastSent = useRef(urlValue)
  useEffect(() => {
    // Sync from URL only when it changed externally (clear / back / link), not while
    // our own debounce is catching up mid-typing.
    if (urlValue === lastSent.current) return
    setDraft(urlValue)
    lastSent.current = urlValue
  }, [urlValue])
  const onChange = (v) => {
    setDraft(v)
    lastSent.current = v
    onCommit(v)
  }
  return [draft, onChange]
}
