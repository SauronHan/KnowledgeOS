from fastapi import APIRouter, Depends
from typing import Optional
from sqlalchemy.orm import Session
from app.database import get_db
from app.routers.auth import get_current_user, get_project_id
from app.models import Document, User, ConceptNode
import logging

router = APIRouter(tags=["Graph"])
logger = logging.getLogger(__name__)

@router.get("/graph")
def get_global_graph(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project_id: Optional[int] = Depends(get_project_id)
):
    if not project_id:
        raise HTTPException(status_code=400, detail="X-Project-Id header is required")

    # 构建文档查询（按项目隔离）
    doc_query = db.query(Document).filter(
        Document.status == "completed",
        Document.user_id == current_user.id,
        Document.project_id == project_id
    )
    
    docs = doc_query.all()
    
    nodes_map = {}
    edges_map = {}

    def normalize_id(name: str):
        if not name:
            return "unknown"
        return name.strip().lower().replace(" ", "-")

    # 1. 从 ConceptNode 表读取所有概念节点
    concept_query = db.query(ConceptNode).filter(
        ConceptNode.project_id == project_id,
        ConceptNode.status == "active"
    )
    
    concept_nodes = concept_query.all()
    
    for cn in concept_nodes:
        n_id = normalize_id(cn.name)
        nodes_map[n_id] = {
            "id": n_id,
            "label": cn.name,
            "type": cn.entity_type or "concept",
            "concept_db_id": cn.id,  # 前端用这个 ID 调用 /concepts/{id}
            "description": cn.description or "",
            "linkCount": 0,
            "community": 0
        }

    # 2. 遍历文档，构建文档节点和边
    for doc in docs:
        doc_id_str = f"doc_{doc.id}"
        
        # 文档节点
        nodes_map[doc_id_str] = {
            "id": doc_id_str,
            "label": doc.filename,
            "type": "source",
            "path": str(doc.id),
            "linkCount": 0,
            "community": 0
        }
        
        if not doc.extracted_data:
            continue
            
        # 从 extracted_data 中提取关系
        if "generation" in doc.extracted_data:
            gen = doc.extracted_data["generation"]
            
            # 文档 → 概念 的边
            for n in gen.get("nodes_to_create", []):
                name = n.get("name", "")
                n_id = normalize_id(name)
                
                # 如果 ConceptNode 表里没有这个节点（可能是旧数据），补充一个虚拟节点
                if n_id not in nodes_map:
                    nodes_map[n_id] = {
                        "id": n_id,
                        "label": name,
                        "type": n.get("entity_type", "concept").lower(),
                        "description": n.get("description", ""),
                        "linkCount": 0,
                        "community": 0
                    }
                
                edge_key = f"{doc_id_str}:::{n_id}"
                edges_map[edge_key] = {
                    "source": doc_id_str,
                    "target": n_id,
                    "relation": "mentions",
                    "weight": 1.0
                }
                
            # 概念 ↔ 概念 的边
            for e in gen.get("edges_to_create", []):
                src = normalize_id(e.get("source", ""))
                tgt = normalize_id(e.get("target", ""))
                if not src or not tgt:
                    continue
                edge_key = f"{src}:::{tgt}"
                if edge_key not in edges_map:
                    edges_map[edge_key] = {
                        "source": src,
                        "target": tgt,
                        "relation": e.get("relation", ""),
                        "weight": 1.0
                    }
                else:
                    edges_map[edge_key]["weight"] += 0.5
                    
        # Graphify 格式
        if "nodes" in doc.extracted_data and "edges" in doc.extracted_data:
            for n in doc.extracted_data["nodes"]:
                n_id = n.get("id", "")
                if n_id not in nodes_map:
                    nodes_map[n_id] = {
                        "id": n_id,
                        "label": n.get("label", n_id),
                        "type": n.get("file_type", "code").lower(),
                        "description": "",
                        "linkCount": 0,
                        "community": 0
                    }
                    
                edge_key = f"{doc_id_str}:::{n_id}"
                edges_map[edge_key] = {
                    "source": doc_id_str,
                    "target": n_id,
                    "relation": "contains",
                    "weight": 1.0
                }
                    
            for e in doc.extracted_data["edges"]:
                src = e.get("source", "")
                tgt = e.get("target", "")
                edge_key = f"{src}:::{tgt}"
                if edge_key not in edges_map:
                    edges_map[edge_key] = {
                        "source": src,
                        "target": tgt,
                        "relation": e.get("relation", ""),
                        "weight": e.get("weight", 1.0)
                    }
                else:
                    edges_map[edge_key]["weight"] += e.get("weight", 1.0)

    final_nodes = list(nodes_map.values())
    final_edges = list(edges_map.values())
    
    return {
        "status": "success",
        "data": {
            "nodes": final_nodes,
            "edges": final_edges
        }
    }
