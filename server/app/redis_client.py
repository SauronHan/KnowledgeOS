import os
import redis
import redis.asyncio as aioredis
from dotenv import load_dotenv

load_dotenv()
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6380/0")

# 给 Celery Worker 用的同步 Redis 客户端
sync_redis = redis.from_url(REDIS_URL)

# 给 FastAPI SSE 接口用的异步 Redis 客户端
async_redis = aioredis.from_url(REDIS_URL)

def publish_log(document_id: int, message: str):
    """
    向 Redis Channel 发布实时解析日志，供前端打字机效果消费
    """
    channel = f"doc_logs:{document_id}"
    sync_redis.publish(channel, message)
    # 同时保留终端打印
    print(message)
