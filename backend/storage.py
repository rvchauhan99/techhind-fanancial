"""Object storage for TechHind Finance.

Backend priority:
1. Cloudflare R2 / S3-compatible — when BUCKET_ENDPOINT, BUCKET_NAME,
   BUCKET_ACCESS_KEY_ID, BUCKET_SECRET_ACCESS_KEY are all set
2. Local filesystem — LOCAL_STORAGE_DIR (default: backend/.local_storage)

Reads fall back to local when R2 misses a key (migration / offline assets).
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger("storage")

APP_NAME = "techhind-finance"

LOCAL_ROOT = Path(os.environ.get("LOCAL_STORAGE_DIR") or (Path(__file__).parent / ".local_storage"))

_BUCKET_ENDPOINT = (os.environ.get("BUCKET_ENDPOINT") or "").strip()
_BUCKET_NAME = (os.environ.get("BUCKET_NAME") or "").strip()
_BUCKET_ACCESS_KEY_ID = (os.environ.get("BUCKET_ACCESS_KEY_ID") or "").strip()
_BUCKET_SECRET_ACCESS_KEY = (os.environ.get("BUCKET_SECRET_ACCESS_KEY") or "").strip()
_BUCKET_REGION = (os.environ.get("BUCKET_REGION") or "auto").strip()
# R2 does not support S3 ACLs; leave unset unless explicitly configured (real S3).
_BUCKET_ACL = (os.environ.get("BUCKET_ACL") or "").strip()

_USE_R2 = bool(_BUCKET_ENDPOINT and _BUCKET_NAME and _BUCKET_ACCESS_KEY_ID and _BUCKET_SECRET_ACCESS_KEY)

storage_key = None
_s3_client = None


def active_backend() -> str:
    if _USE_R2:
        return "r2"
    return "local"


def _get_s3():
    """Lazy boto3 S3 client (path-style + SigV4 — required by Cloudflare R2)."""
    global _s3_client
    if _s3_client is not None:
        return _s3_client
    if not _USE_R2:
        raise RuntimeError(
            "Bucket config missing: set BUCKET_ENDPOINT, BUCKET_NAME, "
            "BUCKET_ACCESS_KEY_ID, BUCKET_SECRET_ACCESS_KEY"
        )
    import boto3
    from botocore.config import Config

    _s3_client = boto3.client(
        "s3",
        endpoint_url=_BUCKET_ENDPOINT,
        aws_access_key_id=_BUCKET_ACCESS_KEY_ID,
        aws_secret_access_key=_BUCKET_SECRET_ACCESS_KEY,
        region_name=_BUCKET_REGION,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )
    return _s3_client


def init_storage(force: bool = False) -> str:
    global storage_key
    backend = active_backend()
    if backend == "r2":
        _get_s3()
        storage_key = "r2"
        return storage_key
    LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
    storage_key = "local"
    return storage_key


def _put_local(path: str, data: bytes, content_type: str) -> dict:
    LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
    dest = LOCAL_ROOT / path
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    meta = dest.with_suffix(dest.suffix + ".ctype")
    meta.write_text(content_type or "application/octet-stream")
    return {"path": path, "storage": "local"}


def _get_local(path: str) -> Tuple[bytes, str]:
    dest = LOCAL_ROOT / path
    if not dest.exists():
        raise FileNotFoundError(path)
    ctype = "application/octet-stream"
    meta = dest.with_suffix(dest.suffix + ".ctype")
    if meta.exists():
        ctype = meta.read_text().strip() or ctype
    return dest.read_bytes(), ctype


def _put_r2(path: str, data: bytes, content_type: str) -> dict:
    s3 = _get_s3()
    params = {
        "Bucket": _BUCKET_NAME,
        "Key": path,
        "Body": data,
        "ContentType": content_type or "application/octet-stream",
    }
    if _BUCKET_ACL:
        params["ACL"] = _BUCKET_ACL
    s3.put_object(**params)
    logger.info("[BUCKET] UPLOAD [%s] key=%s size=%s", _BUCKET_NAME, path, len(data))
    return {"path": path, "storage": "r2", "bucket": _BUCKET_NAME}


def _get_r2(path: str) -> Tuple[bytes, str]:
    from botocore.exceptions import ClientError

    s3 = _get_s3()
    try:
        result = s3.get_object(Bucket=_BUCKET_NAME, Key=path)
    except ClientError as exc:
        err = exc.response.get("Error", {}) if exc.response else {}
        code = err.get("Code")
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") if exc.response else None
        if status == 404 or code in ("NoSuchKey", "NotFound", "404"):
            raise FileNotFoundError(path) from exc
        raise
    body = result["Body"].read()
    ctype = result.get("ContentType") or "application/octet-stream"
    logger.info("[BUCKET] GET [%s] key=%s", _BUCKET_NAME, path)
    return body, ctype


def put_object(path: str, data: bytes, content_type: str) -> dict:
    init_storage()
    if _USE_R2:
        return _put_r2(path, data, content_type)
    return _put_local(path, data, content_type)


def get_object(path: str) -> Tuple[bytes, str]:
    init_storage()
    if _USE_R2:
        try:
            return _get_r2(path)
        except FileNotFoundError:
            try:
                return _get_local(path)
            except FileNotFoundError:
                raise
    return _get_local(path)


def get_object_or_none(path: str) -> Optional[Tuple[bytes, str]]:
    if not path:
        return None
    try:
        return get_object(path)
    except Exception:
        return None


def delete_object(path: str) -> bool:
    """Delete object from the active backend (best-effort for local)."""
    if not path:
        return False
    init_storage()
    if _USE_R2:
        s3 = _get_s3()
        s3.delete_object(Bucket=_BUCKET_NAME, Key=path)
        logger.info("[BUCKET] DELETE [%s] key=%s", _BUCKET_NAME, path)
        return True
    dest = LOCAL_ROOT / path
    if dest.exists():
        dest.unlink()
    meta = dest.with_suffix(dest.suffix + ".ctype")
    if meta.exists():
        meta.unlink()
    return True


def get_signed_url(path: str, expires_in: int = 3600) -> str:
    """Presigned GET URL (R2/S3 only)."""
    if not path:
        raise ValueError("path is required")
    if not _USE_R2:
        raise RuntimeError("Signed URLs require R2/S3 bucket configuration")
    s3 = _get_s3()
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": _BUCKET_NAME, "Key": path},
        ExpiresIn=expires_in,
    )
    logger.info("[BUCKET] SIGNED_URL [%s] key=%s expires=%ss", _BUCKET_NAME, path, expires_in)
    return url
