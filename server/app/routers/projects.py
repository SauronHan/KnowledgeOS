import os
import re
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from app.database import get_db
from app.routers.auth import get_current_user, check_project_write_permission
from app.models import Project, User, ProjectTenantAccess, Tenant

SHARED_PACKAGES_DIR = "/app/shared_packages"

router = APIRouter(tags=["Projects"])


class ProjectSync(BaseModel):
    uuid: str
    name: str
    target_tenant_ids: Optional[List[int]] = None


@router.post("/projects")
def sync_project(
    body: ProjectSync,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    同步前端项目到后端。如果 UUID 已存在则更新名称，否则创建新记录。
    - 传入 target_tenant_ids（非空列表）时创建共享项目并授权指定 Tenant
    - system 才可创建共享项目
    - 不传 target_tenant_ids 时创建私有项目
    - UUID 已存在（由其他用户创建）时直接返回已有项目，不重复创建
    """
    existing = db.query(Project).filter(
        Project.uuid == body.uuid,
        Project.user_id == current_user.id
    ).first()
    
    if existing:
        existing.name = body.name
        if existing.status == "deleted":
            existing.status = "active"
        db.commit()
        db.refresh(existing)
        return {
            "status": "success",
            "project_id": existing.id,
            "uuid": existing.uuid,
            "name": existing.name
        }

    # UUID 可能已被其他用户创建（如共享项目），直接返回已有记录
    existing_global = db.query(Project).filter(Project.uuid == body.uuid).first()
    if existing_global:
        return {
            "status": "success",
            "project_id": existing_global.id,
            "uuid": existing_global.uuid,
            "name": existing_global.name
        }

    # 共享项目判定：以指定 Tenant 列表
    wants_shared = body.target_tenant_ids is not None and len(body.target_tenant_ids) > 0
    visibility = "shared" if wants_shared else "private"

    new_project = Project(
        uuid=body.uuid,
        name=body.name,
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        visibility=visibility
    )
    db.add(new_project)
    db.commit()
    db.refresh(new_project)

    # 共享项目：创建 ProjectTenantAccess 授权记录
    if visibility == "shared":
        if current_user.role != "system":
            raise HTTPException(status_code=403, detail="Only system can create shared projects")
        for tid in body.target_tenant_ids:
            db.add(ProjectTenantAccess(project_id=new_project.id, tenant_id=tid))
        db.commit()
    
    return {
        "status": "success",
        "project_id": new_project.id,
        "uuid": new_project.uuid,
        "name": new_project.name,
        "visibility": new_project.visibility
    }


@router.get("/projects")
def list_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取当前用户可见的所有有效项目（私有 + 被授权的共享项目）"""
    from sqlalchemy import or_

    if current_user.role == "system":
        projects = db.query(Project).filter(
            Project.status == "active",
            or_(
                Project.user_id == current_user.id,
                Project.visibility == "shared"
            )
        ).all()
    else:
        projects = db.query(Project).filter(
            Project.status == "active",
            or_(
                Project.user_id == current_user.id,
                Project.id.in_(
                    db.query(ProjectTenantAccess.project_id).filter(
                        ProjectTenantAccess.tenant_id == current_user.tenant_id
                    )
                )
            )
        ).all()
    
    return {
        "status": "success",
        "data": [
            {
                "id": p.id,
                "uuid": p.uuid,
                "name": p.name,
                "visibility": p.visibility,
                "is_readonly": p.visibility == "shared" and current_user.role != "system",
                "package_version": p.package_version or 0,
                "package_filename": p.package_filename,
                "created_at": str(p.created_at) if p.created_at else None
            }
            for p in projects
        ]
    }


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """软删除项目（设置 status=deleted，不物理删除）"""
    project = db.query(Project).filter(
        Project.id == project_id
    ).first()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    check_project_write_permission(current_user, project)
    
    project.status = "deleted"
    db.commit()
    
    return {"status": "success", "message": "Project archived."}


# --- 共享项目授权管理接口 ---

class ProjectAccessUpdate(BaseModel):
    tenant_ids: List[int]


@router.get("/projects/{project_id}/access")
def get_project_access(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取共享项目的已授权 Tenant 列表"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.visibility != "shared":
        raise HTTPException(status_code=400, detail="This project is not a shared project")

    accesses = db.query(ProjectTenantAccess).filter(
        ProjectTenantAccess.project_id == project_id
    ).all()
    tenant_ids = [a.tenant_id for a in accesses]
    tenants = db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all() if tenant_ids else []

    return {
        "status": "success",
        "data": {
            "project_id": project_id,
            "tenant_ids": tenant_ids,
            "tenants": [{"id": t.id, "name": t.name} for t in tenants]
        }
    }


@router.put("/projects/{project_id}/access")
def update_project_access(
    project_id: int,
    body: ProjectAccessUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """覆盖式更新共享项目的 Tenant 授权列表（仅 system）"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.visibility != "shared":
        raise HTTPException(status_code=400, detail="This project is not a shared project")
    if current_user.role != "system":
        raise HTTPException(status_code=403, detail="Only system can modify project access")

    # 删除旧授权记录
    db.query(ProjectTenantAccess).filter(
        ProjectTenantAccess.project_id == project_id
    ).delete()

    # 创建新授权记录
    for tid in body.tenant_ids:
        db.add(ProjectTenantAccess(project_id=project_id, tenant_id=tid))
    db.commit()

    return {
        "status": "success",
        "message": f"Access updated for project {project_id}",
        "tenant_ids": body.tenant_ids
    }


# ── 共享项目压缩包分发 ──

def _validate_package_filename(filename: str) -> None:
    """防止目录穿越攻击。只允许安全文件名。"""
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename: path traversal not allowed")
    if not re.match(r'^[\w\-. ]+\.zip$', filename):
        raise HTTPException(status_code=400, detail="Invalid filename: must be *.zip with alphanumeric/hyphen/underscore/dot/space characters")


class PackagePublish(BaseModel):
    package_filename: str
    version: Optional[int] = None  # None = 自动 +1

class ProjectStatusUpdate(BaseModel):
    status: str  # active / archived


@router.get("/shared-projects/{project_id}/version")
def get_shared_project_version(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.visibility != "shared":
        raise HTTPException(status_code=400, detail="This project is not a shared project")

    # tenant 授权校验：system 或 project_tenant_access 中授权
    if current_user.role != "system":
        access = db.query(ProjectTenantAccess).filter(
            ProjectTenantAccess.project_id == project.id,
            ProjectTenantAccess.tenant_id == current_user.tenant_id
        ).first()
        if not access:
            raise HTTPException(status_code=403, detail="Your tenant is not authorized to access this project")

    # 文件存在性校验
    filename = project.package_filename
    version = project.package_version or 0
    size = 0
    if filename:
        file_path = os.path.join(SHARED_PACKAGES_DIR, filename)
        if os.path.isfile(file_path):
            size = os.path.getsize(file_path)
        else:
            version = 0

    return {
        "status": "success",
        "data": {
            "version": version,
            "package_filename": filename,
            "size": size,
            "updated_at": str(project.package_updated_at) if project.package_updated_at else None
        }
    }


@router.get("/shared-projects/{project_id}/download")
def download_shared_project_package(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.visibility != "shared":
        raise HTTPException(status_code=400, detail="This project is not a shared project")

    # tenant 授权校验：system 或 project_tenant_access 中授权
    if current_user.role != "system":
        access = db.query(ProjectTenantAccess).filter(
            ProjectTenantAccess.project_id == project.id,
            ProjectTenantAccess.tenant_id == current_user.tenant_id
        ).first()
        if not access:
            raise HTTPException(status_code=403, detail="Your tenant is not authorized to access this project")

    filename = project.package_filename
    if not filename:
        raise HTTPException(status_code=404, detail="No package has been published for this project")

    _validate_package_filename(filename)

    file_path = os.path.join(SHARED_PACKAGES_DIR, filename)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail=f"Package file not found: {filename}")

    return FileResponse(file_path, media_type="application/zip", filename=filename)


@router.put("/shared-projects/{project_id}/package")
def publish_shared_project_package(project_id: int, body: PackagePublish, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "system":
        raise HTTPException(status_code=403, detail="Only system can publish packages")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.visibility != "shared":
        raise HTTPException(status_code=400, detail="This project is not a shared project")

    _validate_package_filename(body.package_filename)

    file_path = os.path.join(SHARED_PACKAGES_DIR, body.package_filename)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=400, detail=f"File not found in shared_packages/: {body.package_filename}")

    from datetime import datetime, timezone
    project.package_filename = body.package_filename
    project.package_version = body.version if body.version is not None else (project.package_version or 0) + 1
    project.package_updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)

    return {
        "status": "success",
        "data": {
            "version": project.package_version,
            "package_filename": project.package_filename,
            "updated_at": str(project.package_updated_at)
        }
    }


@router.put("/projects/{project_id}/status")
def update_project_status(project_id: int, body: ProjectStatusUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "system":
        raise HTTPException(status_code=403, detail="Only system can change project status")

    if body.status not in ["active", "archived"]:
        raise HTTPException(status_code=400, detail="Status must be 'active' or 'archived'")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project.status = body.status
    db.commit()

    return {"status": "success", "message": f"Project status updated to {body.status}"}
