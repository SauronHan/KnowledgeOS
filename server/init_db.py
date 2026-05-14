from app.database import engine, Base
from app import models
from app.database import SessionLocal
from app.models import User, Tenant
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

from sqlalchemy import text

def init_db():
    print("Step 1: Resetting database (Dropping all tables)...")
    
    # 强制掐断所有其他连接，解决在 Docker 中运行时的死锁问题
    try:
        with engine.connect() as conn:
            # 只有拥有者或超级用户可以执行此操作
            # 这里的逻辑是断开除了当前脚本连接以外的所有其他连接
            conn.execute(text("""
                SELECT pg_terminate_backend(pg_stat_activity.pid)
                FROM pg_stat_activity
                WHERE pg_stat_activity.datname = 'knowledgeos'
                  AND pid <> pg_backend_pid();
            """))
            conn.commit()
            print("Successfully terminated active database connections.")
    except Exception as e:
        print(f"Warning: Could not terminate active connections: {e}")

    # 现在执行 drop_all 就不会卡住了
    Base.metadata.drop_all(bind=engine)
    print("All existing tables dropped.")

    print("Step 2: Creating new database tables...")
    Base.metadata.create_all(bind=engine)
    print("Database tables created successfully.")
    
    print("Step 3: Initializing data...")
    db = SessionLocal()
    try:
        # 1. 确保租户存在
        system_tenant = db.query(Tenant).filter(Tenant.name == "System").first()
        if not system_tenant:
            system_tenant = Tenant(name="System", description="Default System Tenant")
            db.add(system_tenant)
            db.commit()
            db.refresh(system_tenant)
            print("Successfully initialized system tenant.")
        
        # 2. 确保默认 admin 存在
        admin_user = db.query(User).filter(User.username == "admin").first()
        if not admin_user:
            hashed_pw = pwd_context.hash("1Qaz2Wsx")
            admin_user = User(
                username="admin", 
                hashed_password=hashed_pw, 
                role="admin",
                tenant_id=system_tenant.id
            )
            db.add(admin_user)
            db.commit()
            print("Successfully initialized default admin:1Qaz2Wsx user.")
        
        # 3. 确保系统级用户存在
        system_user = db.query(User).filter(User.username == "system-admin").first()
        if not system_user:
            hashed_pw_sys = pwd_context.hash("SystemPass123!")
            system_user = User(
                username="system-admin",
                hashed_password=hashed_pw_sys,
                role="system",
                tenant_id=system_tenant.id
            )
            db.add(system_user)
            db.commit()
            db.refresh(system_user)
            print("Successfully initialized system-admin:SystemPass123! user.")
        else:
            print("System components already initialized.")

    except Exception as e:
        print(f"Failed during database initialization: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    init_db()
