from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from datetime import datetime, date as date_type
from database import get_db
from models import Event, Attendance, User
from image_storage import UPLOAD_DIR
from auth import require_admin
import search_engine
import os

router = APIRouter(prefix="/api/events", tags=["events"])


class EventCreate(BaseModel):
    name: str
    description: str | None = None
    expires_at: str | None = None  # YYYY-MM-DD


class BulkEnrollRequest(BaseModel):
    exclude_event_ids: list[int] = []


def _delete_event_cascade(event_id: int, db: Session) -> list[int]:
    """Delete an event, its exclusive users (with photos), and all attendance records.
    Returns the list of user IDs that were deleted so the caller can purge them
    from the vector search index (Pinecone)."""
    only_here = db.execute(text("""
        SELECT DISTINCT a.user_id FROM attendance a
        WHERE a.event_id = :eid
          AND a.user_id NOT IN (
              SELECT DISTINCT user_id FROM attendance
              WHERE (event_id != :eid OR event_id IS NULL)
                AND event_id IS NOT NULL
          )
          AND a.user_id NOT IN (
              SELECT DISTINCT user_id FROM attendance
              WHERE event_id IS NULL
          )
    """), {"eid": event_id}).fetchall()

    deleted_user_ids: list[int] = []
    for row in only_here:
        user = db.query(User).filter(User.id == row.user_id, User.role != "admin").first()
        if user:
            if user.image_url:
                filepath = os.path.join(UPLOAD_DIR, os.path.basename(user.image_url))
                if os.path.exists(filepath):
                    os.remove(filepath)
            deleted_user_ids.append(user.id)
            db.delete(user)

    db.query(Attendance).filter(Attendance.event_id == event_id).delete()
    event = db.query(Event).filter(Event.id == event_id).first()
    if event:
        db.delete(event)
    return deleted_user_ids


def _purge_expired(db: Session):
    try:
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        expired = db.query(Event).filter(
            Event.expires_at.isnot(None),
            Event.expires_at < today_start,
        ).all()
        purged_user_ids: list[int] = []
        for event in expired:
            purged_user_ids.extend(_delete_event_cascade(event.id, db))
        if expired:
            db.commit()
            for uid in purged_user_ids:
                search_engine.bg_delete(uid)
    except Exception:
        db.rollback()


@router.get("")
def list_events(db: Session = Depends(get_db)):
    _purge_expired(db)
    events = db.query(Event).order_by(Event.created_at.desc()).all()
    return [
        {
            "id": e.id,
            "name": e.name,
            "description": e.description,
            "created_at": e.created_at,
            "expires_at": e.expires_at,
        }
        for e in events
    ]


@router.post("")
def create_event(body: EventCreate, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Event name is required.")

    expires_at = None
    if body.expires_at:
        try:
            d = date_type.fromisoformat(body.expires_at)
            # Store as midnight of that date; cleanup removes events where expires_at < today midnight
            expires_at = datetime(d.year, d.month, d.day, 0, 0, 0)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid expires_at date.")

    event = Event(name=name, description=body.description, expires_at=expires_at, created_by=current_user.id)
    db.add(event)
    db.commit()
    db.refresh(event)
    return {
        "id": event.id,
        "name": event.name,
        "description": event.description,
        "created_at": event.created_at,
        "expires_at": event.expires_at,
    }


@router.get("/{event_id}/info")
def get_event_info(event_id: int, db: Session = Depends(get_db)):
    """Public endpoint — returns basic event info for the mobile scan page."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    return {"id": event.id, "name": event.name, "description": event.description}


@router.get("/{event_id}/users", dependencies=[Depends(require_admin)])
def event_users(event_id: int, db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT u.id, u.name, u.email, u.phone, u.linkedin, u.occupation,
               u.image_url, u.registered_at, a.status
        FROM attendance a
        JOIN users u ON u.id = a.user_id
        WHERE a.event_id = :eid AND u.role != 'admin'
        ORDER BY u.name
    """), {"eid": event_id}).fetchall()
    return [
        {
            "id": r.id, "name": r.name, "email": r.email, "phone": r.phone,
            "linkedin": r.linkedin, "occupation": r.occupation,
            "image_url": r.image_url, "registered_at": r.registered_at,
            "status": r.status,
        }
        for r in rows
    ]


@router.delete("/{event_id}", dependencies=[Depends(require_admin)])
def delete_event(event_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    purged_user_ids = _delete_event_cascade(event_id, db)
    db.commit()
    for uid in purged_user_ids:
        background_tasks.add_task(search_engine.bg_delete, uid)
    return {"success": True, "purged_users": len(purged_user_ids)}


@router.post("/{event_id}/enroll-all-except", dependencies=[Depends(require_admin)])
def enroll_all_except(event_id: int, body: BulkEnrollRequest, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")

    excluded_user_ids: set[int] = set()
    if body.exclude_event_ids:
        rows = db.query(Attendance.user_id).filter(
            Attendance.event_id.in_(body.exclude_event_ids)
        ).distinct().all()
        excluded_user_ids = {r[0] for r in rows}

    already_in_target = {
        r[0] for r in db.query(Attendance.user_id).filter(Attendance.event_id == event_id).all()
    }
    excluded_user_ids |= already_in_target

    candidates = db.query(User).filter(User.role != "admin").all()
    enrolled = 0
    for u in candidates:
        if u.id in excluded_user_ids:
            continue
        db.add(Attendance(user_id=u.id, event_id=event_id, status="enrolled"))
        enrolled += 1
    if enrolled:
        db.commit()

    return {
        "success": True,
        "enrolled": enrolled,
        "skipped_already_in_event": len(already_in_target),
        "skipped_in_excluded_events": len(excluded_user_ids) - len(already_in_target),
    }


@router.delete("/{event_id}/users/{user_id}", dependencies=[Depends(require_admin)])
def remove_user_from_event(event_id: int, user_id: int, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.role == "admin":
        raise HTTPException(status_code=403, detail="Admin accounts cannot be removed from events.")

    deleted = db.query(Attendance).filter(
        Attendance.user_id == user_id,
        Attendance.event_id == event_id,
    ).delete()
    db.commit()
    return {"success": True, "removed": deleted}
