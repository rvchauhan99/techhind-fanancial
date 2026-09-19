/** Field type constants for list FilterBar schemas */
export const FIELD = {
  TEXT: "text",
  NUMBER: "number",
  NUMBER_RANGE: "number_range",
  DATE: "date",
  DATE_RANGE: "date_range",
  SELECT: "select",
  MULTI_SELECT: "multi_select",
  TOGGLE: "toggle",
}

/**
 * @typedef {{ key: string, type: string, label: string, placeholder?: string,
 *   options?: {value:string,label:string}[], fromKey?: string, toKey?: string,
 *   minKey?: string, maxKey?: string, allLabel?: string, debounce?: boolean,
 *   width?: string }} FilterField
 */
