from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, require_roles, ALL_ROLES, FINANCE_ROLES, audit, iso_now

router = APIRouter(prefix="/api", tags=["periods"])

STATES = ["open", "in_review", "gst_filed", "closed"]


class StateIn(BaseModel):
    state: str


@router.get("/periods")
async def list_periods(user=Depends(require_roles(*ALL_ROLES))):
    stored = {p["month"]: p for p in await db.periods.find({}, {"_id": 0}).to_list(500)}
    t = date.today()
    y, m = t.year, t.month
    out = []
    for _ in range(12):
        mo = f"{y:04d}-{m:02d}"
        p = stored.get(mo)
        out.append(p or {"month": mo, "state": "open", "history": []})
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return out


@router.post("/periods/{month}/state")
async def set_period_state(month: str, body: StateIn, user=Depends(require_roles(*FINANCE_ROLES))):
    target = body.state
    if target not in STATES:
        raise HTTPException(status_code=400, detail=f"State must be one of {STATES}")
    cur_doc = await db.periods.find_one({"month": month}, {"_id": 0})
    cur = (cur_doc or {}).get("state", "open")
    if target == cur:
        raise HTTPException(status_code=400, detail=f"Period already {cur}")
    forward = STATES.index(target) > STATES.index(cur)
    if not forward and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only Admin can move a period backwards / reopen")
    if cur == "closed" and target != "closed" and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only Admin can reopen a closed period")
    entry = {"from": cur, "to": target, "by": user["name"], "at": iso_now()}
    await db.periods.update_one({"month": month},
                                {"$set": {"month": month, "state": target, "updated_at": iso_now()},
                                 "$push": {"history": entry}}, upsert=True)
    await audit(
        user, "period_transition", "period", month,
        f"Period {month}: {cur.replace('_',' ')} → {target.replace('_',' ')}",
        diff={"state": {"old": cur, "new": target}},
    )
    return {"month": month, "state": target, "history": (cur_doc or {}).get("history", []) + [entry]}
