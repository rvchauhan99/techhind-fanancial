import React from "react"
import { X } from "lucide-react"
import { Input } from "../ui/input"
import { Label } from "../ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { Button } from "../ui/button"
import { FIELD } from "./types"
import { useDebouncedDraft } from "../../hooks/useListFilters"

function FieldShell({ label, children, className = "" }) {
  return (
    <div className={`min-w-0 ${className}`}>
      {label ? <Label className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5 block">{label}</Label> : null}
      {children}
    </div>
  )
}

function TextField({ field, value, setFilter }) {
  const [draft, onChange] = useDebouncedDraft(value, (v) => setFilter(field.key, v, { debounce: true }))
  return (
    <FieldShell label={field.label} className={field.width || "w-40"}>
      <Input
        data-testid={`filter-${field.key}`}
        value={draft}
        placeholder={field.placeholder || "Search…"}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs bg-white"
      />
    </FieldShell>
  )
}

function NumberField({ field, value, setFilter }) {
  return (
    <FieldShell label={field.label} className={field.width || "w-28"}>
      <Input
        data-testid={`filter-${field.key}`}
        type="number"
        step="any"
        value={value}
        placeholder={field.placeholder || ""}
        onChange={(e) => setFilter(field.key, e.target.value)}
        className="h-8 text-xs font-mono bg-white"
      />
    </FieldShell>
  )
}

function NumberRangeField({ field, values, setFilter }) {
  const minKey = field.minKey || `min_${field.key}`
  const maxKey = field.maxKey || `max_${field.key}`
  return (
    <FieldShell label={field.label} className={field.width || "w-52"}>
      <div className="flex items-center gap-1">
        <Input data-testid={`filter-${minKey}`} type="number" step="any" placeholder="Min"
          value={values[minKey] || ""} onChange={(e) => setFilter(minKey, e.target.value)}
          className="h-8 text-xs font-mono bg-white w-24" />
        <span className="text-slate-400 text-xs">–</span>
        <Input data-testid={`filter-${maxKey}`} type="number" step="any" placeholder="Max"
          value={values[maxKey] || ""} onChange={(e) => setFilter(maxKey, e.target.value)}
          className="h-8 text-xs font-mono bg-white w-24" />
      </div>
    </FieldShell>
  )
}

function DateField({ field, value, setFilter }) {
  return (
    <FieldShell label={field.label} className={field.width || "w-36"}>
      <Input data-testid={`filter-${field.key}`} type="date" value={value}
        onChange={(e) => setFilter(field.key, e.target.value)}
        className="h-8 text-xs font-mono bg-white" />
    </FieldShell>
  )
}

function DateRangeField({ field, values, setFilter }) {
  const fromKey = field.fromKey || "date_from"
  const toKey = field.toKey || "date_to"
  return (
    <FieldShell label={field.label} className={field.width || "w-64"}>
      <div className="flex items-center gap-1">
        <Input data-testid={`filter-${fromKey}`} type="date" value={values[fromKey] || ""}
          onChange={(e) => setFilter(fromKey, e.target.value)}
          className="h-8 text-xs font-mono bg-white w-32" />
        <span className="text-slate-400 text-xs">–</span>
        <Input data-testid={`filter-${toKey}`} type="date" value={values[toKey] || ""}
          onChange={(e) => setFilter(toKey, e.target.value)}
          className="h-8 text-xs font-mono bg-white w-32" />
      </div>
    </FieldShell>
  )
}

function SelectField({ field, value, setFilter }) {
  const all = field.allLabel || "All"
  return (
    <FieldShell label={field.label} className={field.width || "w-40"}>
      <Select value={value || "all"} onValueChange={(v) => setFilter(field.key, v === "all" ? "" : v)}>
        <SelectTrigger data-testid={`filter-${field.key}`} className="h-8 text-xs bg-white">
          <SelectValue placeholder={all} />
        </SelectTrigger>
        <SelectContent className="bg-white max-h-64">
          <SelectItem value="all">{all}</SelectItem>
          {(field.options || []).map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  )
}

function ToggleField({ field, value, setFilter }) {
  const on = value === "1" || value === "true"
  return (
    <FieldShell label={field.label || "\u00a0"} className={field.width || "w-auto"}>
      <button
        type="button"
        data-testid={`filter-${field.key}`}
        onClick={() => setFilter(field.key, on ? "" : "1")}
        className={`h-8 px-2.5 rounded-md border text-xs font-semibold transition-colors ${
          on ? "bg-[#0F284E] text-white border-[#0F284E]" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
        }`}
      >
        {field.placeholder || field.label}
      </button>
    </FieldShell>
  )
}

function renderField(field, values, setFilter) {
  const v = values[field.key] || ""
  switch (field.type) {
    case FIELD.TEXT: return <TextField key={field.key} field={field} value={v} setFilter={setFilter} />
    case FIELD.NUMBER: return <NumberField key={field.key} field={field} value={v} setFilter={setFilter} />
    case FIELD.NUMBER_RANGE: return <NumberRangeField key={field.key} field={field} values={values} setFilter={setFilter} />
    case FIELD.DATE: return <DateField key={field.key} field={field} value={v} setFilter={setFilter} />
    case FIELD.DATE_RANGE: return <DateRangeField key={field.key} field={field} values={values} setFilter={setFilter} />
    case FIELD.SELECT:
    case FIELD.MULTI_SELECT: return <SelectField key={field.key} field={field} value={v} setFilter={setFilter} />
    case FIELD.TOGGLE: return <ToggleField key={field.key} field={field} value={v} setFilter={setFilter} />
    default: return null
  }
}

/**
 * Dense filter bar. Tabs / view switches stay outside (above) this component.
 */
export default function FilterBar({ schema, values, setFilter, clearFilters, activeCount = 0, testId = "filter-bar" }) {
  return (
    <div className="flex flex-wrap items-end gap-2 mb-2" data-testid={testId}>
      {schema.map((f) => renderField(f, values, setFilter))}
      {activeCount > 0 && (
        <Button type="button" variant="ghost" size="sm" data-testid="filter-clear-btn"
          onClick={clearFilters}
          className="h-8 px-2 text-xs text-slate-600">
          <X className="w-3.5 h-3.5 mr-1" /> Clear ({activeCount})
        </Button>
      )}
    </div>
  )
}

export { FIELD }
