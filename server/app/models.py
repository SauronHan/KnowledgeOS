from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, JSON, DateTime, Text
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

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String, nullable=True)
    role = Column(String, default="employee") # admin, maker, checker, employee
    is_active = Column(Boolean, default=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"))
    
    tenant = relationship("Tenant", back_populates="users")
    audits = relationship("AuditLog", back_populates="checker")
    documents = relationship("Document", back_populates="user")
    projects = relationship("Project", back_populates="user")

class Project(Base):
    """
    项目：用户创建的知识库项目，实现项目级别的数据隔离。
    同一用户的不同项目之间完全隔离。
    """
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String, unique=True, index=True)   # 与前端 WikiProject.id 对齐
    name = Column(String, index=True)
    status = Column(String, default="active")         # active, archived, deleted
    
    tenant_id = Column(Integer, ForeignKey("tenants.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    tenant = relationship("Tenant", back_populates="projects")
    user = relationship("User", back_populates="projects")
    documents = relationship("Document", back_populates="project")
    concept_nodes = relationship("ConceptNode", back_populates="project")

class Document(Base):
    __tablename__ = "documents"
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, index=True)
    status = Column(String, default="pending") # pending, processing, audit_required, completed, rejected, deleted
    mime_type = Column(String)
    file_path = Column(String)
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
