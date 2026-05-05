from fastapi import APIRouter, Depends, HTTPException, Query as FastAPIQuery
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from pathlib import Path

from app.database import get_db
from app.models import Document, User
from app.lancedb_client import search_documents
from app.routers.auth import get_current_user, get_project_id
import httpx
import os
import yaml
from .config import CONFIG_PATH

router = APIRouter(tags=["Query"])

@router.get("/files/read")
def read_user_file(
    path: str,
    current_user: User = Depends(get_current_user)
):
    """
    SaaS Proxy: Read a file from the user's isolated storage (e.g., wiki/overview.md).
    """
    # Prevent directory traversal
    clean_path = os.path.normpath(path).lstrip("/")
    if ".." in clean_path or clean_path.startswith("/"):
         raise HTTPException(status_code=400, detail="Invalid path")
         
    user_base = f"data/raw_uploads/user_{current_user.id}"
    full_path = os.path.join(user_base, clean_path)
    
    if not os.path.exists(full_path):
        # Return empty instead of 404 for metadata files to avoid console noise
        return {"content": ""}
        
    try:
        with open(full_path, "r", encoding="utf-8") as f:
            return {"content": f.read()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SearchRequest(BaseModel):
    query: str
    top_k: int = 5

@router.get("/documents")
def list_documents(
    skip: int = 0, 
    limit: int = 20, 
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project_id: Optional[int] = Depends(get_project_id)
):
    if not project_id:
        raise HTTPException(status_code=400, detail="X-Project-Id header is required")
        
    query = db.query(Document).filter(
        Document.user_id == current_user.id,
        Document.project_id == project_id
    )
    if status:
        query = query.filter(Document.status == status)
    
    docs = query.order_by(Document.id.desc()).offset(skip).limit(limit).all()
    
    return {
        "status": "success",
        "total": query.count(),
        "data": [
            {
                "id": doc.id,
                "filename": doc.filename,
                "mime_type": doc.mime_type,
                "status": doc.status
            } for doc in docs
        ]
    }

from app.utils.graph_pruner import prune_graph_data

@router.get("/documents/{document_id}")
def get_document(
    document_id: int, 
    prune: bool = True, 
    max_nodes: int = 150,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project_id: Optional[int] = Depends(get_project_id)
):
    """
    获取特定文档的详情及大模型提取的完整知识结构（前端详情页用）
    支持 prune 剪枝参数，默认开启，防止客户端 WebGL 崩溃
    """
    query = db.query(Document).filter(
        Document.id == document_id, 
        Document.user_id == current_user.id
    )
    if project_id:
        query = query.filter(Document.project_id == project_id)
    doc = query.first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    extracted_data = doc.extracted_data
    if prune and extracted_data:
        extracted_data = prune_graph_data(extracted_data, max_nodes=max_nodes)
        
    return {
        "status": "success",
        "data": {
            "id": doc.id,
            "filename": doc.filename,
            "status": doc.status,
            "extracted_data": extracted_data
        }
    }

@router.get("/documents/{document_id}/content")
def get_document_content(
    document_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project_id: Optional[int] = Depends(get_project_id)
):
    """
    获取文档的 Markdown 内容或提取摘要（前端图谱点击源文件节点时使用）
    """
    query = db.query(Document).filter(
        Document.id == document_id, 
        Document.user_id == current_user.id
    )
    if project_id:
        query = query.filter(Document.project_id == project_id)
    doc = query.first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    content = f"# {doc.filename}\n\n"
    
    if doc.extracted_data and "generation" in doc.extracted_data:
        summary = doc.extracted_data["generation"].get("summary_markdown", "")
        if summary:
            content += summary + "\n\n"
            
    if doc.extracted_data and "analysis" in doc.extracted_data:
        takeaways = doc.extracted_data["analysis"].get("key_takeaways", [])
        if takeaways:
            content += "## Key Takeaways\n"
            for t in takeaways:
                content += f"- {t}\n"
                
    if doc.extracted_data and "deep_research_results" in doc.extracted_data:
        dr = doc.extracted_data["deep_research_results"]
        if dr:
            content += "\n## Deep Research Insights\n"
            for query, insight in dr.items():
                content += f"### {query}\n{insight}\n\n"
                
    if content == f"# {doc.filename}\n\n":
        content += "_No extracted summary available for this document._"
        
    return {
        "status": "success",
        "data": {
            "id": doc.id,
            "filename": doc.filename,
            "content": content
        }
    }

@router.post("/search")
def semantic_search(
    request: SearchRequest,
    project_id: Optional[int] = Depends(get_project_id)
):
    if not project_id:
        raise HTTPException(status_code=400, detail="X-Project-Id header is required")
        
    """
    基于 LanceDB 向量数据库进行语义搜索
    """
    results = search_documents(request.query, project_id=project_id, top_k=request.top_k)
    
    # 将 numpy array 或其他不可被 JSON 序列化的数据清洗掉，提取关键信息
    cleaned_results = []
    for r in results:
        # lancedb 返回的字典中可能有 vector 字段，我们不需要返回几百个维度的浮点数给前端
        item = {
            "document_id": r.get("document_id"),
            "filename": r.get("filename"),
            "summary_markdown": r.get("summary_markdown"),
            "score": r.get("_distance", 0.0) # _distance 越小相似度越高 (L2) 或是 cosine 距离
        }
        cleaned_results.append(item)
        
    return {
        "status": "success",
        "query": request.query,
        "results": cleaned_results
    }

@router.get("/documents/{document_id}/download")
def download_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project_id: Optional[int] = Depends(get_project_id)
):
    query = db.query(Document).filter(
        Document.id == document_id, 
        Document.user_id == current_user.id
    )
    if project_id:
        query = query.filter(Document.project_id == project_id)
    
    doc = query.first()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    file_path = Path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
        
    return FileResponse(
        path=str(file_path),
        filename=doc.filename,
        media_type=doc.mime_type or "application/octet-stream"
    )

@router.delete("/documents/{document_id}")
def delete_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project_id: Optional[int] = Depends(get_project_id)
):
    """
    Delete a document and its associated physical file.
    """
    query = db.query(Document).filter(
        Document.id == document_id, 
        Document.user_id == current_user.id
    )
    if project_id:
        query = query.filter(Document.project_id == project_id)
    doc = query.first()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    file_path = doc.file_path
    
    # Delete from DB
    db.delete(doc)
    db.commit()
    
    # Try delete physical file
    try:
        path = Path(file_path)
        if path.exists():
            path.unlink()
    except Exception as e:
        print(f"Failed to delete physical file {file_path}: {e}")
        
    return {"status": "success", "message": "Document deleted"}

@router.get("/web-search")
async def web_search_proxy(
    query: str,
    max_results: int = 10,
    current_user: User = Depends(get_current_user)
):
    """
    Proxy web search requests to Tavily using the server-side API key.
    """
    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=500, detail="Server configuration file missing")
        
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_data = yaml.safe_load(f) or {}
    
    api_key = config_data.get("api_keys", {}).get("TAVILY_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="Web Search (Tavily) is not configured on the server.")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": api_key,
                    "query": query,
                    "max_results": max_results,
                    "search_depth": "advanced",
                    "include_answer": False
                },
                timeout=30.0
            )
            response.raise_for_status()
            data = response.json()
            
            results = []
            for r in data.get("results", []):
                url = r.get("url", "")
                source = ""
                try:
                    from urllib.parse import urlparse
                    source = urlparse(url).netloc.replace("www.", "")
                except:
                    source = "web"
                    
                results.append({
                    "title": r.get("title", "Untitled"),
                    "url": url,
                    "snippet": r.get("content", ""),
                    "source": source
                })
                
            return {
                "status": "success",
                "results": results
            }
    except Exception as e:
        print(f"Web search error: {e}")
        raise HTTPException(status_code=500, detail=f"Web search failed: {str(e)}")



