from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import yaml
import os
import re

router = APIRouter(prefix="/config", tags=["Config"])

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "models_config.yaml")

class APIKeysConfig(BaseModel):
    GEMINI_API_KEY: str = ""
    DEEPSEEK_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    OPENROUTER_API_KEY: str = ""
    TAVILY_API_KEY: str = ""
    OMLX_API_BASE: str = ""
    OLLAMA_API_BASE: str = ""

class ModelsConfig(BaseModel):
    step1_extractor: str = ""
    step2_graph_maker: str = ""
    deep_researcher: str = ""
    chat_model: str = ""
    translator_model: str = ""

class ConfigUpdateRequest(BaseModel):
    api_keys: APIKeysConfig
    models: ModelsConfig

@router.get("/models")
def get_models_config():
    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="Config file not found")
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return {
        "status": "success", 
        "data": {
            "api_keys": data.get("api_keys", {}),
            "models": data.get("models", {})
        }
    }

@router.post("/models")
def update_models_config(req: ConfigUpdateRequest):
    # Prepare dictionary to dump
    data = {
        "api_keys": req.api_keys.model_dump(),
        "models": req.models.model_dump()
    }
    
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
        
    return {"status": "success", "message": "Config updated"}
