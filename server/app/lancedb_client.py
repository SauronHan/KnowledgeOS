import lancedb
from lancedb.pydantic import Vector, LanceModel
import os
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from pydantic import Field
from typing import List, Optional
import pyarrow as pa

load_dotenv()

# LanceDB 本地存储目录
LANCEDB_DIR = "data/lancedb"
os.makedirs(LANCEDB_DIR, exist_ok=True)

# 初始化 LanceDB 客户端
db = lancedb.connect(LANCEDB_DIR)

# 初始化本地 SentenceTransformers 模型用于向量化
# all-MiniLM-L6-v2 是最成熟的轻量级模型，输出 384 维向量
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
# 懒加载模型，避免启动卡顿
_embedder = None

def get_embedder():
    global _embedder
    if _embedder is None:
        # 强制使用 CPU，避免在 Mac 的 Celery (prefork) 模式下引发 MPSGraphObject 崩溃
        _embedder = SentenceTransformer(EMBEDDING_MODEL, device="cpu")
    return _embedder

def get_embedding(text: str) -> List[float]:
    """使用 SentenceTransformer 获取文本的 Embedding"""
    model = get_embedder()
    # encode() 返回 numpy 数组，转换为 list
    return model.encode(text).tolist()

# 定义向量表结构 (all-MiniLM-L6-v2 维度是 384)
class DocumentSummary(LanceModel):
    document_id: int
    project_id: int
    filename: str
    summary_markdown: str
    vector: Vector(384) = Field(description="Embedding of the summary_markdown") # type: ignore

def init_or_get_table():
    if "document_summaries" not in db.table_names():
        # 如果表不存在则创建
        return db.create_table("document_summaries", schema=DocumentSummary)
    return db.open_table("document_summaries")

def insert_document_summary(document_id: int, project_id: int, filename: str, summary_markdown: str):
    """
    将大模型生成的 Markdown 摘要进行向量化，存入 LanceDB 中
    """
    if not summary_markdown.strip():
        return
        
    print(f"[LanceDB] Generating embedding for Document ID: {document_id}")
    try:
        vec = get_embedding(summary_markdown)
        table = init_or_get_table()
        
        # 插入数据
        table.add([
            {
                "document_id": document_id,
                "project_id": project_id,
                "filename": filename,
                "summary_markdown": summary_markdown,
                "vector": vec
            }
        ])
        print(f"[LanceDB] Inserted summary for Document ID: {document_id}")
    except Exception as e:
        print(f"[LanceDB Error] Failed to insert: {e}")

def search_documents(query: str, project_id: Optional[int] = None, top_k: int = 5):
    """
    检索与问题最相关的文档摘要
    """
    try:
        query_vec = get_embedding(query)
        table = init_or_get_table()
        search_query = table.search(query_vec)
        if project_id is not None:
            search_query = search_query.where(f"project_id = {project_id}")
        results = search_query.limit(top_k).to_pandas()
        return results.to_dict('records')
    except Exception as e:
        print(f"[LanceDB Error] Search failed: {e}")
        return []
