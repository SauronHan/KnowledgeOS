from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from app.database import get_db
from app.routers.auth import get_current_user, get_project_id
from app.models import ConceptNode, User

router = APIRouter(tags=["Concepts"])


@router.get("/concepts")
def list_concepts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project_id: Optional[int] = Depends(get_project_id)
):
    if not project_id:
        raise HTTPException(status_code=400, detail="X-Project-Id header is required")
    """获取指定项目下的所有有效概念节点"""
    nodes = db.query(ConceptNode).filter(
        ConceptNode.project_id == project_id,
        ConceptNode.status == "active"
    ).all()
    
    return {
        "status": "success",
        "data": [
            {
                "id": n.id,
                "name": n.name,
                "entity_type": n.entity_type,
                "description": n.description,
                "has_rich_content": n.rich_content is not None and len(n.rich_content or "") > 0,
                "source_document_id": n.source_document_id,
            }
            for n in nodes
        ]
    }


@router.get("/concepts/{concept_id}")
def get_concept(
    concept_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project_id: Optional[int] = Depends(get_project_id)
):
    """获取单个概念节点的完整内容（包括 rich_content）"""
    query = db.query(ConceptNode).filter(
        ConceptNode.id == concept_id,
        ConceptNode.status == "active"
    )
    if project_id:
        query = query.filter(ConceptNode.project_id == project_id)
    
    node = query.first()
    
    if not node:
        raise HTTPException(status_code=404, detail="Concept node not found")
    
    # 优先返回 rich_content，如果没有则用 description 构建
    content = node.rich_content
    if not content:
        content = f"# {node.name}\n\n**Type**: {node.entity_type}\n\n{node.description or ''}"
    
    return {
        "status": "success",
        "data": {
            "id": node.id,
            "name": node.name,
            "entity_type": node.entity_type,
            "description": node.description,
            "rich_content": content,
            "source_document_id": node.source_document_id,
        }
    }
