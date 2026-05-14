# KnowledgeOS API 接口文档 (v0.5.6)

本文档详细记录了 KnowledgeOS 后端提供的所有对外 API 接口。

## 基础信息
- **Base URL**: `http://localhost:8080/api/v1`
- **认证方式**: HTTP Bearer Token (Header: `Authorization: Bearer <token>`)
- **项目隔离**: 大部分业务接口需要提供项目 ID (Header: `X-Project-Id: <id>`)
- **管理员接口**: 标记 `system/admin` 的接口仅 system 或 admin 角色可调用

---

## 1. 认证与用户管理 (Auth & Users)

### 1.1 用户登录
- **接口**: `POST /auth/login`
- **认证**: 无
- **请求体**:
  ```json
  { "username": "admin", "password": "password123" }
  ```
- **响应**: 返回 mock JWT token 及用户信息。

### 1.2 获取租户列表
- **接口**: `GET /tenants`
- **认证**: Bearer Token
- **说明**: 系统管理接口，获取所有已注册租户。

### 1.3 用户角色
用户角色体系：`system` (跨租户超级管理员) > `admin` (租户管理员) > `maker` / `checker` / `employee`

### 1.4 用户管理 (CRUD)
- `GET /users` — 获取所有用户
- `POST /users` — 创建新用户（需 `tenant_id`, `role`）
- `PUT /users/{user_id}` — 更新用户信息
- `DELETE /users/{user_id}` — 删除用户

---

## 2. 项目管理 (Projects)

### 2.1 同步 / 创建项目
- **接口**: `POST /projects`
- **认证**: Bearer Token
- **请求体**:
  ```json
  {
    "uuid": "项目 UUID",
    "name": "项目名称",
    "target_tenant_ids": [1, 2, 3],       // 可选：指定租户（共享项目）
    "visible_to_all_tenants": false         // 可选：ALL 语义（所有租户可见）
  }
  ```
- **说明**: 前端创建或打开项目时调用。不传 `target_tenant_ids` 和 `visible_to_all_tenants` 时创建私有项目。共享项目仅 system/admin 可创建。
- **响应**: `{ "project_id": 1, "uuid": "...", "name": "...", "visibility": "private|shared" }`

### 2.2 获取项目列表
- **接口**: `GET /projects`
- **认证**: Bearer Token
- **响应字段**:
  ```json
  {
    "id": 1,
    "uuid": "...",
    "name": "...",
    "visibility": "private|shared",
    "is_readonly": false,
    "package_version": 0,
    "package_filename": "kb-v1.zip",
    "created_at": "2026-05-08T..."
  }
  ```
- **说明**: 返回用户可见的全部项目（私有 + 被授权的共享 + ALL 共享）。`is_readonly` 由当前用户角色动态计算。

### 2.3 删除 / 归档项目
- **接口**: `DELETE /projects/{project_id}`
- **说明**: 软删除（status → `deleted`）。system/admin 可删除共享项目。

### 2.4 项目状态管理
- **接口**: `PUT /projects/{project_id}/status`
- **认证**: system/admin
- **请求体**: `{ "status": "active|archived" }`

### 2.5 共享项目 — 租户授权管理
- **接口**: `GET /projects/{project_id}/access` — 获取已授权租户列表
- **接口**: `PUT /projects/{project_id}/access` — 覆盖式更新授权列表
- **认证**: system/admin
- **请求体**: `{ "tenant_ids": [1, 2, 3] }`

### 2.6 共享项目 — 压缩包分发

| 接口 | 方法 | 说明 |
|------|------|------|
| `/shared-projects/{project_id}/version` | GET | 获取最新版本号、包大小、更新时间 |
| `/shared-projects/{project_id}/download` | GET | 下载 ZIP 压缩包 |
| `/shared-projects/{project_id}/package` | PUT | 发布新版本 (system/admin) |

---

## 3. 资料导入 (Ingest)

### 3.1 文件上传
- **接口**: `POST /ingest/`
- **参数**: `file` (Multipart/form-data)
- **Header**: `X-Project-Id` (必填)
- **说明**: 智能路由分发 — 文本→LLM-Wiki、代码→AST Graphify、音视频→Whisper 转录、Office 文档→Advanced Skills
- **响应**: `{ "filename": "...", "document_id": 1, "assigned_engine": "LLM-Wiki (2-step CoT)" }`

### 3.2 URL 摄入 (v0.5.6 新增)
- **接口**: `POST /ingest/url`
- **Header**: `X-Project-Id` (必填)
- **请求体**: `{ "url": "https://..." }`
- **支持的 URL 类型**:

| 类型 | 处理管线 | 需要 Cookie |
|------|----------|:---:|
| YouTube (`youtube.com`, `youtu.be`) | yt-dlp 下载音频 → Whisper 转录 → LLM-Wiki | 人机校验时需要 |
| Bilibili 视频 (`bilibili.com/video/`) | yt-dlp 下载音频 → Whisper 转录 → LLM-Wiki | 高清音质时需要 |
| 知乎专栏 (`zhuanlan.zhihu.com/p/`) | 三级获取链 | 需要 (`z_c0`) |
| 微信公众号 (`mp.weixin.qq.com/s/`) | 三级获取链 | 不需要 |
| X/Twitter (`x.com`, `twitter.com`) | Jina Reader (JS 渲染) | 完整内容时需要 |
| Bilibili 文章 (`bilibili.com/read/`) | Jina Reader (JS 渲染) | 不需要 |
| arXiv (`arxiv.org`) | HTML 抓取 → LLM-Wiki | 不需要 |
| PDF 直链 (`.pdf`) | 下载 → Advanced Skills | 不需要 |
| 通用网页 | 三级获取链 | 按域名从 DB 读取 |

- **三级获取链**: Level 1 trafilatura (静态) → Level 2 Jina Reader (云 Playwright) → Level 3 Tavily Extract

- **响应**:
  ```json
  {
    "filename": "文章标题.md",
    "document_id": 1,
    "assigned_engine": "LLM-Wiki (2-step CoT)",
    "source_url": "https://...",
    "fetch_level": 1,
    "fetch_level_name": "trafilatura"
  }
  ```

### 3.3 重新处理文档
- **接口**: `POST /ingest/{document_id}/reprocess`
- **Header**: `X-Project-Id` (必填)
- **说明**: 手动重试处理失败或已完成的文档。

---

## 4. 知识查询 (Query & Knowledge)

### 4.1 获取文档列表
- **接口**: `GET /documents`
- **Header**: `X-Project-Id` (必填)
- **参数**: `status` (可选), `limit` (默认 20), `skip` (默认 0)
- **响应**: 包含 `id`, `filename`, `mime_type`, `status`, `source_url`
- **说明**: `source_url` 为通过 URL 摄入时的原始链接，用户可在前端跳转查看原文。

### 4.2 获取文档详情
- **接口**: `GET /documents/{document_id}`
- **Header**: `X-Project-Id` (必填)
- **参数**: `prune` (是否剪枝图谱，默认 true), `max_nodes` (默认 150)
- **响应**: 含 `source_url` + `extracted_data` (完整图谱 JSON)

### 4.3 获取文档预览内容
- **接口**: `GET /documents/{document_id}/content`
- **Header**: `X-Project-Id` (必填)
- **说明**: 获取 LLM 提取的 Markdown 摘要和关键结论。

### 4.4 语义搜索
- **接口**: `POST /search`
- **Header**: `X-Project-Id` (必填)
- **请求体**: `{ "query": "...", "top_k": 5 }`
- **说明**: LanceDB 向量搜索，返回当前项目内相关文档摘要。

### 4.5 删除文档
- **接口**: `DELETE /documents/{document_id}`
- **Header**: `X-Project-Id` (必填)
- **说明**: 从数据库删除 + 移除物理文件。

### 4.6 读取用户文件
- **接口**: `GET /files/read?path=...`
- **说明**: 读取用户隔离存储中的文件内容。

### 4.7 文档下载
- **接口**: `GET /documents/{document_id}/download`
- **说明**: 下载原始文件。

---

## 5. 知识图谱 (Graph)

### 5.1 获取全局图谱
- **接口**: `GET /graph`
- **Header**: `X-Project-Id` (必填)
- **说明**: 聚合当前项目下所有文档的节点和关系，支持共享项目的租户授权校验。

---

## 6. 概念节点 (Concepts)

### 6.1 获取概念列表
- **接口**: `GET /concepts`
- **Header**: `X-Project-Id` (必填)
- **说明**: 获取当前项目下所有有效 Wiki 概念节点。

### 6.2 获取概念详情
- **接口**: `GET /concepts/{concept_id}`
- **Header**: `X-Project-Id` (可选)
- **说明**: 获取特定概念的富文本 Markdown 内容。

---

## 7. AI 聊天与 RAG (Chat)

### 7.1 OpenAI 兼容代理
- **接口**: `POST /chat/completions`
- **说明**: 通用聊天透传，使用 `models_config.yaml` 中的 `chat_model` 作为默认模型。客户端可传 `model` 字段覆盖。
- **说明**: 首次请求时自动从 `models_config.yaml` 加载 API Key 到 LiteLLM 环境。

### 7.2 RAG 智能问答
- **接口**: `POST /chat/rag`
- **Header**: `X-Project-Id` (必填)
- **说明**: 结合本地 LanceDB 向量检索的增强问答。自动搜索项目上下文并组装 Prompt。
- **模型来源**: 优先使用请求体 `model` 字段，未传时使用 `models_config.yaml` 的 `chat_model`。

### 7.3 保存对话到 Wiki
- **接口**: `POST /chat/save_to_wiki`
- **Header**: `X-Project-Id` (必填)
- **说明**: 将 Chat 对话结果保存为 Wiki 页面。

---

## 8. 第三方服务代理

### 8.1 网页搜索 (Tavily)
- **接口**: `GET /web-search?query=...&max_results=10`
- **说明**: 后端代理 Tavily Search API，客户端无需持有 API Key。

---

## 9. 平台 Cookie 管理 (Admin)

> 所有接口需要 system/admin 角色。

| 接口 | 方法 | 说明 |
|------|------|------|
| `/admin/platform-cookies/` | GET | 列出所有已配置平台 |
| `/admin/platform-cookies/` | POST | 新增平台 Cookie |
| `/admin/platform-cookies/{id}` | PUT | 更新 Cookie |
| `/admin/platform-cookies/{id}` | DELETE | 删除 Cookie |

### 9.1 Cookie 数据模型
```json
{
  "id": 1,
  "domain": "zhihu.com",
  "cookie_value": "z_c0=xxx; _xsrf=yyy",
  "format": "header_string|netscape",
  "extra_headers": { "Referer": "https://www.zhihu.com/" },
  "description": "知乎登录Cookie",
  "status": "active|expired",
  "expires_at": "2026-06-08T00:00:00Z"
}
```

### 9.2 Format 说明
- `header_string`: Cookie-Editor 导出选 Header String，直接作为 HTTP Cookie 头发送（知乎、微信、X）
- `netscape`: Cookie-Editor 导出选 Netscape，用于 yt-dlp 视频下载（YouTube、B站）

---

## 10. 实时监控 (Stream)

### 10.1 实时日志流 (SSE)
- **接口**: `GET /stream/documents/{document_id}/logs`
- **说明**: Server-Sent Events 接口，前端实时展示文档处理进度（pending → processing → completed）。

---

## 11. 配置管理 (Admin)

### 11.1 LLM 配置
- **接口**: `GET /config/models` — 获取当前配置
- **接口**: `POST /config/models` — 更新模型配置

配置字段：`step1_extractor`, `step2_graph_maker`, `deep_researcher`, `chat_model`, `translator_model` 及对应的 `api_keys`（GEMINI, DEEPSEEK, ANTHROPIC, OPENAI, OPENROUTER, TAVILY 等）。
