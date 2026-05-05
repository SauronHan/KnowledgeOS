# KnowledgeOS 版本更新日志 (CHANGELOG)

本文档记录了 KnowledgeOS 后端及核心架构的重大版本变更。

---

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
