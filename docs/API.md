# KnowledgeOS API 接口文档 (v0.5.3)

本文档详细记录了 KnowledgeOS 后端提供的所有对外 API 接口。

## 基础信息
- **Base URL**: `http://localhost:8080/api/v1`
- **认证方式**: HTTP Bearer Token (Header: `Authorization: Bearer <token>`)
- **项目隔离**: 大部分业务接口需要提供项目 ID (Header: `X-Project-Id: <id>`)

---

## 1. 认证与用户管理 (Auth & Users)

### 1.1 用户登录
- **接口**: `POST /auth/login`
- **认证**: 无
- **请求体**:
  ```json
  {
    "username": "admin",
    "password": "password123"
  }
  ```
- **响应**: 返回 mock JWT token 及用户信息。

### 1.2 获取租户列表
- **接口**: `GET /tenants`
- **认证**: Bearer Token
- **说明**: 系统管理接口，获取所有已注册租户。

### 1.3 用户管理 (CRUD)
- `GET /users`: 获取所有用户。
- `POST /users`: 创建新用户（需指定 `tenant_id` 和 `role`）。
- `PUT /users/{user_id}`: 更新用户信息。
- `DELETE /users/{user_id}`: 删除用户。

---

## 2. 项目管理 (Projects)

### 2.1 同步项目
- **接口**: `POST /projects`
- **认证**: Bearer Token
- **说明**: 前端创建或打开本地项目时调用，用于在后端建立/关联项目记录。
- **请求体**: `{"uuid": "...", "name": "..."}`
- **响应**: 返回后端的 `project_id`（用于后续接口的 `X-Project-Id`）。

### 2.2 获取项目列表
- **接口**: `GET /projects`
- **认证**: Bearer Token
- **说明**: 获取当前用户下所有状态为 `active` 的项目。

### 2.3 删除项目
- **接口**: `DELETE /projects/{project_id}`
- **说明**: 软删除项目（状态设为 `deleted`）。

---

## 3. 资料导入 (Ingest)

### 3.1 上传并处理文档
- **接口**: `POST /api/v1/ingest/`
- **参数**: `file` (Multipart/form-data)
- **Header**: `X-Project-Id` (必填)
- **说明**: 上传文件并根据文件类型智能路由到处理引擎（Graphify 或 Wiki Engine）。支持自动排重和物理目录隔离。

---

## 4. 知识查询 (Query & Knowledge)

### 4.1 获取文档列表
- **接口**: `GET /documents`
- **Header**: `X-Project-Id` (必填)
- **参数**: `status` (可选), `limit`, `skip`
- **说明**: 获取当前项目下的文档列表及处理状态。

### 4.2 获取文档详情
- **接口**: `GET /documents/{document_id}`
- **Header**: `X-Project-Id` (必填)
- **说明**: 获取文档提取的 JSON 知识结构，支持 `prune` 参数进行剪枝。

### 4.3 获取文档预览内容
- **接口**: `GET /documents/{document_id}/content`
- **Header**: `X-Project-Id` (必填)
- **说明**: 获取由 LLM 提取的 Markdown 摘要和关键结论。

### 4.4 语义搜索
- **接口**: `POST /search`
- **Header**: `X-Project-Id` (必填)
- **请求体**: `{"query": "...", "top_k": 5}`
- **说明**: 基于 LanceDB 向量数据库在当前项目范围内检索相关文档摘要。

### 4.5 删除文档
- **接口**: `DELETE /documents/{document_id}`
- **Header**: `X-Project-Id` (必填)
- **说明**: 从数据库删除记录并移除物理文件。

---

## 5. 知识图谱 (Graph)

### 5.1 获取全局图谱
- **接口**: `GET /graph`
- **Header**: `X-Project-Id` (必填)
- **说明**: 聚合当前项目下所有文档提取的节点和关系，生成 D3.js 兼容的图谱数据。

---

## 6. 概念节点 (Concepts)

### 6.1 获取概念列表
- **接口**: `GET /concepts`
- **Header**: `X-Project-Id` (必填)
- **说明**: 获取当前项目下所有已入库的 Wiki 概念节点。

### 6.2 获取概念详情
- **接口**: `GET /concepts/{concept_id}`
- **Header**: `X-Project-Id` (可选，推荐)
- **说明**: 获取特定概念的富文本内容（Markdown）。

---

## 7. AI 聊天与 RAG (Chat)

### 7.1 OpenAI 兼容代理
- **接口**: `POST /chat/completions`
- **说明**: 通用聊天透传接口，自动处理 API Key 并支持流式返回。

### 7.2 RAG 智能问答
- **接口**: `POST /chat/rag`
- **Header**: `X-Project-Id` (必填)
- **说明**: 结合本地向量检索的增强问答。后端会自动在当前项目中搜索背景知识并组装 Prompt。

---

## 8. 实时监控 (Stream)

### 8.1 实时日志流 (SSE)
- **接口**: `GET /stream/documents/{document_id}/logs`
- **说明**: Server-Sent Events 接口，用于前端实时展示文档解析进度。
