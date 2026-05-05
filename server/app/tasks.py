import os
import json
from pathlib import Path
from .celery_app import celery_app

# 从内核引擎引入 Graphify 模块与 Wiki 模块、高级办公文档解析模块
from graphify import extract, transcribe
from core.wiki_engine.engine import run_two_step_cot_pipeline
from core.advanced_skills import parse_office_document

from app.lancedb_client import insert_document_summary

# 引入数据库与模型
from app.database import SessionLocal
from app.models import Document
from app.redis_client import publish_log

TRANSCRIPT_DIR = "data/transcripts"
os.makedirs(TRANSCRIPT_DIR, exist_ok=True)

@celery_app.task(bind=True, name="process_via_graphify")
def process_via_graphify(self, file_path: str, mime_type: str, document_id: int):
    """
    Delegate to Graphify engine for code, structured formats, or media.
    """
    publish_log(document_id, f"[Graphify Engine] Processing {file_path} (Type: {mime_type}, DocID: {document_id})")
    db = SessionLocal()
    doc = db.query(Document).filter(Document.id == document_id).first()
    if doc:
        doc.status = "processing"
        db.commit()
    path_obj = Path(file_path)
    
    try:
        if mime_type.startswith("video/") or mime_type.startswith("audio/"):
            # 调用 graphify 的 transcribe 模块进行本地处理
            publish_log(document_id, f" -> Transcribing audio/video via whisper...")
            transcript_path = transcribe.transcribe(
                path_obj, 
                cache_dir=Path(TRANSCRIPT_DIR), 
                prompt="", 
                model_name="base"
            )
            publish_log(document_id, f" -> Transcript saved to: {transcript_path}")
            # 转录完成后可作为常规文本文件传给下游图谱提取
            path_obj = transcript_path

        # 调用 graphify 的核心 AST/语义提取模块
        publish_log(document_id, " -> Extracting graph nodes and edges...")
        # extract 接受 list[Path]，这里传入单个文件
        extraction_result = extract.extract([path_obj])
        publish_log(document_id, f" -> Extraction complete. Found {len(extraction_result.get('nodes', []))} nodes.")
        
        # 将提取的 JSON 合并到 KnowledgeOS 数据库中
        if doc:
            doc.extracted_data = extraction_result
            doc.status = "completed"
            db.commit()
            
        publish_log(document_id, "[DONE] Graphify task complete.")
        return "SUCCESS"
    except Exception as e:
        publish_log(document_id, f"[ERROR] Graphify Error: {e}")
        if doc:
            doc.status = "failed"
            db.commit()
        return "FAILED"
    finally:
        db.close()

@celery_app.task(bind=True, name="process_via_wiki_engine")
def process_via_wiki_engine(self, file_path: str, mime_type: str, document_id: int):
    """
    Delegate to LLM-Wiki engine (2-step CoT) for natural language text, PDFs, etc.
    """
    publish_log(document_id, f"[LLM-Wiki Engine] Processing {file_path} (Type: {mime_type}, DocID: {document_id})")
    db = SessionLocal()
    doc = db.query(Document).filter(Document.id == document_id).first()
    if doc and doc.status == "pending":
        doc.status = "processing"
        db.commit()
    path_obj = Path(file_path)
    
    try:
        # 调用用 Python 重写的两步思维链生成管线
        publish_log(document_id, " -> Initiating 2-Step CoT via Gemini...")
        result = run_two_step_cot_pipeline(path_obj)
        
        if "error" in result:
            raise Exception(result["error"])
        
        # 处理审核队列与深度研究建议
        if result.get("generation", {}).get("requires_human_review"):
            publish_log(document_id, " -> [Audit Queue] Flagged for human review.")
            
        research_queries = result.get("generation", {}).get("suggested_research_queries", [])
        deep_research_results = {}
        if research_queries:
            publish_log(document_id, f" -> [Deep Research] Suggested queries: {research_queries}")
            try:
                from app.utils.deep_researcher import run_deep_research
                deep_research_results = run_deep_research(research_queries, document_id)
            except Exception as e:
                publish_log(document_id, f" -> [Deep Research Error] Agent failed fatally: {e}")
            
        # 保存为图数据库或 JSON
        if doc:
            doc.extracted_data = result
            if deep_research_results:
                doc.extracted_data["deep_research_results"] = deep_research_results
                
            if result.get("generation", {}).get("requires_human_review"):
                doc.status = "audit_required"
            else:
                doc.status = "completed"
                summary = result.get("generation", {}).get("summary_markdown", "")
                if summary:
                    publish_log(document_id, " -> Injecting vectors into LanceDB...")
                    insert_document_summary(document_id, doc.project_id, doc.filename, summary)
            db.commit()
            
            # --- SaaS Enrichment: Save concepts to database instead of physical files ---
            nodes = result.get("generation", {}).get("nodes_to_create", [])
            if nodes:
                publish_log(document_id, f" -> [Enrichment] Generating rich content for {len(nodes)} concepts in database...")
                
                from core.wiki_engine.engine import load_config_and_inject_keys
                from app.models import ConceptNode
                import litellm
                models = load_config_and_inject_keys()
                
                for node in nodes:
                    name = node.get("name")
                    desc = node.get("description")
                    if not name: continue
                    
                    # Generate rich content
                    enrich_prompt = f"""
                    You are a Knowledge Management Expert. Please write a detailed, professional wiki page for the following concept.
                    
                    Concept Name: {name}
                    Brief Description: {desc}
                    
                    Context from source document:
                    {result.get("generation", {}).get("summary_markdown", "")[:2000]}
                    
                    Instructions:
                    1. Use professional Markdown formatting.
                    2. Include sections like: Definition, Key Components, Relationships, and Practical Implications.
                    3. Ensure the tone is geeky but accessible.
                    4. Use [[wikilinks]] for any related terms.
                    5. Output ONLY the markdown content.
                    """
                    
                    try:
                        resp = litellm.completion(
                            model=models["step2"],
                            messages=[{"role": "user", "content": enrich_prompt}],
                            temperature=0.3
                        )
                        rich_md = resp.choices[0].message.content
                        
                        # Save to database
                        # Check if it exists in this project first to avoid duplicates
                        existing = db.query(ConceptNode).filter(
                            ConceptNode.name == name,
                            ConceptNode.project_id == doc.project_id
                        ).first()
                        
                        if existing:
                            existing.description = desc
                            existing.rich_content = rich_md
                            existing.source_document_id = document_id
                        else:
                            new_node = ConceptNode(
                                name=name,
                                entity_type=node.get("entity_type", "concept"),
                                description=desc,
                                rich_content=rich_md,
                                project_id=doc.project_id,
                                tenant_id=doc.tenant_id,
                                source_document_id=document_id
                            )
                            db.add(new_node)
                        
                        db.commit()
                        publish_log(document_id, f"    -> Saved concept to DB: {name}")
                    except Exception as e:
                        publish_log(document_id, f"    -> [Warning] Failed to enrich {name}: {e}")
                        db.rollback()

        publish_log(document_id, "[DONE] LLM-Wiki CoT extraction and enrichment complete.")
        return "SUCCESS"
    except Exception as e:
        publish_log(document_id, f"[ERROR] LLM-Wiki Error: {e}")
        if doc:
            doc.status = "failed"
            db.commit()
        return "FAILED"
    finally:
        db.close()

@celery_app.task(bind=True, name="process_via_advanced_skills")
def process_via_advanced_skills(self, file_path: str, mime_type: str, document_id: int):
    """
    Delegate to advanced system skills (pdf, docx, xlsx, pptx) for structured extraction.
    """
    publish_log(document_id, f"[Advanced Skills Engine] Extracting structure from {file_path} (Type: {mime_type}, DocID: {document_id})")
    db = SessionLocal()
    doc = db.query(Document).filter(Document.id == document_id).first()
    if doc:
        doc.status = "processing"
        db.commit()
    db.close() # close early because wiki_engine will open its own session
    try:
        publish_log(document_id, " -> Deep parsing office document layout and content...")
        extracted_text = parse_office_document(file_path, mime_type)
        if not extracted_text:
            publish_log(document_id, f" -> [Warning] Extracted text is empty for {file_path}")
            publish_log(document_id, "[ERROR] Extraction failed due to empty content.")
            return "EMPTY"
            
        # 保存提取后的文本为 Markdown 临时文件，交给 wiki_engine 接管
        path_obj = Path(file_path)
        extracted_path = path_obj.with_suffix('.extracted.md')
        
        with open(extracted_path, 'w', encoding='utf-8') as f:
            f.write(extracted_text)
            
        publish_log(document_id, f" -> Successfully extracted {len(extracted_text)} characters. Handing over to Wiki Engine...")
        # Since process_via_wiki_engine is a celery task, we can chain or call directly
        # Doing standard python call here is fine since we are already inside a celery worker
        # But dispatching it to queue is better for distribution
        process_via_wiki_engine.delay(str(extracted_path), "text/markdown", document_id)
        return "DELEGATED"
    except Exception as e:
        publish_log(document_id, f"[ERROR] Advanced Skills Error: {e}")
        db_err = SessionLocal()
        doc_err = db_err.query(Document).filter(Document.id == document_id).first()
        if doc_err:
            doc_err.status = "failed"
            db_err.commit()
        db_err.close()
        return "FAILED"
