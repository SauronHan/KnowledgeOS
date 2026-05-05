from app.database import engine, Base
from app import models
from app.database import SessionLocal
from app.models import User, Tenant
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def init_db():
    print("Dropping existing database tables...")
    Base.metadata.drop_all(bind=engine)
    print("Creating new database tables...")
    Base.metadata.create_all(bind=engine)
    print("Database tables created successfully.")
    
    print("Initializing default admin user...")
    db = SessionLocal()
    try:
        admin_user = db.query(User).filter(User.username == "admin").first()
        if not admin_user:
            system_tenant = db.query(Tenant).filter(Tenant.name == "System").first()
            if not system_tenant:
                system_tenant = Tenant(name="System", description="Default System Tenant")
                db.add(system_tenant)
                db.commit()
                db.refresh(system_tenant)
            
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
        else:
            print("Admin user already exists.")
    except Exception as e:
        print(f"Failed to initialize default admin: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    init_db()
