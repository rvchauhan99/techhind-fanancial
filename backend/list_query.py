"""Shared Mongo list-filter helpers for finance list APIs."""
from __future__ import annotations

import re
from typing import Any, Iterable, Optional


def _escape_re(s: str) -> str:
    return re.escape(s.strip())


def apply_q(flt: dict, q: str, fields: Iterable[str]) -> dict:
    """OR regex across string fields (case-insensitive)."""
    q = (q or "").strip()
    if not q:
        return flt
    rx = {"$regex": _escape_re(q), "$options": "i"}
    ors = [{f: rx} for f in fields]
    if "$and" in flt:
        flt["$and"].append({"$or": ors})
    elif "$or" in flt:
        flt = {"$and": [{"$or": flt["$or"]}, {"$or": ors}], **{k: v for k, v in flt.items() if k != "$or"}}
    else:
        flt["$or"] = ors
    return flt


def apply_date_range(flt: dict, field: str, date_from: str = "", date_to: str = "") -> dict:
    date_from = (date_from or "").strip()
    date_to = (date_to or "").strip()
    if not date_from and not date_to:
        return flt
    rng: dict[str, str] = {}
    if date_from:
        rng["$gte"] = date_from
    if date_to:
        rng["$lte"] = date_to
    flt[field] = rng
    return flt


def apply_amount_range(flt: dict, field: str, min_v: Optional[float] = None, max_v: Optional[float] = None) -> dict:
    rng: dict[str, float] = {}
    if min_v is not None and min_v != "":
        try:
            rng["$gte"] = float(min_v)
        except (TypeError, ValueError):
            pass
    if max_v is not None and max_v != "":
        try:
            rng["$lte"] = float(max_v)
        except (TypeError, ValueError):
            pass
    if rng:
        flt[field] = rng
    return flt


def apply_eq(flt: dict, field: str, value: Any) -> dict:
    if value is None:
        return flt
    if isinstance(value, str) and not value.strip():
        return flt
    flt[field] = value
    return flt


def apply_bool_flag(flt: dict, field: str, flag: str, *, truthy_gt: float = 0) -> dict:
    """flag: '1'|'true'|'yes' → field > truthy_gt; '0'|'false'|'no' → field <= 0 or missing."""
    v = (flag or "").strip().lower()
    if v in ("1", "true", "yes"):
        flt[field] = {"$gt": truthy_gt}
    elif v in ("0", "false", "no"):
        flt[field] = {"$lte": 0}
    return flt


def apply_in(flt: dict, field: str, csv_or_list: str | list | None) -> dict:
    if csv_or_list is None or csv_or_list == "":
        return flt
    if isinstance(csv_or_list, str):
        vals = [x.strip() for x in csv_or_list.split(",") if x.strip()]
    else:
        vals = list(csv_or_list)
    if not vals:
        return flt
    if len(vals) == 1:
        flt[field] = vals[0]
    else:
        flt[field] = {"$in": vals}
    return flt
