"""
三级降级 URL 正文获取链 (Fetch Chain)

Level 1 — 静态抓取：safe_fetch_text + trafilatura (支持 Cookie 注入)
Level 2 — Jina Reader：云 Playwright，免费 500 RPM，支持 JS 渲染
Level 3 — Tavily Extract：已有 API Key，advanced 模式带 JS 渲染

Usage:
    from app.services.url_fetcher import fetch_url_content
    title, markdown = fetch_url_content(url, db)
"""

import os
import re
import urllib.error
import urllib.parse
import urllib.request

import yaml
from sqlalchemy.orm import Session

from graphify.security import validate_url, safe_fetch_text
from app.models import PlatformCookie

# --- Config ---

CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "data",
    "models_config.yaml",
)

JINA_READER_BASE = "https://r.jina.ai/"
TAVILY_EXTRACT_URL = "https://api.tavily.com/extract"

QUALITY_MIN_CHARS = 200  # 正文低于此阈值则降级到下一层


def _get_tavily_api_key() -> str:
    if not os.path.exists(CONFIG_PATH):
        return ""
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data.get("api_keys", {}).get("TAVILY_API_KEY", "")


# --- Cookie helpers ---

def _get_cookies_for_domain(url: str, db: Session) -> dict[str, str]:
    """从数据库读取该域名匹配的 Cookie，返回 headers dict。
    自动检测过期 cookie 并标记状态。"""
    from datetime import datetime, timezone
    parsed = urllib.parse.urlparse(url)
    hostname = parsed.hostname or ""
    cookies = db.query(PlatformCookie).filter(PlatformCookie.status == "active").all()
    for c in cookies:
        if c.expires_at and c.expires_at < datetime.now(timezone.utc):
            c.status = "expired"
            db.commit()
            continue
        if hostname == c.domain or hostname.endswith("." + c.domain):
            headers = {"Cookie": c.cookie_value}
            if c.extra_headers:
                headers.update(c.extra_headers)
            return headers
    return {}


# --- Level 1: Static fetch + trafilatura ---

def _extract_zhihu_content(html: str, url: str) -> str | None:
    """从知乎页面的 js-initialData JSON 中提取文章正文。"""
    import json
    match = re.search(r'<script id="js-initialData"[^>]*>(.*?)</script>', html, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
        state = data.get("initialState", data)
        # 尝试多种知乎数据结构
        article = None
        entities = state.get("entities", {})
        articles = entities.get("articles", {})
        if articles:
            article = next(iter(articles.values()))
        if not article:
            article = state.get("article", {})

        title = article.get("title", "")
        content_html = article.get("content", "")

        if not content_html:
            return None

        # 简单 HTML → Markdown 转换
        content = re.sub(r'<img[^>]+src="([^"]+)"[^>]*>', r'\n![](\1)\n', content_html)
        content = re.sub(r'<figure[^>]*>.*?</figure>', '', content, flags=re.DOTALL)
        content = re.sub(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', r'[\2](\1)', content)
        content = re.sub(r'<(h[12])[^>]*>(.*?)</\1>', r'\n\n## \2\n\n', content, flags=re.DOTALL)
        content = re.sub(r'<p[^>]*>(.*?)</p>', r'\n\1\n', content, flags=re.DOTALL)
        content = re.sub(r'<br\s*/?>', '\n', content)
        content = re.sub(r'<(b|strong)[^>]*>(.*?)</\1>', r'**\2**', content, flags=re.DOTALL)
        content = re.sub(r'<(em|i)[^>]*>(.*?)</\1>', r'*\2*', content, flags=re.DOTALL)
        content = re.sub(r'<[^>]+>', '', content)
        content = re.sub(r'\n{3,}', '\n\n', content).strip()

        if title and content:
            return f"# {title}\n\n{content}"
    except (json.JSONDecodeError, KeyError, TypeError):
        pass
    return None


# 常见 JS-disabled 提示文本，匹配到则降级到 Jina Reader
_JS_DISABLED_PATTERNS = [
    "JavaScript is disabled",
    "enable JavaScript",
    "请开启 JavaScript",
    "please enable javascript",
    "unsupported browser",
    "enable JavaScript to continue",
]


def _is_javascript_required_page(text: str) -> bool:
    """检测是否为需要 JS 渲染的页面（提取出了提示文字而非正文）。"""
    lower = text.lower()
    return any(p.lower() in lower for p in _JS_DISABLED_PATTERNS)


def _is_js_required_url(url: str) -> bool:
    """判断该 URL 对应的网站是否一定需要 JS 渲染。"""
    lower = url.lower()
    return any(d in lower for d in ("x.com/", "twitter.com/", "bilibili.com/read/", "bilibili.com/opus/"))


def _fetch_level1(url: str, db: Session) -> str | None:
    """静态 HTTP 抓取 + trafilatura 正文提取。返回 Markdown 或 None。"""
    try:
        extra_headers = _get_cookies_for_domain(url, db)
        html = safe_fetch_text(url, extra_headers=extra_headers)

        # 一定需要 JS 的网站，不在 Level 1 浪费请求
        if _is_js_required_url(url):
            return None

        # 知乎特殊处理：从初始 JSON 提取更完整的正文
        lower = url.lower()
        if "zhuanlan.zhihu.com" in lower and extra_headers:
            zhihu_content = _extract_zhihu_content(html, url)
            if zhihu_content:
                return zhihu_content

        import trafilatura
        result = trafilatura.extract(
            html,
            output_format="markdown",
            include_links=False,
            include_images=False,
            include_tables=True,
            include_formatting=True,
        )
        if result and len(result.strip()) > QUALITY_MIN_CHARS:
            if _is_javascript_required_page(result):
                return None  # 误判，降级到 Jina Reader
            return result
    except Exception:
        pass
    return None


# --- Level 2: Jina Reader ---

def _fetch_level2(url: str, db: Session) -> str | None:
    """通过 Jina Reader API 获取（支持 JS 渲染 + Cookie 转发）。"""
    try:
        target = JINA_READER_BASE + url
        headers = {
            "Accept": "text/markdown",
            "X-Return-Format": "markdown",
        }
        extra = _get_cookies_for_domain(url, db)
        if "Cookie" in extra:
            headers["X-Set-Cookie"] = extra["Cookie"]

        req = urllib.request.Request(target, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            if body and len(body.strip()) > QUALITY_MIN_CHARS:
                return body
    except Exception:
        pass
    return None


# --- Level 3: Tavily Extract ---

def _fetch_level3(url: str) -> str | None:
    """通过 Tavily Extract API 兜底（advanced 模式带 JS 渲染）。"""
    api_key = _get_tavily_api_key()
    if not api_key:
        return None
    try:
        import httpx
        resp = httpx.post(
            TAVILY_EXTRACT_URL,
            json={"urls": [url], "extract_depth": "advanced"},
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )
        if resp.status_code == 200:
            data = resp.json()
            results = data.get("results", [])
            if results:
                content = results[0].get("raw_content", "")
                if content and len(content.strip()) > QUALITY_MIN_CHARS:
                    return content
    except Exception:
        pass
    return None


# --- 提取标题 ---

def _extract_title(html_or_md: str, url: str) -> str:
    """从内容中提取标题。"""
    # Try HTML <title>
    match = re.search(r"<title[^>]*>(.*?)</title>", html_or_md, re.IGNORECASE | re.DOTALL)
    if match:
        title = re.sub(r"\s+", " ", match.group(1)).strip()
        if title and len(title) > 2:
            return title[:100]
    # Try Markdown H1
    match = re.search(r"^#\s+(.+)$", html_or_md, re.MULTILINE)
    if match:
        return match.group(1).strip()[:100]
    # Fallback
    parsed = urllib.parse.urlparse(url)
    return parsed.netloc.replace("www.", "")


# --- 主入口 ---

def fetch_url_content(url: str, db: Session) -> dict:
    """
    三级获取链主入口。

    Returns:
        {
            "title": str,
            "markdown": str,
            "level": int,       # 1/2/3 表示哪一级成功
            "level_name": str,  # "trafilatura" / "Jina Reader" / "Tavily Extract"
            "elapsed_ms": int,
        }

    Raises:
        RuntimeError: 三级全部失败
    """
    import time
    start = time.time()
    validate_url(url)

    result = _fetch_level1(url, db)
    if result:
        elapsed = int((time.time() - start) * 1000)
        return {
            "title": _extract_title(result, url),
            "markdown": result,
            "level": 1,
            "level_name": "trafilatura",
            "elapsed_ms": elapsed,
        }

    result = _fetch_level2(url, db)
    if result:
        elapsed = int((time.time() - start) * 1000)
        return {
            "title": _extract_title(result, url),
            "markdown": result,
            "level": 2,
            "level_name": "Jina Reader",
            "elapsed_ms": elapsed,
        }

    result = _fetch_level3(url)
    if result:
        elapsed = int((time.time() - start) * 1000)
        return {
            "title": _extract_title(result, url),
            "markdown": result,
            "level": 3,
            "level_name": "Tavily Extract",
            "elapsed_ms": elapsed,
        }

    raise RuntimeError(
        f"All three fetch levels failed for {url!r}. "
        "The content may require authentication (add platform cookies in Admin) "
        "or the site may block automated access."
    )
