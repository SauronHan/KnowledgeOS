import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://kos_admin:kos_password@localhost:5432/knowledgeos")

engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,   # 发送 SELECT 1 验证连接，自动处理 PostgreSQL 重启后的断连
    pool_recycle=1800,    # 每 30 分钟回收连接，防止长时间闲置导致的 stale 连接
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
