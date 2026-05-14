from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from typing import Optional
from sqlalchemy.orm import Session
from pydantic import BaseModel
from passlib.context import CryptContext

from datetime import datetime, timezone
from app.database import get_db
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.models import User, Project, ProjectTenantAccess

router = APIRouter(tags=["Auth"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)

def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security), 
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    # Try getting token from query param if not in header
    raw_token = None
    if credentials:
        raw_token = credentials.credentials
    elif token:
        raw_token = token
        
    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
        
    # Simple mock token verification for MVP: "mock-jwt-token-{user_id}"
    if not raw_token.startswith("mock-jwt-token-"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication credentials")
    
    try:
        user_id = int(raw_token.replace("mock-jwt-token-", ""))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token format")
        
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is disabled")
    if user.expires_at and user.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account has expired")
        
    return user

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    status: str
    token: str
    user: dict

@router.post("/auth/login", response_model=LoginResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    
    if not pwd_context.verify(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
        
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")
        
    if user.expires_at and user.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account has expired")
    
    # In a real app, generate a JWT token. For this MVP, we return a simple mock token.
    # The frontend will store this and the user details.
    mock_token = f"mock-jwt-token-{user.id}"
    
    return {
        "status": "success",
        "token": mock_token,
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role,
            "tenant_id": user.tenant_id
        }
    }


def get_project_id(request: Request) -> Optional[int]:
    """
    从请求 header 中提取 X-Project-Id。
    所有项目级隔离的接口都应依赖此函数。
    """
    project_id_str = request.headers.get("X-Project-Id")
    if project_id_str:
        try:
            return int(project_id_str)
        except ValueError:
            return None
    return None


def check_project_write_permission(current_user: User, project: Project):
    """
    检查用户是否对项目拥有写权限。
    - 私有项目：仅创建者可写。
    - 共享项目：仅 system 角色可写。
    """
    if project.visibility == "shared":
        if current_user.role != "system":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Read-only access. Only system users can modify shared projects."
            )
    else:
        if project.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied. You do not own this project."
            )
    return True


def check_project_read_permission(current_user: User, project: Project, db: Session):
    """
    检查用户是否有权读取/访问该项目。
    - 私有项目：仅创建者可访问。
    - 共享项目：用户的 tenant_id 在 ProjectTenantAccess 授权列表中，或用户为 system 角色。
    """
    if project.visibility == "private":
        if project.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this project."
            )
    else:
        if current_user.role == "system":
            return True
        access = db.query(ProjectTenantAccess).filter(
            ProjectTenantAccess.project_id == project.id,
            ProjectTenantAccess.tenant_id == current_user.tenant_id
        ).first()
        if not access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your tenant is not authorized to access this project."
            )
