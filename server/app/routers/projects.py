from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.database import get_db
from app.routers.auth import get_current_user
from app.models import Project, User

router = APIRouter(tags=["Projects"])


class ProjectSync(BaseModel):
    uuid: str
    name: str


@router.post("/projects")
def sync_project(
    body: ProjectSync,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    同步前端项目到后端。如果 UUID 已存在则更新名称，否则创建新记录。
    前端创建项目和打开项目时都会调用此接口。
    """
    existing = db.query(Project).filter(
        Project.uuid == body.uuid,
        Project.user_id == current_user.id
    ).first()
    
    if existing:
        existing.name = body.name
        if existing.status == "deleted":
            existing.status = "active"  # 恢复已删除的项目
        db.commit()
        db.refresh(existing)
        return {
            "status": "success",
            "project_id": existing.id,
            "uuid": existing.uuid,
            "name": existing.name
        }
    
    new_project = Project(
        uuid=body.uuid,
        name=body.name,
        tenant_id=current_user.tenant_id,
        user_id=current_user.id
    )
    db.add(new_project)
    db.commit()
    db.refresh(new_project)
    
    return {
        "status": "success",
        "project_id": new_project.id,
        "uuid": new_project.uuid,
        "name": new_project.name
    }


@router.get("/projects")
def list_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取当前用户的所有有效项目"""
    projects = db.query(Project).filter(
        Project.user_id == current_user.id,
        Project.status == "active"
    ).all()
    
    return {
        "status": "success",
        "data": [
            {
                "id": p.id,
                "uuid": p.uuid,
                "name": p.name,
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
        Project.id == project_id,
        Project.user_id == current_user.id
    ).first()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    project.status = "deleted"
    db.commit()
    
    return {"status": "success", "message": "Project archived."}
