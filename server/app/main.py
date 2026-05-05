from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
from fastapi.middleware.cors import CORSMiddleware
from .routers import ingest, audit, query, stream, chat, graph, config, users, auth, projects, concepts
from .database import engine, Base
from . import models

# Create tables on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="KnowledgeOS Server API",
    description="Backend API for KnowledgeOS, unifying LLM-Wiki and Graphify pipelines.",
    version="0.1.0"
)

# CORS config for local client
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router, prefix="/api/v1/ingest", tags=["ingestion"])
app.include_router(audit.router, prefix="/api/v1", tags=["audit"])
app.include_router(query.router, prefix="/api/v1", tags=["query"])
app.include_router(stream.router, prefix="/api/v1", tags=["stream"])
app.include_router(chat.router, prefix="/api/v1", tags=["chat"])
app.include_router(graph.router, prefix="/api/v1", tags=["graph"])
app.include_router(config.router, prefix="/api/v1", tags=["config"])
app.include_router(users.router, prefix="/api/v1", tags=["users"])
app.include_router(auth.router, prefix="/api/v1", tags=["auth"])
app.include_router(projects.router, prefix="/api/v1", tags=["projects"])
app.include_router(concepts.router, prefix="/api/v1", tags=["concepts"])

@app.get("/health")
async def health_check():
    return {"status": "ok", "message": "KnowledgeOS Server is running"}

admin_dist_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "admin-web", "dist")
if os.path.exists(admin_dist_path):
    app.mount("/admin/assets", StaticFiles(directory=os.path.join(admin_dist_path, "assets")), name="admin-assets")
    
    @app.get("/admin/{full_path:path}")
    async def serve_admin_spa(full_path: str):
        # If the requested path is a file in the dist directory, serve it
        file_path = os.path.join(admin_dist_path, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        # Otherwise serve index.html for SPA routing
        return FileResponse(os.path.join(admin_dist_path, "index.html"))
    
    @app.get("/admin")
    async def serve_admin_spa_root():
        return FileResponse(os.path.join(admin_dist_path, "index.html"))
