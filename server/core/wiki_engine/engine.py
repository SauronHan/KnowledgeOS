import os
import json
import yaml
import litellm
from pathlib import Path
from dotenv import load_dotenv

from .schemas import Step1AnalysisOutput, Step2GenerationOutput
from .prompts import STEP1_SYSTEM_PROMPT, STEP2_SYSTEM_PROMPT, STEP3_TRANSLATOR_PROMPT

# 加载环境变量 (包括多模型的 API Keys)
load_dotenv()

# 读取多模型路由表
CONFIG_PATH = Path(__file__).parent.parent.parent / "data" / "models_config.yaml"

def load_config_and_inject_keys():
    """动态读取 YAML 配置文件，注入 API Keys 并返回模型路由配置"""
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            full_config = yaml.safe_load(f) or {}
    except Exception as e:
        print(f"[Warning] Failed to load models_config.yaml, using defaults. {e}")
        full_config = {}
        
    # Inject API Keys into os.environ
    api_keys = full_config.get("api_keys", {})
    for key, val in api_keys.items():
        if val:  # Only inject if not empty
            os.environ[key] = str(val)
            
    models_config = full_config.get("models", {})
    return {
        "step1": models_config.get("step1_extractor", "gemini/gemini-2.5-flash"),
        "step2": models_config.get("step2_graph_maker", "gemini/gemini-2.5-flash"),
        "translator": models_config.get("translator_model", "gemini/gemini-2.5-flash")
    }

def robust_json_parse(text: str) -> dict:
    """鲁棒性 JSON 解析器：自动剥除大模型习惯性添加的 Markdown ```json 前后缀"""
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError as e:
        print(f"[Warning] JSON Parsing failed: {e}\nRaw Text:\n{text[:200]}")
        raise

def run_two_step_cot_pipeline(file_path: Path, wiki_context: str = "") -> dict:
    """
    Executes the 2-step Chain-of-Thought pipeline using Gemini Structured Outputs.
    """
    print(f"    [Wiki Engine] Reading text from {file_path}")
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            raw_text = f.read()
    except Exception as e:
        return {"error": f"Failed to read file: {e}"}

    try:
        # 每次执行前动态加载最新的配置并注入环境变量
        models_routing = load_config_and_inject_keys()
        step1_model = models_routing["step1"]
        step2_model = models_routing["step2"]
        translator_model = models_routing["translator"]
        
        # Step 1: 分析矛盾与结构
        print(f"    [Wiki Engine] Executing Step 1 (Model: {step1_model})...")
        step1_messages = [
            {"role": "system", "content": STEP1_SYSTEM_PROMPT + f"\n\nJSON Schema:\n{json.dumps(Step1AnalysisOutput.model_json_schema())}\n\nYou MUST return a valid JSON object matching the schema."},
            {"role": "user", "content": f"Raw Source Text:\n{raw_text}\n\nWiki Context:\n{wiki_context}"}
        ]
        
        step1_response = litellm.completion(
            model=step1_model,
            messages=step1_messages,
            response_format={"type": "json_object"},
            temperature=0.2
        )
        
        step1_text = step1_response.choices[0].message.content
        parsed_json1 = robust_json_parse(step1_text)
        if isinstance(parsed_json1, list) and len(parsed_json1) > 0:
            parsed_json1 = parsed_json1[0]
        step1_result = Step1AnalysisOutput.model_validate(parsed_json1)

        # Step 2: 依据分析结果生成图谱节点和边
        print(f"    [Wiki Engine] Step 1 finished. Executing Step 2 (Model: {step2_model})...")
        step2_messages = [
            {"role": "system", "content": STEP2_SYSTEM_PROMPT + f"\n\nJSON Schema:\n{json.dumps(Step2GenerationOutput.model_json_schema())}\n\nYou MUST return a valid JSON object matching the schema."},
            {"role": "user", "content": f"Source Text:\n{raw_text}\n\nStep 1 Context:\n{step1_result.model_dump_json()}"}
        ]
        
        step2_response = litellm.completion(
            model=step2_model,
            messages=step2_messages,
            response_format={"type": "json_object"},
            temperature=0.3
        )
        
        step2_text = step2_response.choices[0].message.content
        parsed_json2 = robust_json_parse(step2_text)
        if isinstance(parsed_json2, list) and len(parsed_json2) > 0:
            parsed_json2 = parsed_json2[0]
            
        # Step 3: 节点翻译为中文
        print(f"    [Wiki Engine] Step 2 finished. Executing Step 3 (Translation) (Model: {translator_model})...")
        step3_messages = [
            {"role": "system", "content": STEP3_TRANSLATOR_PROMPT + f"\n\nJSON Schema:\n{json.dumps(Step2GenerationOutput.model_json_schema())}"},
            {"role": "user", "content": f"JSON to translate:\n{json.dumps(parsed_json2, ensure_ascii=False)}"}
        ]
        
        step3_response = litellm.completion(
            model=translator_model,
            messages=step3_messages,
            response_format={"type": "json_object"},
            temperature=0.1
        )
        
        step3_text = step3_response.choices[0].message.content
        parsed_json3 = robust_json_parse(step3_text)
        if isinstance(parsed_json3, list) and len(parsed_json3) > 0:
            parsed_json3 = parsed_json3[0]
            
        # Ensure it conforms to the Step2GenerationOutput schema
        final_result = Step2GenerationOutput.model_validate(parsed_json3)

        print("    [Wiki Engine] 3-Step CoT Extraction & Translation Complete.")
        return {
            "analysis": step1_result.model_dump(),
            "generation": final_result.model_dump()
        }
        
    except Exception as e:
        print(f"    [Wiki Engine Error] {e}")
        return {"error": str(e)}
