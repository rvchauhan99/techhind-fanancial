from datetime import timedelta
from typing import Optional

import pyotp
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from core import (db, get_current_user, verify_password, hash_password, create_access_token,
                  create_refresh_token, set_auth_cookies, utcnow, iso_now, audit,
                  require_roles, ALL_ROLES, is_refresh_revoked, revoke_refresh_jti)

router = APIRouter(prefix="/api/auth", tags=["auth"])

LOCK_AFTER = 5
LOCK_MINUTES = 15


class LoginIn(BaseModel):
    email: str
    password: str
    otp: Optional[str] = None


class OtpIn(BaseModel):
    otp: str


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower().strip()
    ident = f"{request.client.host}:{email}"
    att = await db.login_attempts.find_one({"identifier": ident})
    if att and att.get("count", 0) >= LOCK_AFTER and att.get("locked_until", "") > iso_now():
        raise HTTPException(status_code=429, detail="Too many failed attempts. Locked for 15 minutes.")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(body.password, user["password_hash"]):
        count = (att or {}).get("count", 0) + 1
        locked_until = (utcnow() + timedelta(minutes=LOCK_MINUTES)).isoformat() if count >= LOCK_AFTER else ""
        await db.login_attempts.update_one({"identifier": ident},
                                           {"$set": {"count": count, "locked_until": locked_until}},
                                           upsert=True)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Account disabled")
    if user.get("totp_enabled"):
        if not body.otp:
            return {"requires_2fa": True, "user": None, "access_token": None}
        if not pyotp.TOTP(user["totp_secret"]).verify(body.otp, valid_window=1):
            raise HTTPException(status_code=401, detail="Invalid 2FA code")
    await db.login_attempts.delete_one({"identifier": ident})
    access = set_auth_cookies(response, user)
    safe = {k: v for k, v in user.items() if k not in ("password_hash", "totp_secret", "totp_pending_secret")}
    await audit(safe, "login", "user", user["id"], f"{user['name']} logged in")
    return {"requires_2fa": False, "user": safe, "access_token": access}


@router.post("/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if token:
        try:
            import os
            payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=["HS256"],
                                 options={"verify_exp": False})
            jti = payload.get("jti")
            exp = payload.get("exp")
            if jti and exp:
                from datetime import datetime, timezone
                exp_dt = datetime.fromtimestamp(exp, tz=timezone.utc) if isinstance(exp, (int, float)) else exp
                await revoke_refresh_jti(jti, exp_dt)
        except Exception:
            pass
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@router.get("/me")
async def me(user=Depends(get_current_user)):
    return user


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    import os
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=["HS256"])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    jti = payload.get("jti")
    if await is_refresh_revoked(jti):
        raise HTTPException(status_code=401, detail="Refresh token revoked")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0, "totp_secret": 0})
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="User not found")
    # Rotate: revoke old refresh, issue new pair
    exp = payload.get("exp")
    from datetime import datetime, timezone
    exp_dt = datetime.fromtimestamp(exp, tz=timezone.utc) if isinstance(exp, (int, float)) else utcnow()
    await revoke_refresh_jti(jti, exp_dt)
    access = set_auth_cookies(response, user)
    safe = {k: v for k, v in user.items() if k not in ("password_hash", "totp_secret", "totp_pending_secret")}
    return {"access_token": access, "user": safe}


@router.post("/2fa/setup")
async def twofa_setup(user=Depends(require_roles(*ALL_ROLES))):
    secret = pyotp.random_base32()
    await db.users.update_one({"id": user["id"]}, {"$set": {"totp_pending_secret": secret}})
    uri = pyotp.TOTP(secret).provisioning_uri(name=user["email"], issuer_name="TechHind Finance")
    return {"secret": secret, "provisioning_uri": uri}


@router.post("/2fa/enable")
async def twofa_enable(body: OtpIn, user=Depends(require_roles(*ALL_ROLES))):
    doc = await db.users.find_one({"id": user["id"]})
    pending = (doc or {}).get("totp_pending_secret")
    if not pending:
        raise HTTPException(status_code=400, detail="Run 2FA setup first")
    if not pyotp.TOTP(pending).verify(body.otp, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid code")
    await db.users.update_one({"id": user["id"]},
                              {"$set": {"totp_enabled": True, "totp_secret": pending},
                               "$unset": {"totp_pending_secret": ""}})
    await audit(user, "2fa_enabled", "user", user["id"], f"{user['name']} enabled TOTP 2FA")
    return {"ok": True, "totp_enabled": True}


@router.post("/2fa/disable")
async def twofa_disable(body: OtpIn, user=Depends(require_roles(*ALL_ROLES))):
    doc = await db.users.find_one({"id": user["id"]})
    if not (doc or {}).get("totp_enabled"):
        raise HTTPException(status_code=400, detail="2FA not enabled")
    if not pyotp.TOTP(doc["totp_secret"]).verify(body.otp, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid code")
    await db.users.update_one({"id": user["id"]},
                              {"$set": {"totp_enabled": False}, "$unset": {"totp_secret": ""}})
    await audit(user, "2fa_disabled", "user", user["id"], f"{user['name']} disabled TOTP 2FA")
    return {"ok": True, "totp_enabled": False}
