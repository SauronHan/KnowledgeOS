from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional
import os
import re
import yaml
from datetime import datetime
from app.database import get_db
from app.models import Document, User, Project
from app.routers.auth import get_current_user, get_project_id, check_project_write_permission
from app.tasks import process_via_wiki_engine
import litellm
import json
import logging
from app.lancedb_client import search_documents

router = APIRouter(tags=["Chat Proxy"])
logger = logging.getLogger(__name__)

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "models_config.yaml")
_keys_loaded = False


def _load_api_keys_once():
    """将 models_config.yaml 中的 API Keys 注入 os.environ，供 LiteLLM 使用。
    只执行一次（模块级懒加载）。"""
    global _keys_loaded
    if _keys_loaded:
        return
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            full_config = yaml.safe_load(f) or {}
        api_keys = full_config.get("api_keys", {})
        for key, val in api_keys.items():
            if val:
                os.environ[key] = str(val)
        _keys_loaded = True
    except Exception as e:
        logger.warning(f"Failed to load API keys from config: {e}")


def _get_chat_model_from_config() -> str:
    """从 models_config.yaml 读取 chat_model，失败时回退 deepseek/deepseek-chat。"""
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return data.get("models", {}).get("chat_model", "openrouter/deepseek/deepseek-v4-flash")
    except Exception:
        return "openrouter/deepseek/deepseek-v4-flash"


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    current_user: User = Depends(get_current_user),
    project_id: Optional[int] = Depends(get_project_id)
):
    """
    OpenAI-compatible proxy endpoint.
    Takes frontend payload, uses backend API keys via LiteLLM,
    and returns a streaming response.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    _load_api_keys_once()

    raw_model = body.get("model")
    if not raw_model:
        raw_model = _get_chat_model_from_config()

    # LiteLLM needs the provider prefix (e.g., gemini/, deepseek/).
    # Only add prefix if the model doesn't already have one.
    if "/" in raw_model:
        model = raw_model           # already has provider prefix like openrouter/xxx
    elif "gemini" in raw_model:
        model = f"gemini/{raw_model}"
    elif "deepseek" in raw_model:
        model = f"deepseek/{raw_model}"
    else:
        model = raw_model
         
    logger.info(f"Chat Proxy: Incoming model '{body.get('model')}', using LiteLLM model '{model}'")
    print(f"[Chat] RESOLVED MODEL: {model}", flush=True)
        
    messages = body.get("messages", [])
    stream = body.get("stream", False)
    
    try:
        if stream:
            async def generate():
                try:
                    response = await litellm.acompletion(
                        model=model,
                        messages=messages,
                        stream=True
                    )
                    async for chunk in response:
                        # chunk is an object that has model_dump_json()
                        yield f"data: {chunk.model_dump_json()}\n\n"
                    yield "data: [DONE]\n\n"
                except Exception as e:
                    logger.error(f"Chat Proxy Streaming Error: {e}")
                    error_data = json.dumps({"error": {"message": str(e)}})
                    yield f"data: {error_data}\n\n"
            
            return StreamingResponse(generate(), media_type="text/event-stream")
        else:
            response = await litellm.acompletion(
                model=model,
                messages=messages,
                stream=False
            )
            return response.model_dump()
            
    except Exception as e:
        logger.error(f"Chat Proxy Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/chat/rag")
async def chat_rag(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project_id: Optional[int] = Depends(get_project_id)
):
    if not project_id:
        raise HTTPException(status_code=400, detail="X-Project-Id header is required")
        
    """
    RAG Logic Backendification:
    Intercepts the user query, searches LanceDB for context,
    assembles the system prompt, and streams the answer with citations.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    _load_api_keys_once()

    raw_model = body.get("model")
    if not raw_model:
        raw_model = _get_chat_model_from_config()
        
    if "/" in raw_model:
        model = raw_model
    elif "gemini" in raw_model:
        model = f"gemini/{raw_model}"
    elif "deepseek" in raw_model:
        model = f"deepseek/{raw_model}"
    else:
        model = raw_model
         
    messages = body.get("messages", [])
    if not messages:
        raise HTTPException(status_code=400, detail="No messages provided")
        
    latest_msg = messages[-1].get("content", "")
    
    # 1. Vector Search (Project Isolated)
    results = search_documents(latest_msg, project_id=project_id, top_k=5)
    
    # 2. Build Context
    context_str = ""
    refs = []
    
    if results:
        for i, r in enumerate(results):
            doc_id = r.get("document_id")
            filename = r.get("filename")
            summary = r.get("summary_markdown", "")
            context_str += f"### [{i+1}] {filename}\n{summary}\n\n"
            refs.append({"id": doc_id, "path": str(doc_id), "title": filename})
    else:
        context_str = "No relevant context found in the knowledge base."
        
    system_prompt = f"""You are KnowledgeOS, an intelligent enterprise knowledge base assistant.
Answer the user's question based strictly on the following context.
If the answer is not in the context, say so honestly. Do not invent information.

CONTEXT:
{context_str}

At the end of your response, list the sources you used using bracketed numbers, for example:
Sources: [1], [2]
"""
    
    # 3. Assemble Messages
    final_messages = [{"role": "system", "content": system_prompt}] + messages
    
    # 4. Stream response
    async def generate():
        try:
            # Emit custom refs event
            yield f"data: {json.dumps({'type': 'refs', 'refs': refs})}\n\n"
            
            response = await litellm.acompletion(
                model=model,
                messages=final_messages,
                stream=True
            )
            async for chunk in response:
                yield f"data: {chunk.model_dump_json()}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"Chat RAG Streaming Error: {e}")
            error_data = json.dumps({"error": {"message": str(e)}})
            yield f"data: {error_data}\n\n"
            
    return StreamingResponse(generate(), media_type="text/event-stream")

@router.post("/chat/save")
async def save_chat_to_wiki(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project_id: int = Depends(get_project_id)
):
    """
    Saves a chat/query as a markdown document to the user's isolated storage
    and triggers the wiki extraction pipeline.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
        
    title = body.get("title", "Saved Query")
    content = body.get("content", "")
    
    if not content:
        raise HTTPException(status_code=400, detail="Content cannot be empty")
        
    # 1. Normalize title for filename
    safe_title = re.sub(r'[^a-zA-Z0-9\u4e00-\u9fa5]', '-', title).strip('-')
    safe_title = safe_title[:50]
    if not safe_title:
        safe_title = "saved_query"
        
    date_str = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"{safe_title}-{date_str}.md"
    
    # 2. Prepare user storage directory
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    # 检查写权限
    check_project_write_permission(current_user, project)
    
    project_uuid = project.uuid
    
    user_dir = f"data/raw_uploads/user_{current_user.id}/project_{project_uuid}/wiki/queries"
    os.makedirs(user_dir, exist_ok=True)
    file_path = os.path.join(user_dir, filename)
    
    # 3. Write file
    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")
        
    # 4. Insert into database
    new_doc = Document(
        filename=filename,
        mime_type="text/markdown",
        file_path=file_path,
        status="pending",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        project_id=project_id
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)
    
    # 5. Trigger background analysis task
    process_via_wiki_engine.delay(file_path, "text/markdown", new_doc.id)
    
    relative_path = f"project_{project_uuid}/wiki/queries/{filename}"
    
    return {
        "status": "success",
        "message": "Chat saved and queued for analysis.",
        "document_id": new_doc.id,
        "filename": filename,
        "saved_path": relative_path
    }
