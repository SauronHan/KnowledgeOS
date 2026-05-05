from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from sqlalchemy.orm import Session
import magic
import os
import shutil
import re
from pathlib import Path

# 引入 Celery 任务
from app.tasks import process_via_graphify, process_via_wiki_engine, process_via_advanced_skills

from app.database import get_db, SessionLocal
from app.models import Document, User, Project
from app.routers.auth import get_current_user, get_project_id

router = APIRouter(tags=["Ingest"])

UPLOAD_DIR = "data/raw_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def normalize_filename(filename: str) -> str:
    """标准化文件名：转小写，去除所有非法特殊字符，保留中英文数字和句点"""
    name, ext = os.path.splitext(filename)
    # \u4e00-\u9fa5 匹配所有中文字符
    normalized_name = re.sub(r'[^a-z0-9\u4e00-\u9fa5\.]', '', name.lower())
    if not normalized_name:
        normalized_name = "unnamed_document"
    return normalized_name + ext.lower()

@router.post("/")
async def upload_and_ingest(
    file: UploadFile = File(...), 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project_id: int = Depends(get_project_id)
):
    """
    Upload a file and intelligently route it to the correct processing engine.
    Includes deduplication logic based on normalized filename and user isolation.
    """
    norm_filename = normalize_filename(file.filename)
    
    # Project-level isolation in file system
    project = db.query(Project).filter(Project.id == project_id).first()
    project_uuid = project.uuid if project else "default"
    
    user_upload_dir = os.path.join(UPLOAD_DIR, f"user_{current_user.id}", f"project_{project_uuid}", "sources")
    os.makedirs(user_upload_dir, exist_ok=True)
    file_path = os.path.join(user_upload_dir, norm_filename)
    
    # Save file
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    # Detect MIME type
    mime = magic.Magic(mime=True)
    mime_type = mime.from_file(file_path)

    # 检查数据库中是否已存在该同名文件（排重）
    existing_doc = db.query(Document).filter(
        Document.filename == norm_filename,
        Document.user_id == current_user.id,
        Document.project_id == project_id
    ).first()
    
    if existing_doc:
        # 重置旧记录状态
        existing_doc.status = "pending"
        existing_doc.mime_type = mime_type
        existing_doc.extracted_data = None
        db.commit()
        db.refresh(existing_doc)
        doc_id = existing_doc.id
        final_filename = norm_filename
    else:
        # 存入新数据库记录，状态设为 pending
        new_doc = Document(
            filename=norm_filename,
            mime_type=mime_type,
            file_path=file_path,
            status="pending",
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            project_id=project_id
        )
        db.add(new_doc)
        db.commit()
        db.refresh(new_doc)
        doc_id = new_doc.id
        final_filename = norm_filename

    # Intelligent Routing Logic (Dispatch to Celery Queue)
    if mime_type.startswith("text/") or mime_type in ["application/json", "application/yaml", "application/xml"]:
        # Further distinguish between Code/Config (Graphify) and Prose (Wiki)
        if norm_filename.endswith(('.py', '.js', '.ts', '.go', '.rs', '.json', '.yaml', '.yml')):
            process_via_graphify.delay(file_path, mime_type, doc_id)
            engine = "Graphify (AST/Config)"
        else:
            process_via_wiki_engine.delay(file_path, mime_type, doc_id)
            engine = "LLM-Wiki (2-step CoT)"
            
    elif mime_type.startswith("video/") or mime_type.startswith("audio/"):
        process_via_graphify.delay(file_path, mime_type, doc_id)
        engine = "Graphify (Whisper)"
        
    elif mime_type in [
        "application/pdf", 
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document", # docx
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", # xlsx
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" # pptx
    ]:
        process_via_advanced_skills.delay(file_path, mime_type, doc_id)
        engine = "Advanced Skills + LLM-Wiki"
        
    else:
        process_via_wiki_engine.delay(file_path, mime_type, doc_id)
        engine = "LLM-Wiki (Fallback)"

    return {
        "status": "success",
        "message": "File received and queued for processing.",
        "filename": final_filename,
        "document_id": doc_id,
        "assigned_engine": engine
    }

@router.post("/{document_id}/reprocess")
def reprocess_document(
    document_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    手动重试处理处于失败或已完成状态的文档
    """
    doc = db.query(Document).filter(
        Document.id == document_id,
        Document.user_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    if doc.status in ["processing", "pending"]:
        raise HTTPException(status_code=400, detail="Document is already in process queue")
        
    # 重置状态
    doc.status = "pending"
    doc.extracted_data = None
    db.commit()
    
    mime_type = doc.mime_type
    file_path = doc.file_path
    norm_filename = doc.filename
    
    # Intelligent Routing Logic (Dispatch to Celery Queue)
    if mime_type.startswith("text/") or mime_type in ["application/json", "application/yaml", "application/xml"]:
        if norm_filename.endswith(('.py', '.js', '.ts', '.go', '.rs', '.json', '.yaml', '.yml')):
            process_via_graphify.delay(file_path, mime_type, document_id)
            engine = "Graphify (AST/Config)"
        else:
            process_via_wiki_engine.delay(file_path, mime_type, document_id)
            engine = "LLM-Wiki (2-step CoT)"
            
    elif mime_type.startswith("video/") or mime_type.startswith("audio/"):
        process_via_graphify.delay(file_path, mime_type, document_id)
        engine = "Graphify (Whisper)"
        
    elif mime_type in [
        "application/pdf", 
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ]:
        process_via_advanced_skills.delay(file_path, mime_type, document_id)
        engine = "Advanced Skills + LLM-Wiki"
        
    else:
        process_via_wiki_engine.delay(file_path, mime_type, document_id)
        engine = "LLM-Wiki (Fallback)"

    return {
        "status": "success",
        "message": "Document re-queued for processing.",
        "document_id": document_id,
        "assigned_engine": engine
    }
