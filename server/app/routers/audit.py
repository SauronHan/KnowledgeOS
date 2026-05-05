from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List

from app.database import get_db
from app.models import Document, AuditLog, User
from app.lancedb_client import insert_document_summary

router = APIRouter(prefix="/audit", tags=["Audit"])

class AuditRequest(BaseModel):
    checker_id: int
    status: str # "approved" or "rejected"
    comments: str = ""

@router.get("/pending")
def list_pending_audits(db: Session = Depends(get_db)):
    """
    获取所有需要人工复核的图谱知识点 (Maker-Checker 机制)
    """
    docs = db.query(Document).filter(Document.status == "audit_required").all()
    return {"status": "success", "data": [{"id": d.id, "filename": d.filename, "extracted_data": d.extracted_data} for d in docs]}

@router.post("/{document_id}/review")
def review_document(document_id: int, request: AuditRequest, db: Session = Depends(get_db)):
    """
    Checker 审批入库请求
    """
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    if doc.status != "audit_required":
        raise HTTPException(status_code=400, detail=f"Document is not pending audit. Current status: {doc.status}")

    # 确保 checker_id 对应的用户存在（应对前端传写死的 1 的情况）
    checker = db.query(User).filter(User.id == request.checker_id).first()
    if not checker:
        dummy_user = User(id=request.checker_id, username=f"dummy_admin_{request.checker_id}", role="admin")
        db.add(dummy_user)
        db.commit() # 必须先 commit 以便有外键参考

    # 记录审批日志
    audit_log = AuditLog(
        document_id=document_id,
        checker_id=request.checker_id,
        status=request.status,
        comments=request.comments
    )
    db.add(audit_log)
    
    # 更改文档状态
    if request.status == "approved":
        doc.status = "completed"
        # 触发 LanceDB 实际写入图谱和向量的操作
        if doc.extracted_data and isinstance(doc.extracted_data, dict):
            # 获取 step2 generation 的 summary_markdown
            summary = doc.extracted_data.get("generation", {}).get("summary_markdown", "")
            if summary:
                # 为了不阻塞接口返回，这里可以放到后台，但为了演示直接调用
                insert_document_summary(doc.id, doc.project_id, doc.filename, summary)
                
    elif request.status == "rejected":
        doc.status = "rejected"
        
    db.commit()
    
    return {"status": "success", "message": f"Document {document_id} marked as {request.status}"}
