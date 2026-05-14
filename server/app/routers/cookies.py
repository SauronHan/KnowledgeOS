from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone

from app.database import get_db
from app.models import PlatformCookie, User
from app.routers.auth import get_current_user

router = APIRouter(prefix="/admin/platform-cookies", tags=["Admin - Platform Cookies"])


def _require_admin(current_user: User):
    if current_user.role != "system":
        raise HTTPException(status_code=403, detail="System access required")


class CookieCreate(BaseModel):
    domain: str
    cookie_value: str
    format: Optional[str] = "header_string"
    extra_headers: Optional[dict] = None
    description: Optional[str] = None
    expires_at: Optional[datetime] = None


class CookieUpdate(BaseModel):
    cookie_value: Optional[str] = None
    format: Optional[str] = None
    extra_headers: Optional[dict] = None
    description: Optional[str] = None
    status: Optional[str] = None
    expires_at: Optional[datetime] = None


@router.get("/")
def list_cookies(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    cookies = db.query(PlatformCookie).order_by(PlatformCookie.domain).all()
    return {
        "status": "success",
        "data": [
            {
                "id": c.id,
                "domain": c.domain,
                "cookie_value": c.cookie_value,
                "format": c.format or "header_string",
                "extra_headers": c.extra_headers,
                "description": c.description,
                "status": c.status,
                "expires_at": str(c.expires_at) if c.expires_at else None,
                "created_at": str(c.created_at) if c.created_at else None,
                "updated_at": str(c.updated_at) if c.updated_at else None,
            }
            for c in cookies
        ],
    }


@router.post("/")
def create_cookie(
    body: CookieCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)

    existing = db.query(PlatformCookie).filter(PlatformCookie.domain == body.domain).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Cookie for '{body.domain}' already exists")

    cookie = PlatformCookie(
        domain=body.domain,
        cookie_value=body.cookie_value,
        format=body.format or "header_string",
        extra_headers=body.extra_headers,
        description=body.description,
        expires_at=body.expires_at,
        status="active",
    )
    db.add(cookie)
    db.commit()
    db.refresh(cookie)

    return {
        "status": "success",
        "data": {
            "id": cookie.id,
            "domain": cookie.domain,
            "status": cookie.status,
        },
        "message": f"Cookie for '{body.domain}' created",
    }


@router.put("/{cookie_id}")
def update_cookie(
    cookie_id: int,
    body: CookieUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)

    cookie = db.query(PlatformCookie).filter(PlatformCookie.id == cookie_id).first()
    if not cookie:
        raise HTTPException(status_code=404, detail="Cookie not found")

    if body.cookie_value is not None:
        cookie.cookie_value = body.cookie_value
    if body.format is not None:
        cookie.format = body.format
    if body.extra_headers is not None:
        cookie.extra_headers = body.extra_headers
    if body.description is not None:
        cookie.description = body.description
    if body.status is not None:
        cookie.status = body.status
    if body.expires_at is not None:
        cookie.expires_at = body.expires_at

    cookie.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {"status": "success", "message": f"Cookie for '{cookie.domain}' updated"}


@router.delete("/{cookie_id}")
def delete_cookie(
    cookie_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)

    cookie = db.query(PlatformCookie).filter(PlatformCookie.id == cookie_id).first()
    if not cookie:
        raise HTTPException(status_code=404, detail="Cookie not found")

    domain = cookie.domain
    db.delete(cookie)
    db.commit()

    return {"status": "success", "message": f"Cookie for '{domain}' deleted"}
