"""
安全迁移脚本：只创建不存在的表/列，不删除已有数据。
用法：docker exec -it kos_api python migrate_db.py
"""
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from app.database import engine, Base, SessionLocal
from app.models import PlatformCookie  # noqa: F401 触发模型注册
from sqlalchemy import inspect, text

def migrate():
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    # 1. 建 platform_cookies 表（如果不存在）
    if "platform_cookies" not in existing_tables:
        print("Creating table: platform_cookies")
        PlatformCookie.__table__.create(engine, checkfirst=True)
    else:
        print("Table platform_cookies already exists.")
        # 补充 format 列（如果缺少）
        cols = {c["name"] for c in inspector.get_columns("platform_cookies")}
        if "format" not in cols:
            print("Adding column: platform_cookies.format")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE platform_cookies ADD COLUMN IF NOT EXISTS format VARCHAR DEFAULT 'header_string'"))
                conn.commit()

    # 2. 补 source_url 列（如果 documents 表缺少该列）
    if "documents" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("documents")}
        if "source_url" not in cols:
            print("Adding column: documents.source_url")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_url VARCHAR"))
                conn.commit()
        else:
            print("Column documents.source_url already exists.")
    else:
        print("Table documents not found — skipping source_url migration.")

    print("Migration complete.")

if __name__ == "__main__":
    migrate()
