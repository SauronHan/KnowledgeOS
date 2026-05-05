import os
import requests
import litellm
import yaml
from pathlib import Path
from bs4 import BeautifulSoup
from duckduckgo_search import DDGS

from app.redis_client import publish_log

# 读取模型配置
CONFIG_PATH = Path(__file__).parent.parent.parent / "data" / "models_config.yaml"

def load_config_and_inject_keys():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            full_config = yaml.safe_load(f) or {}
    except:
        full_config = {}
        
    api_keys = full_config.get("api_keys", {})
    for key, val in api_keys.items():
        if val:
            os.environ[key] = str(val)
            
    return full_config.get("models", {}).get("deep_researcher", "gemini/gemini-2.5-pro")

def run_deep_research(queries: list, document_id: int) -> dict:
    """
    服务端 Agent：根据大模型提出的深研问题，自动去互联网爬取最新资料，并融合总结。
    """
    research_model = load_config_and_inject_keys()
    publish_log(document_id, f" -> [Deep Research Agent] Awakened. Target queries: {queries} (Model: {research_model})")
    
    results = {}
    ddgs = DDGS()
    
    # 为了防止消耗过高，最多只研究前 3 个核心问题
    for query in queries[:3]:
        publish_log(document_id, f" -> [Agent] Searching Web: {query}")
        try:
            # 走无头代理搜寻最相关的 2 个页面
            search_results = list(ddgs.text(query, max_results=2))
            context_texts = []
            
            for res in search_results:
                url = res.get('href')
                publish_log(document_id, f" -> [Agent] Extracting content from: {url}")
                try:
                    # 模拟真实浏览器抓取
                    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
                    resp = requests.get(url, timeout=5, headers=headers)
                    soup = BeautifulSoup(resp.text, 'lxml')
                    text = soup.get_text(separator=' ', strip=True)
                    # 仅保留前 2000 个字符的精华，防止撑爆 Token 上下文
                    context_texts.append(f"Source: {url}\nContent: {text[:2000]}")
                except Exception as e:
                    publish_log(document_id, f" -> [Agent] Fetch warning on {url}: {e}")
            
            if not context_texts:
                publish_log(document_id, f" -> [Agent] No readable content found for {query}")
                continue

            # 呼叫超大杯模型（如 Gemini 2.5 Pro）进行阅读理解与综合
            publish_log(document_id, f" -> [Agent] Summarizing web findings...")
            prompt = (
                f"You are a Knowledge Base Agent. Based on the following raw web search results for the query '{query}', "
                f"write a concise, highly technical summary. Extract any new entities or facts. "
                f"If the results are garbage, simply say 'No useful insights found.'\n\n"
            ) + "\n\n".join(context_texts)
            
            response = litellm.completion(
                model=research_model,
                messages=[
                    {"role": "system", "content": "You are a brilliant researcher."},
                    {"role": "user", "content": prompt}
                ]
            )
            
            summary = response.choices[0].message.content
            results[query] = summary
            publish_log(document_id, f" -> [Agent] Finding acquired: {summary[:60]}...")
            
        except Exception as e:
            publish_log(document_id, f" -> [Agent Error] Search failed for '{query}': {e}")
            
    publish_log(document_id, " -> [Deep Research Agent] Sleep.")
    return results
