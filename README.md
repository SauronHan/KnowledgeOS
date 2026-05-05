# KnowledgeOS 🧠

<p align="center">
  <img src="docs/assets/Lyrebird-logo.png" width="120" />
</p>

<p align="center">
  <strong>企业级下一代智能知识操作系统：深度研究、知识图谱与混合 RAG 的终极融合体</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" alt="License"></a>
  <a href="#"><img src="https://img.shields.io/badge/version-v0.5.3-orange.svg" alt="Version"></a>
  <a href="#"><img src="https://img.shields.io/badge/SaaS-Ready-green.svg" alt="SaaS Ready"></a>
</p>

---

## 🌟 项目愿景 (The Vision)

在企业知识管理领域，我们正面临着**“数据孤岛”**与**“知识幻觉”**的双重挑战。传统的 RAG（检索增强生成）往往受限于浅层的语义匹配，无法理解知识间的深层拓扑关系。

**KnowledgeOS** 旨在打破传统知识库“死文档、搜不到、难关联”的困局。我们创新性地结合了 **LLM-Wiki** 的深度交互哲学与 **Graphify** 的零幻觉静态分析技术，构建出一张动态生长的、可推理的企业知识大脑。它不仅是一个存储库，更是一个具备自我进化能力的智能操作系统。

---

## ✨ 核心特性 (Key Features)

### 🔐 1. 全链路项目隔离 (SaaS-Level Isolation)
专为 ToB 商业场景设计。基于租户（Tenant）与用户（User）的严密鉴权体系，实现了**项目级（Project-Level）**的数据彻底隔离。
- **物理隔离**: 不同项目的文档、向量索引、知识图谱在存储层完全独立。
- **权限安全**: 确保企业内部不同部门、不同项目组之间的数据主权。

### 🚄 2. “双轨制”混合解析引擎 (Hybrid Ingestion)
针对不同类型的数据流，系统自动采用最适合的“压榨”方式：
- **静态分析轨道 (Code/Structured)**: 利用 `Tree-sitter` (AST) 静态解析代码与结构化数据，**0 Token 消耗**，精确提取定义与引用，彻底杜绝 LLM 幻觉。
- **语义推理轨道 (Unstructured)**: 对 PDF、Word、网页等非结构化文本，采用 **2-Step Chain-of-Thought (CoT)**：先分析概念冲突，再生成逻辑连边，将死板文字转化为知识网。

### 🔀 3. LiteLLM 混合模型路由 (Smart Routing)
集成 **LiteLLM** 统一网关，支持成本与智商的最佳平衡：
- **灵活分发**: Step 1 粗分析走低成本模型（如 DeepSeek），Step 2 深度图谱推理走顶级模型（如 Gemini 1.5 Pro / Claude 3.5）。
- **隐私模式**: 支持本地私有化部署的 **Ollama**，确保核心机密数据永不出网。

### 🤖 4. 自主深度研究 Agent (Deep Search)
系统内置具备“好奇心”的 Agent。当大模型解析文档发现知识盲区时，会自动触发深度研究：
- **主动探索**: 自动执行全网爬虫，对比最新行业资讯。
- **历史持久化**: 所有研究报告自动保存为 Markdown，支持任务状态实时流式展示，并允许随时二次编辑入库。

<p align="center">
  <img src="./docs/assets/DeepResearch.png" width="800" />
  <br>
  <em>自主深度搜索与研究结果实时入库界面</em>
</p>

### 🛡️ 5. Maker-Checker 知识审批流 (Audit Pipeline)
借鉴金融行业的严谨性，引入 **“制作-复核”机制**。
- **质量关卡**: 大模型生成的知识节点必须经过专家审核流（Audit Pipeline），通过后方可注入企业公有向量池。
- **防爆机制**: 有效过滤低质量、重复或有冲突的信息，保持知识库的绝对纯净。

### ⚡ 6. 高性能图谱渲染与 SSE 流式反馈
- **丝滑体验**: 基于 `Sigma.js` 与图论剪枝算法，万级节点依然可以实现极速缩放与搜索。
- **实时透明**: 采用 `Redis + SSE` 协议，将后端的每一步思考、爬网、解析状态实时推送到前端 UI，拒绝“黑盒”等待。

<p align="center">
  <img src="./docs/assets/Graph.png" width="800" />
  <br>
  <em>知识图谱实时拓扑渲染界面</em>
</p>

---

## 🏗️ 技术架构 (Architecture)

### **后端 (KnowledgeOS-Server)**
- **核心框架**: `Python 3.12` + `FastAPI` + `Celery` (分布式异步中心)
- **数据存储**: 
  - `PostgreSQL`: 关系型数据与用户状态中心。
  - `LanceDB`: 下一代 Serverless 向量数据库，支持极致的项目隔离。
  - `Redis`: 任务调度队列与 SSE 日志中转站。
- **部署方案**: 全量容器化，支持 `Docker Compose` 一键拉起。

### **前端 (KnowledgeOS-Client)**
- **技术栈**: `Tauri v2` + `React 19` + `Vite` + `Tailwind CSS`
- **图形渲染**: `Sigma.js` + `Graphology`

---

## 🚀 快速开始 (Quick Start)

### 📚 开发资源
- [API 接口文档 (v0.5.3)](./docs/API.md)
- [版本更新日志 (CHANGELOG)](./docs/CHANGELOG.md)

### 1. 后端部署 (Docker)
请参照 [《部署运行指南》](./部署运行.md) 进行配置。
```bash
cd server
cp .env.example .env  # 填入 API Keys
docker-compose up -d
docker exec -it kos_api python init_db.py
```

### 2. 客户端运行 (Local)
```bash
cd client
npm install
npm run tauri dev
```

---

## 🤝 鸣谢 (Acknowledgments)

KnowledgeOS 的开发深受开源社区的启发，特别鸣谢以下项目的灵感与代码贡献：

- [**LLM-Wiki**](https://github.com/nashsu/llm_wiki): 提供了核心的知识提取思维链逻辑与前端交互架构。
- [**Graphify**](https://github.com/safishamsi/graphify): 提供了高性能的静态代码解析与结构化定义参考。

---

## 📜 授权协议 (License)

本项目采用 **[GNU General Public License v3.0](./LICENSE)** 协议开源。

*KnowledgeOS - 守护数据主权，构建私有大脑*
