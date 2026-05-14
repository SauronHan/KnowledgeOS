from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
import magic
import os
import shutil
import re
import urllib.parse
from pathlib import Path

# 引入 Celery 任务
from app.tasks import process_via_graphify, process_via_wiki_engine, process_via_advanced_skills

from app.database import get_db, SessionLocal
from app.models import Document, User, Project, PlatformCookie
from app.routers.auth import get_current_user, get_project_id, check_project_write_permission
from app.services.url_fetcher import fetch_url_content

# graphify URL 摄入 + 安全校验
from graphify.ingest import ingest as graphify_ingest, _detect_url_type
from graphify.security import validate_url

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
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    # 检查写权限
    check_project_write_permission(current_user, project)
    
    project_uuid = project.uuid
    
    if project.visibility == "shared":
        # 共享项目存放在统一的 shared 目录下
        user_upload_dir = os.path.join(UPLOAD_DIR, "shared", f"project_{project_uuid}", "sources")
    else:
        # 私有项目保持原有路径
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
    query = db.query(Document).filter(
        Document.filename == norm_filename,
        Document.project_id == project_id
    )
    # 如果是私有项目，额外检查 user_id
    if project.visibility != "shared":
        query = query.filter(Document.user_id == current_user.id)
        
    existing_doc = query.first()
    
    if existing_doc:
        # 已完成的文档不重置，直接返回；否则重置并重新处理
        if existing_doc.status == "completed":
            return {"status": "exists", "document_id": existing_doc.id, "filename": norm_filename}
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

class UrlIngestRequest(BaseModel):
    url: str



def _title_to_filename(title: str) -> str:
    """将标题转为安全文件名，保留中英文。"""
    name = re.sub(r'[\\/:*?"<>|]', '', title)
    name = re.sub(r'\s+', '_', name.strip())
    if not name:
        name = "untitled"
    return name[:80]


@router.post("/url")
async def ingest_url(
    body: UrlIngestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project_id: int = Depends(get_project_id)
):
    """
    从 URL 摄入源资料（YouTube/arXiv/网页等），自动检测类型后接入处理流水线。
    - 视频类（YouTube/B站）：yt-dlp 下载音频 → Whisper 转录
    - 网页类：三级获取链（静态+trafilatura → Jina Reader → Tavily Extract）
    - 原始 URL 保存到 database source_url 字段
    """
    # 1. URL 安全校验 (SSRF 防护)
    try:
        validate_url(body.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid URL: {e}")

    # 2. 项目权限
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    check_project_write_permission(current_user, project)

    if project.visibility == "shared":
        user_upload_dir = os.path.join(UPLOAD_DIR, "shared", f"project_{project.uuid}", "sources")
    else:
        user_upload_dir = os.path.join(UPLOAD_DIR, f"user_{current_user.id}", f"project_{project.uuid}", "sources")

    os.makedirs(user_upload_dir, exist_ok=True)

    url_type = _detect_url_type(body.url)

    # 3. 视频类型：yt-dlp 下载音频
    if url_type in ("youtube", "bilibili_video"):
        # 从 PlatformCookie 表获取视频平台 Cookie
        cookies_text = None
        parsed = urllib.parse.urlparse(body.url)
        hostname = parsed.hostname or ""
        cookie_record = (
            db.query(PlatformCookie)
            .filter(PlatformCookie.status == "active", PlatformCookie.domain == hostname)
            .first()
        )
        if cookie_record:
            if cookie_record.format == "netscape":
                cookies_text = cookie_record.cookie_value  # Netscape 直接可用
            else:
                # Header String → 转 Netscape 格式给 yt-dlp
                lines = ["# Netscape HTTP Cookie File (auto-converted)"]
                for item in cookie_record.cookie_value.split(";"):
                    item = item.strip()
                    if "=" in item:
                        name, val = item.split("=", 1)
                        lines.append(f"{hostname}\tTRUE\t/\tFALSE\t0\t{name}\t{val}")
                cookies_text = "\n".join(lines)

        try:
            downloaded_path = graphify_ingest(body.url, Path(user_upload_dir), cookies_text=cookies_text)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=f"Failed to fetch video: {e}")
        except Exception as e:
            msg = str(e)
            if "Sign in to confirm" in msg or "bot" in msg.lower():
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "Video platform requires authentication. "
                        "Add cookies in Admin → Platform Cookies."
                    )
                )
            raise HTTPException(status_code=500, detail=f"Unexpected error: {msg}")

        file_path = str(downloaded_path)
        norm_filename = os.path.basename(file_path)

    else:
        # 4. 网页/文章类型：三级获取链
        try:
            fetched = fetch_url_content(body.url, db)
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e))

        title = fetched["title"]
        clean_md = fetched["markdown"]
        fetch_level = fetched.get("level", 0)
        fetch_level_name = fetched.get("level_name", "unknown")
        fetch_elapsed = fetched.get("elapsed_ms", 0)

        safe_name = _title_to_filename(title)
        filename = f"{safe_name}.md"
        file_path = os.path.join(user_upload_dir, filename)
        counter = 1
        while os.path.exists(file_path) and counter < 100:
            filename = f"{safe_name}_{counter}.md"
            file_path = os.path.join(user_upload_dir, filename)
            counter += 1

        content = f"""---
source_url: {body.url}
title: "{title}"
type: {url_type}
---

{clean_md}
"""
        Path(file_path).write_text(content, encoding="utf-8")
        norm_filename = filename

    # 5. MIME 类型检测
    mime = magic.Magic(mime=True)
    mime_type = mime.from_file(file_path)

    # 6. 排重 + 入库
    query = db.query(Document).filter(
        Document.filename == norm_filename,
        Document.project_id == project_id
    )
    if project.visibility != "shared":
        query = query.filter(Document.user_id == current_user.id)

    existing_doc = query.first()

    if existing_doc:
        if existing_doc.status == "completed":
            return {"status": "exists", "document_id": existing_doc.id, "filename": norm_filename}
        existing_doc.status = "pending"
        existing_doc.mime_type = mime_type
        existing_doc.source_url = body.url
        existing_doc.extracted_data = None
        db.commit()
        doc_id = existing_doc.id
    else:
        new_doc = Document(
            filename=norm_filename,
            mime_type=mime_type,
            file_path=file_path,
            source_url=body.url,
            status="pending",
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            project_id=project_id
        )
        db.add(new_doc)
        db.commit()
        db.refresh(new_doc)
        doc_id = new_doc.id

    # 7. 智能路由 Dispatch
    if mime_type.startswith("video/") or mime_type.startswith("audio/"):
        process_via_graphify.delay(file_path, mime_type, doc_id)
        engine = "Graphify (Whisper)"
    elif mime_type.startswith("text/") or mime_type in ["application/json", "application/yaml", "application/xml"]:
        if norm_filename.endswith(('.py', '.js', '.ts', '.go', '.rs', '.json', '.yaml', '.yml')):
            process_via_graphify.delay(file_path, mime_type, doc_id)
            engine = "Graphify (AST/Config)"
        else:
            process_via_wiki_engine.delay(file_path, mime_type, doc_id)
            engine = "LLM-Wiki (2-step CoT)"
    elif mime_type in [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ]:
        process_via_advanced_skills.delay(file_path, mime_type, doc_id)
        engine = "Advanced Skills + LLM-Wiki"
    else:
        process_via_wiki_engine.delay(file_path, mime_type, doc_id)
        engine = "LLM-Wiki (Fallback)"

    return {
        "status": "success",
        "message": "URL content fetched and queued for processing.",
        "filename": norm_filename,
        "document_id": doc_id,
        "assigned_engine": engine,
        "source_url": body.url,
        "fetch_level": fetch_level if url_type not in ("youtube", "bilibili_video") else 0,
        "fetch_level_name": fetch_level_name if url_type not in ("youtube", "bilibili_video") else "yt-dlp",
        "fetch_elapsed_ms": fetch_elapsed if url_type not in ("youtube", "bilibili_video") else 0,
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
        Document.id == document_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # 获取项目对象并检查权限
    project = db.query(Project).filter(Project.id == doc.project_id).first()
    if project:
        check_project_write_permission(current_user, project)
        
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
