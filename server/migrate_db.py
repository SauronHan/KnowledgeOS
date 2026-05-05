import os
import sys
from sqlalchemy import create_engine, text

# Import the database URL from app.database to ensure consistency
sys.path.append(os.path.join(os.path.dirname(__file__), "app"))
from database import DATABASE_URL

def migrate():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        try:
            # For Postgres
            conn.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE;"))
            print("Added is_active to users")
        except Exception as e:
            print("is_active might already exist or error:", e)
            
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE;"))
            print("Added expires_at to users")
        except Exception as e:
            print("expires_at might already exist or error:", e)
            
        try:
            conn.execute(text("ALTER TABLE documents ADD COLUMN user_id INTEGER REFERENCES users(id);"))
            print("Added user_id to documents")
        except Exception as e:
            print("user_id might already exist or error:", e)
            
        conn.commit()

if __name__ == "__main__":
    migrate()
