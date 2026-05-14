from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, JSON, DateTime, Text, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from .database import Base

class Tenant(Base):
    __tablename__ = "tenants"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    description = Column(String, nullable=True)
    
    users = relationship("User", back_populates="tenant")
    documents = relationship("Document", back_populates="tenant")
    projects = relationship("Project", back_populates="tenant")
    accessible_projects = relationship("ProjectTenantAccess", back_populates="tenant")

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String, nullable=True)
    role = Column(String, default="employee") # admin, system, maker, checker, employee
    is_active = Column(Boolean, default=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"))
    
    tenant = relationship("Tenant", back_populates="users")
    audits = relationship("AuditLog", back_populates="checker")
    documents = relationship("Document", back_populates="user")
    projects = relationship("Project", back_populates="user")

class Project(Base):
    """
    项目：支持隔离与共享两种模式。
    - visibility='private': 仅创建者可见（默认）。
    - visibility='shared': 通过 ProjectTenantAccess 控制哪些 Tenant 可见，员工只读。
    """
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String, unique=True, index=True)   # 与前端 WikiProject.id 对齐
    name = Column(String, index=True)
    status = Column(String, default="active")         # active, archived, deleted
    visibility = Column(String, default="private")    # private, shared
    visible_to_all_tenants = Column(Boolean, default=False)  # 已废弃：不再使用，保留字段兼容旧数据
    # 共享项目压缩包分发
    package_filename = Column(String, nullable=True)          # 压缩包文件名，如 kb-v1.zip
    package_version = Column(Integer, default=0)               # 版本号，每次发布 +1
    package_updated_at = Column(DateTime(timezone=True), nullable=True)  # 最近发布时间
    
    tenant_id = Column(Integer, ForeignKey("tenants.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    tenant = relationship("Tenant", back_populates="projects")
    user = relationship("User", back_populates="projects")
    documents = relationship("Document", back_populates="project")
    concept_nodes = relationship("ConceptNode", back_populates="project")
    tenant_access = relationship("ProjectTenantAccess", back_populates="project", cascade="all, delete-orphan")


class ProjectTenantAccess(Base):
    """
    共享项目的租户授权关联表（多对多）。
    仅 visibility='shared' 的项目使用此表控制可见性。
    """
    __tablename__ = "project_tenant_access"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('project_id', 'tenant_id', name='uq_project_tenant'),
    )

    project = relationship("Project", back_populates="tenant_access")
    tenant = relationship("Tenant", back_populates="accessible_projects")

class Document(Base):
    __tablename__ = "documents"
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, index=True)
    status = Column(String, default="pending") # pending, processing, audit_required, completed, rejected, deleted
    mime_type = Column(String)
    file_path = Column(String)
    source_url = Column(String, nullable=True)  # 原始 URL（通过 URL 摄入时保存）
    extracted_data = Column(JSON, nullable=True)
    
    tenant_id = Column(Integer, ForeignKey("tenants.id"))
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    
    tenant = relationship("Tenant", back_populates="documents")
    user = relationship("User", back_populates="documents")
    project = relationship("Project", back_populates="documents")

class ConceptNode(Base):
    """
    概念节点：由 Wiki Engine 从文档中提取并富化的知识节点。
    存储在数据库中而非物理文件，确保前端可靠读取。只读展示。
    """
    __tablename__ = "concept_nodes"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)                  # 节点名称，如 "OpenClaw"
    entity_type = Column(String, default="concept")    # concept, entity, topic
    description = Column(String, nullable=True)        # 简短描述（来自 LLM 提取）
    rich_content = Column(Text, nullable=True)         # 详细 Wiki 页面内容（Markdown）
    status = Column(String, default="active")          # active, deleted
    
    project_id = Column(Integer, ForeignKey("projects.id"))
    tenant_id = Column(Integer, ForeignKey("tenants.id"))
    source_document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    project = relationship("Project", back_populates="concept_nodes")

class AuditLog(Base):
    """
    企业级知识审批流 (Maker-Checker 机制)
    """
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"))
    checker_id = Column(Integer, ForeignKey("users.id"))
    status = Column(String) # approved, rejected
    comments = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    checker = relationship("User", back_populates="audits")


class PlatformCookie(Base):
    """
    多平台 Cookie 管理：存储各站点的认证 Cookie 供 URL 摄入时注入。
    在 Admin Web 中配置，前端提交原始 Cookie 字符串，后端按域名匹配注入请求。
    """
    __tablename__ = "platform_cookies"
    id = Column(Integer, primary_key=True, index=True)
    domain = Column(String, unique=True, index=True, nullable=False)  # e.g. "zhihu.com", "bilibili.com"
    cookie_value = Column(Text, nullable=False)  # Cookie-Editor 导出的原始内容
    format = Column(String, default="header_string")  # "header_string" (直接HTTP Cookie) or "netscape" (给yt-dlp)
    extra_headers = Column(JSON, nullable=True)  # 额外 Header，如 {"Referer": "https://www.zhihu.com/"}
    description = Column(String, nullable=True)  # 备注
    status = Column(String, default="active")     # active / expired
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
