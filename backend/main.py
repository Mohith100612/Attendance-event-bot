import asyncio
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import text, inspect
from database import engine, Base
from routes import register, attendance, events, import_sheet, auth as auth_routes, search as search_routes
import ws_manager
import os
from dotenv import load_dotenv
load_dotenv()


def run_migrations():
    insp = inspect(engine)
    dialect = engine.dialect.name

    user_cols = {c["name"] for c in insp.get_columns("users")}
    att_cols = {c["name"] for c in insp.get_columns("attendance")}
    event_cols = {c["name"] for c in insp.get_columns("events")}

    with engine.begin() as conn:
        for col, ddl in [
            ("email", "VARCHAR(255)"),
            ("phone", "VARCHAR(50)"),
            ("linkedin", "VARCHAR(255)"),
            ("occupation", "VARCHAR(255)"),
            ("company", "VARCHAR(255)"),
            ("industry", "VARCHAR(255)"),
            ("website", "VARCHAR(255)"),
            ("business_description", "TEXT"),
        ]:
            if col not in user_cols:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {ddl}"))

        # Drop legacy "description" column (superseded by business_description)
        if "description" in user_cols:
            if dialect == "postgresql":
                conn.execute(text("ALTER TABLE users DROP COLUMN IF EXISTS description"))
            elif dialect == "sqlite":
                # SQLite supports DROP COLUMN from 3.35+; older versions silently fail
                try:
                    conn.execute(text("ALTER TABLE users DROP COLUMN description"))
                except Exception as e:
                    print(f"[startup] could not drop legacy users.description: {e}")

        if "event_id" not in att_cols:
            conn.execute(text(
                "ALTER TABLE attendance ADD COLUMN event_id INTEGER REFERENCES events(id)"
            ))

        if "check_in_type" not in att_cols:
            conn.execute(text(
                "ALTER TABLE attendance ADD COLUMN check_in_type VARCHAR(20)"
            ))

        if dialect == "postgresql":
            conn.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_user_event
                ON attendance (user_id, event_id)
                WHERE event_id IS NOT NULL
            """))

        for col, ddl in [
            ("password_hash", "VARCHAR(255)"),
            ("role", "VARCHAR(20) DEFAULT 'user'"),
        ]:
            if col not in user_cols:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {ddl}"))

        if "expires_at" not in event_cols:
            # TIMESTAMP works in both PostgreSQL and SQLite (DATETIME is SQLite-only)
            conn.execute(text("ALTER TABLE events ADD COLUMN expires_at TIMESTAMP"))

        if "created_by" not in event_cols:
            conn.execute(text("ALTER TABLE events ADD COLUMN created_by INTEGER REFERENCES users(id)"))


def bootstrap_admin():
    admin_email = os.getenv("ADMIN_EMAIL")
    admin_password = os.getenv("ADMIN_PASSWORD")
    if not admin_email or not admin_password:
        return
    from auth import hash_password
    with engine.begin() as conn:
        existing = conn.execute(
            text("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
        ).fetchone()
        if existing:
            return
        conn.execute(
            text(
                "INSERT INTO users (name, email, password_hash, role, registered_at) "
                "VALUES (:n, :e, :p, 'admin', CURRENT_TIMESTAMP)"
            ),
            {"n": "Admin", "e": admin_email, "p": hash_password(admin_password)},
        )


app = FastAPI(title="Attendance System")


@app.on_event("startup")
async def startup():
    ws_manager.set_loop(asyncio.get_running_loop())
    try:
        Base.metadata.create_all(bind=engine)
        run_migrations()
        bootstrap_admin()
        print("[startup] Database ready")
    except Exception as e:
        print(f"[startup] DB init failed (app still starts): {e}")
    from search_engine import init_engine
    init_engine()


_origins_env = os.getenv("ALLOW_ORIGINS", "http://localhost:5173,http://localhost:3000")
_allowed_origins = [o.strip() for o in _origins_env.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

upload_dir = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(upload_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=upload_dir), name="uploads")

app.include_router(auth_routes.router)
app.include_router(register.router)
app.include_router(attendance.router)
app.include_router(events.router)
app.include_router(import_sheet.router)
app.include_router(search_routes.router)


@app.websocket("/ws/display")
async def display_ws(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep alive
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


@app.get("/health")
def health():
    return {"status": "ok"}


# ── Serve React frontend (must be last) ───────────────────────────────────────
_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(_frontend_dist):
    _assets_dir = os.path.join(_frontend_dist, "assets")
    if os.path.exists(_assets_dir):
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="frontend-assets")

    @app.middleware("http")
    async def spa_fallback(request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if (
            response.status_code == 404
            and not path.startswith("/api")
            and not path.startswith("/uploads")
            and not path.startswith("/assets")
            and not path.startswith("/ws")
        ):
            return FileResponse(os.path.join(_frontend_dist, "index.html"))
        return response


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

