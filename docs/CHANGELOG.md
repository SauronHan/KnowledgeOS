# KnowledgeOS 版本更新日志 (CHANGELOG)

本文档记录了 KnowledgeOS 后端及核心架构的重大版本变更。

---

## [v0.5.6] - 2026-05-08
### 重大变更：多媒体源 URL 摄入与智能获取链

#### 多媒体 URL 摄入支持
- **`POST /api/v1/ingest/url`**：新增 URL 摄入端点，替换仅支持文件上传的旧限。自动识别 YouTube、Bilibili 视频、知乎专栏、微信公众号、X/Twitter、arXiv 论文等平台类型，并路由到对应的处理引擎。
- **Bilibili 视频**：`bilibili.com/video/` 走 yt-dlp 音频下载 → Whisper 转录 → LLM-Wiki 语义提取，同 YouTube 流程。
- **Bilibili 文章**：`bilibili.com/read/` / `bilibili.com/opus/` 识别为 JS 渲染页面，跳过静态抓取直走 Jina Reader。
- **文件命名优化**：视频转音频文件名含原始标题（如 `深度学习入门_yt_af5a68a22b0b.m4a`）；网页名从 `<title>` 标签提取文章标题。
- **原始 URL 保存**：`Document` 模型新增 `source_url` 字段，资源列表支持点击外部链接图标在浏览器打开原文。
- **YouTube Cookie**：yt-dlp cookie 从 `PlatformCookie` 数据库表动态注入（格式：Header String / Netscape），不再依赖环境变量文件。

#### 三级降级获取链 (url_fetcher)
- **`server/app/services/url_fetcher.py`**：新建核心模块，实现三级智能降级：
  - **Level 1 (trafilatura)**：静态 HTTP 抓取 + Mozilla Readability 正文提取，支持 Cookie 注入
  - **Level 2 (Jina Reader)**：云 Playwright，免费 500 RPM，JS 渲染 + Cookie 转发
  - **Level 3 (Tavily Extract)**：已有 API Key 复用，advanced 模式带 JS 渲染
  - Quality gate：正文 < 200 字自动降级到下一层
- **知乎优化**：有 Cookie 时优先从 `js-initialData` JSON 提取结构化内容，比 trafilatura 保留更完整格式
- **JS 必需页面跳过**：X/Twitter、Bilibili 文章等纯 JS 页面直接跳 Level 1，避免误提取 "请启用 JavaScript" 提示

#### 多平台 Cookie 管理
- **`PlatformCookie` 数据模型**：新增数据库表，支持 domain、cookie_value、format（Header String / Netscape）、extra_headers、expires_at
- **`/api/v1/admin/platform-cookies`**：Cookie CRUD API（system/admin only）
- **Admin Web CookieDashboard**：全局 Cookie 管理页面
  - 常用平台预设下拉（知乎/B站/YouTube/X/微信公众号）
  - Cookie 格式选择（Header String for 知乎微信 / Netscape for YouTube B站）
  - 自动过期检测 + 状态变色提醒
  - 额外自定义 Headers 配置（如知乎 Referer）
- **Cookie 过期自动检测**：每次查询时检查 `expires_at`，过期自动标记为 `expired` 并跳过

#### Chat 模型集中管理
- **Chat 端点默认模型**：`/chat/completions` 和 `/chat/rag` 默认模型从硬编码改为读取 `models_config.yaml` 的 `chat_model`
- **API Key 注入**：Chat 端点新增 `_load_api_keys_once()`，将 config 中的 API Key 注入 os.environ 供 LiteLLM 使用
- **模型名智能处理**：已含 provider 前缀（如 `openrouter/`）的模型名直接透传，不再错误追加前缀
- **translator_model**：切换为 `openrouter/deepseek/deepseek-chat`，统一走 OpenRouter

#### 内容提取质量增强
- **trafilatura 集成**：替换 graphify 内置 `html2text`，使用 Mozilla Readability 算法精确提取网页正文，去除导航、广告、侧栏
- **graphify User-Agent 修复**：从 `Mozilla/5.0 graphify/1.0` 改为标准 Chrome UA，解决知乎等站的 403 拦截

#### 转录流程修正
- **音频→转写→语义管线**：YouTube/B站音频 Whispers 转写后不再错误送入 AST 代码解析器，改为 `.delay` 链式分发到 `process_via_wiki_engine`（完整走 2-step CoT + Deep Research + Enrichment）
- **transcribe 参数修复**：`cache_dir`→`output_dir`, `prompt`→`initial_prompt`，去掉不存在的 `model_name` 参数

#### SSRF 防护优化
- **IP 拦截收窄**：`graphify/security.py` 用自定义 `_is_ssrf_dangerous()` 替换 Python `is_private`，只拦截 RFC 1918 三段（10/8, 172.16/12, 192.168/16），不再误拦 Benchmarking（198.18.0.0/15）和 CGNAT（100.64.0.0/10）

#### 其他修复与增强
- **聊天时 Source 列表清空修复**：`chat-message.tsx` 裸 `fetch()` 改用 `kosApiRequest()`，解决缺 `X-Project-Id` header 导致 400 的问题
- **Chat 模型日志**：新增 `[Chat] RESOLVED MODEL: xxx` 输出到 Docker 日志
- **Docker 构建优化**：移除 `build-essential`（arm64 内存不足 OOM），pip 强制 `--only-binary :all:` 使用预编译 wheel
- **`tree-sitter>=0.23.0`**：代码 AST 提取依赖补全
- **安全迁移脚本 `migrate_db.py`**：只创建不存在的表和列，不 `drop_all` 破坏数据
- **前端获取结果展示**：URL 输入成功后显示绿色提示 "Done (trafilatura/Jina Reader/Tavily Extract)"

---

## [v0.5.5] - 2026-05-07
### 重大变更：共享项目包分发与客户端体验增强
- **压缩包分发机制**：共享项目支持 ZIP 压缩包发布 (`package_filename` / `package_version`)，Tauri 端新增 `download_and_extract_shared_project` 命令，自动下载、解压并定位项目目录。
- **版本比对与更新**：客户端打开共享项目时自动检测服务器最新版本，提示用户下载更新；本地版本 >= 服务器版本时直接打开，无需重复下载。
- **服务器配置页 (ServerConfigScreen)**：首次启动引导配置 KnowledgeOS 服务器地址，支持连接测试 (`/health`)，地址持久化到 `app-state.json`。
- **默认项目目录**：新增 `projectRoot` 配置，新建项目默认创建在该目录下；Settings → Network 中可随时修改。
- **登出功能**：侧边栏新增 Logout 按钮，清空本地 token 并返回登录页。
- **App 头部栏**：新增顶部项目名显示栏 `Lyrebird KOS : {projectName}`。
- **共享项目只读控制**：共享项目在前端屏蔽删除文件和目录操作 (`knowledge-tree.tsx`)。
- **数据库连接池增强**：`database.py` 新增 `pool_pre_ping=True` + `pool_recycle=1800`，防止 PostgreSQL 重启后断连。
- **Admin Web**：新增 SharedProjectDashboard 页面，支持发布新版本、编辑租户授权、归档/激活项目。
- **Docker**：`shared_packages/` 目录挂载到 API 容器，供压缩包分发使用。
- **初始化脚本优化**：`init_db.py` 新增 `pg_terminate_backend` 强制断开其他连接，避免 Docker 中 drop_all 死锁。

## [v0.5.4] - 2026-05-06
### 重大变更：共享项目多租户架构 (Shared Project Architecture)
- **项目可见性模型**：`Project` 新增 `visibility` 字段 (`private` / `shared`) 和 `visible_to_all_tenants` 布尔字段，支持 ALL 语义（所有租户可见）。
- **租户授权关联表**：新增 `ProjectTenantAccess` 模型（多对多），精确控制共享项目的租户级可见性。
- **权限分级守卫**：`auth.py` 新增 `check_project_read_permission` / `check_project_write_permission`；共享项目非 system/admin 角色只读，私有项目仅创建者可写。
- **全路由权限加固**：`ingest.py` / `chat.py` / `query.py` / `graph.py` / `concepts.py` / `projects.py` 所有数据访问端点统一接入读写权限校验。
- **System 角色引入**：用户角色新增 `system`（跨租户超级管理员），`init_db.py` 自动创建 `system-admin` 用户。
- **共享项目创建流程**：`sync_project` 接口支持 `target_tenant_ids` 和 `visible_to_all_tenants` 参数；仅 system/admin 可创建共享项目。
- **独立文件存储路径**：共享项目文件存放在 `data/raw_uploads/shared/project_{uuid}/sources/`，与私有项目物理隔离。
- **Admin Web**：用户管理页支持 `system` 角色分配；路由新增 Shared Projects 入口。
- **数据库迁移**：新增 4 个 SQL 迁移脚本（`migrate_visibility.sql` / `migrate_project_tenant_access.sql` / `migrate_shared_packages.sql` / `migrate_visible_to_all_tenants.sql`）。
- **项目列表 API 升级**：`/api/v1/projects` 返回共享项目 + 私有项目并集，自动标记 `is_readonly`、`package_version` 等字段。
- **租户授权管理接口**：新增 `GET/PUT /api/v1/projects/{id}/access`，支持覆盖式更新共享项目的授权租户列表。
- **项目状态管理**：新增 `PUT /api/v1/projects/{id}/status`，支持 active / archived 状态切换。
- **概念节点接口简化**：`concepts.py` 移除冗余的 `tenant_id` 过滤，数据隔离由 project-level 权限兜底。
- **客户端 adapter**：
  - `api-client.ts` 支持动态服务器地址 (`getServerUrl`/`setServerUrl`)，告别硬编码。
  - `syncProjectToServer` 支持传递 `tenantIds` 参数（null = ALL, array = 指定租户）。
  - WelcomeScreen 区分共享/私有项目创建入口，展示服务器项目列表。
  - CreateProjectDialog 双重身份：普通模式 / 共享模式（含两步 TenantPicker）。
  - 新增 `ShareTenantPicker` 组件、`Badge` 组件、`shared-project.ts` 工具模块。
  - WikiProject 类型扩展 `visibility` / `isReadonly` / `packageVersion` / `serverId`。
  - `reset-project-state` 增强，切项目时同步清理 `fileTree` 和 `selectedFile`。

## [v0.5.3] - 2026-05-05
### 重大变更：处理流水线 SaaS 化适配
- **Ingest 流程重构**：上传文件现在支持 `X-Project-Id` 校验，文件存储路径更新为按项目隔离的目录结构：`data/raw_uploads/user_{id}/project_{uuid}/sources/`。
- **Enrichment 逻辑入库**：Wiki Enrichment 任务生成的富文本内容不再写入物理 `.md` 文件，而是直接存入数据库的 `concept_nodes` 表。
- **深度研究关联**：Deep Search 的结果（Save to Wiki）现在会自动关联到用户当前打开的活跃项目。

## [v0.5.2] - 2026-05-05
### 重大变更：概念节点数据库化 (Database-Backed Concepts)
- **节点存储迁移**：废弃了依赖物理文件系统的 `wiki/concepts/*.md` 存储方式，引入 `ConceptNode` 数据库模型。
- **Concepts API**：新增 `/api/v1/concepts` 接口，支持按项目过滤节点列表，并提供富文本内容的读取。
- **图谱引擎升级**：`graph.py` 现在采用双源驱动模式，动态聚合数据库节点与文档 JSON 提取的关系数据。
- **前端适配**：修复了因虚拟路径解析导致的“Preview not available”错误，统一了 `concept://` 的渲染逻辑。

## [v0.5.1] - 2026-05-04
### 重大变更：项目隔离架构实现
- **Project 模型引入**：在 `Tenant -> User` 的基础上增加了 `Project` 隔离层级，实现同一个用户下不同研究任务的数据彻底隔离。
- **自动上下文注入**：前端 `api-client` 实现了 `X-Project-Id` 请求头自动注入机制。
- **项目同步机制**：在创建或打开本地项目时，强制触发服务端同步，确保后端即时感知项目上下文。
- **软删除支持**：为 Project 和 ConceptNode 增加了 `status` 字段，支持数据的软删除逻辑。

## [v0.5.0] - 2026-05-01
### 重大变更：SaaS 架构基座确立
- **多租户数据库设计**：从单机本地存储迁移至 SQLAlchemy + PostgreSQL 的多租户架构。
- **身份验证体系**：引入了 mock JWT 认证机制，确立了 `Tenant`（租户）与 `User`（用户）的数据归属关系。
- **基础隔离**：实现了基于用户 ID 的物理文件隔离目录：`data/raw_uploads/user_{id}/`。
- **API 统一规范**：建立了 `/api/v1/` 版本的 RESTful 接口标准。

---
*注：版本号遵循语义化版本 (SemVer) 逻辑，重大修改增加 0.0.1。*
