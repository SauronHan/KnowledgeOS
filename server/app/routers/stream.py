from app.models import User, Document
from app.database import SessionLocal
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from app.routers.auth import get_current_user
from app.redis_client import async_redis
import asyncio

router = APIRouter(tags=["Stream"])

@router.get("/stream/documents/{document_id}/logs")
async def stream_document_logs(
    document_id: int,
    current_user: User = Depends(get_current_user)
):
    # 校验文档归属，确保安全隔离
    with SessionLocal() as db:
        doc = db.query(Document).filter(Document.id == document_id, Document.user_id == current_user.id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
            
    """
    Server-Sent Events (SSE) 接口。
    前端可以通过 EventSource 监听这个接口，获取 Celery 节点实时发布的大模型解析动态。
    """
    async def event_generator():
        pubsub = async_redis.pubsub()
        channel = f"doc_logs:{document_id}"
        await pubsub.subscribe(channel)
        
        try:
            while True:
                # 异步等待 Redis 消息
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message:
                    data = message["data"].decode("utf-8")
                    # SSE 格式要求以 "data: {}\n\n" 发送
                    yield f"data: {data}\n\n"
                    
                    # 定义停止符，告诉前端可以断开连接了
                    if data.startswith("[DONE]") or data.startswith("[ERROR]"):
                        break
                        
                # 防止堵塞事件循环
                await asyncio.sleep(0.05)
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")
