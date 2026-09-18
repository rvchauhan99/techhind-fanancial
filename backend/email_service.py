"""Brevo email service for TechHind Finance.

Mirrors techhind-solar-api `email.service.js` / website SMTP pattern:
  host smtp-relay.brevo.com:587
  auth BREVO_USER + BREVO_MASTER_KEY
  from BREVO_FROM

Optional:
  BREVO_API_KEY — transactional REST fallback (api.brevo.com)
  BREVO_FROM_NAME — display name (default TechHind Finance)
  BREVO_MOCK=1 / EMAIL_DRY_RUN=1 — force mock (no network; E2E-friendly)
"""
from __future__ import annotations

import logging
import os
import re
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional, Sequence, Union

import requests

logger = logging.getLogger("email")

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

BREVO_SMTP_HOST = "smtp-relay.brevo.com"
BREVO_SMTP_PORT = 587
BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def is_mock_forced() -> bool:
    flag = (_env("BREVO_MOCK") or _env("EMAIL_DRY_RUN")).lower()
    return flag in ("1", "true", "yes", "on")


def is_configured() -> bool:
    """SMTP credentials (solar-api style) or Brevo REST API key."""
    smtp_ok = bool(_env("BREVO_USER") and _env("BREVO_MASTER_KEY") and _env("BREVO_FROM"))
    api_ok = bool(_env("BREVO_API_KEY") and _env("BREVO_FROM"))
    return smtp_ok or api_ok


def active_provider() -> str:
    if is_mock_forced() or not is_configured():
        return "brevo-mock"
    if _env("BREVO_USER") and _env("BREVO_MASTER_KEY"):
        return "brevo-smtp"
    return "brevo-api"


def normalize_recipients(to: Union[str, Sequence[str]]) -> List[str]:
    raw = ",".join(to) if isinstance(to, (list, tuple)) else str(to or "")
    seen = set()
    out: List[str] = []
    for part in re.split(r"[;,]", raw):
        email = part.strip()
        if not email or not EMAIL_RE.match(email):
            continue
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(email)
    return out


def _from_header() -> str:
    name = _env("BREVO_FROM_NAME") or "TechHind Finance"
    addr = _env("BREVO_FROM")
    return f"{name} <{addr}>"


def _build_message(
    *,
    to: List[str],
    subject: str,
    text: str,
    html: Optional[str],
    attachments: Optional[List[Dict[str, Any]]],
) -> MIMEMultipart:
    msg = MIMEMultipart("mixed")
    msg["From"] = _from_header()
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject

    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(text or "", "plain", "utf-8"))
    if html:
        alt.attach(MIMEText(html, "html", "utf-8"))
    msg.attach(alt)

    for att in attachments or []:
        data = att.get("content") or att.get("data") or b""
        if isinstance(data, str):
            data = data.encode("utf-8")
        filename = att.get("filename") or "attachment.bin"
        part = MIMEApplication(data, Name=filename)
        part.add_header("Content-Disposition", "attachment", filename=filename)
        ctype = att.get("content_type") or att.get("mime_type")
        if ctype:
            main, _, sub = ctype.partition("/")
            if main and sub:
                part.set_type(ctype)
        msg.attach(part)
    return msg


def _send_smtp(
    to: List[str],
    subject: str,
    text: str,
    html: Optional[str],
    attachments: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    user = _env("BREVO_USER")
    password = _env("BREVO_MASTER_KEY")
    msg = _build_message(to=to, subject=subject, text=text, html=html, attachments=attachments)
    with smtplib.SMTP(BREVO_SMTP_HOST, BREVO_SMTP_PORT, timeout=60) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.ehlo()
        smtp.login(user, password)
        smtp.sendmail(_env("BREVO_FROM"), to, msg.as_string())
    # SMTP does not always return a stable message-id; use Message-ID header if present
    message_id = msg.get("Message-ID") or ""
    logger.info("Email sent via Brevo SMTP to %s subject=%r", to, subject)
    return {"provider": "brevo-smtp", "message_id": message_id, "status": "sent"}


def _send_api(
    to: List[str],
    subject: str,
    text: str,
    html: Optional[str],
    attachments: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    import base64

    payload: Dict[str, Any] = {
        "sender": {
            "name": _env("BREVO_FROM_NAME") or "TechHind Finance",
            "email": _env("BREVO_FROM"),
        },
        "to": [{"email": addr} for addr in to],
        "subject": subject,
        "textContent": text or "",
    }
    if html:
        payload["htmlContent"] = html
    if attachments:
        payload["attachment"] = []
        for att in attachments:
            data = att.get("content") or att.get("data") or b""
            if isinstance(data, str):
                data = data.encode("utf-8")
            payload["attachment"].append({
                "name": att.get("filename") or "attachment.bin",
                "content": base64.b64encode(data).decode("ascii"),
            })

    resp = requests.post(
        BREVO_API_URL,
        headers={
            "api-key": _env("BREVO_API_KEY"),
            "Content-Type": "application/json",
            "accept": "application/json",
        },
        json=payload,
        timeout=60,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Brevo API error {resp.status_code}: {resp.text[:300]}")
    body = resp.json() if resp.content else {}
    message_id = body.get("messageId") or body.get("message_id") or ""
    logger.info("Email sent via Brevo API to %s messageId=%s", to, message_id)
    return {"provider": "brevo-api", "message_id": message_id, "status": "sent"}


def send_email(
    to: Union[str, Sequence[str]],
    subject: str,
    text: str = "",
    html: Optional[str] = None,
    attachments: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Send email via Brevo. Returns {mocked, provider, status, message_id, to, subject}."""
    recipients = normalize_recipients(to)
    if not recipients:
        raise ValueError("At least one valid recipient email is required")

    if is_mock_forced() or not is_configured():
        logger.info("Email MOCKED to %s subject=%r", recipients, subject)
        return {
            "mocked": True,
            "provider": "brevo-mock",
            "status": "mocked",
            "message_id": "",
            "to": recipients,
            "subject": subject,
        }

    try:
        if _env("BREVO_USER") and _env("BREVO_MASTER_KEY"):
            result = _send_smtp(recipients, subject, text, html, attachments)
        else:
            result = _send_api(recipients, subject, text, html, attachments)
        return {
            "mocked": False,
            "to": recipients,
            "subject": subject,
            **result,
        }
    except Exception as smtp_err:
        # Prefer API fallback when SMTP fails and API key exists
        if _env("BREVO_API_KEY") and (_env("BREVO_USER") and _env("BREVO_MASTER_KEY")):
            logger.warning("Brevo SMTP failed (%s); trying API", smtp_err)
            try:
                result = _send_api(recipients, subject, text, html, attachments)
                return {
                    "mocked": False,
                    "to": recipients,
                    "subject": subject,
                    **result,
                }
            except Exception:
                logger.exception("Brevo API fallback also failed")
                raise smtp_err
        logger.exception("Brevo send failed")
        raise
