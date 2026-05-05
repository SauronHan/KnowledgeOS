from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

from app.database import get_db
from app.models import User, Tenant
from app.routers.auth import pwd_context
from datetime import datetime

router = APIRouter(tags=["Users and Tenants"])

# --- Schemas ---

class TenantCreate(BaseModel):
    name: str
    description: Optional[str] = None

class TenantResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None

    class Config:
        orm_mode = True

class UserCreate(BaseModel):
    username: str
    password: Optional[str] = None
    role: str # admin, maker, checker, employee
    tenant_id: int
    is_active: bool = True
    expires_at: Optional[datetime] = None

class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool
    expires_at: Optional[datetime] = None
    tenant_id: Optional[int] = None
    tenant_name: Optional[str] = None

    class Config:
        orm_mode = True

# --- Tenant Routes ---

@router.get("/tenants", response_model=dict)
def get_tenants(db: Session = Depends(get_db)):
    tenants = db.query(Tenant).all()
    return {
        "status": "success",
        "data": [{"id": t.id, "name": t.name, "description": t.description} for t in tenants]
    }

@router.post("/tenants", response_model=dict)
def create_tenant(req: TenantCreate, db: Session = Depends(get_db)):
    existing = db.query(Tenant).filter(Tenant.name == req.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Tenant name already exists")
    
    tenant = Tenant(name=req.name, description=req.description)
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return {"status": "success", "data": {"id": tenant.id, "name": tenant.name}}

# --- User Routes ---

@router.get("/users", response_model=dict)
def get_users(db: Session = Depends(get_db)):
    users = db.query(User).all()
    result = []
    for u in users:
        tenant_name = u.tenant.name if u.tenant else None
        result.append({
            "id": u.id,
            "username": u.username,
            "role": u.role,
            "is_active": u.is_active,
            "expires_at": u.expires_at,
            "tenant_id": u.tenant_id,
            "tenant_name": tenant_name
        })
    return {"status": "success", "data": result}

@router.post("/users", response_model=dict)
def create_user(req: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.username == req.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
        
    tenant = db.query(Tenant).filter(Tenant.id == req.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant does not exist")
        
    hashed_pwd = pwd_context.hash(req.password) if req.password else None
    user = User(
        username=req.username, 
        role=req.role, 
        tenant_id=req.tenant_id,
        hashed_password=hashed_pwd,
        is_active=req.is_active,
        expires_at=req.expires_at
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"status": "success", "data": {"id": user.id, "username": user.username, "role": user.role}}

@router.put("/users/{user_id}", response_model=dict)
def update_user(user_id: int, req: UserCreate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    user.username = req.username
    user.role = req.role
    user.tenant_id = req.tenant_id
    user.is_active = req.is_active
    user.expires_at = req.expires_at
    
    if req.password:
        user.hashed_password = pwd_context.hash(req.password)
        
    db.commit()
    db.refresh(user)
    return {"status": "success", "data": {"id": user.id, "username": user.username, "role": user.role}}

@router.delete("/users/{user_id}", response_model=dict)
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    db.delete(user)
    db.commit()
    return {"status": "success", "message": f"User {user_id} deleted"}
