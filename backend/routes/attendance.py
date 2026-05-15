from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

import ws_manager
from auth import require_admin
from database import get_db
from models import Attendance, Event, User

router = APIRouter(prefix="/api/attendance", tags=["attendance"])


class CheckInRequest(BaseModel):
    user_id: int
    event_id: int
    check_in_type: Literal["virtual", "in_person"]


class CheckOutRequest(BaseModel):
    user_id: int
    event_id: int


@router.post("/checkin", dependencies=[Depends(require_admin)])
def check_in(body: CheckInRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == body.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    event = db.query(Event).filter(Event.id == body.event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")

    record = (
        db.query(Attendance)
        .filter(Attendance.user_id == body.user_id, Attendance.event_id == body.event_id)
        .first()
    )
    now = datetime.utcnow()
    already_attended = bool(record and record.status == "present")
    if record:
        record.status = "present"
        record.check_in_type = body.check_in_type
        record.timestamp = now
    else:
        record = Attendance(
            user_id=body.user_id,
            event_id=body.event_id,
            status="present",
            check_in_type=body.check_in_type,
            timestamp=now,
        )
        db.add(record)
    db.commit()
    db.refresh(record)

    ws_manager.broadcast({
        "type": "match",
        "event_id": body.event_id,
        "event_name": event.name,
        "check_in_type": body.check_in_type,
        "user": {
            "name": user.name,
            "email": user.email,
            "phone": user.phone,
            "linkedin": user.linkedin,
            "occupation": user.occupation,
            "company": user.company,
            "business_description": user.business_description,
            "image_url": user.image_url,
            "already_attended": already_attended,
            "role": user.role,
        },
        "timestamp": now.isoformat(),
    })

    return {
        "user_id": record.user_id,
        "event_id": record.event_id,
        "status": record.status,
        "check_in_type": record.check_in_type,
        "timestamp": record.timestamp,
    }


@router.post("/checkout", dependencies=[Depends(require_admin)])
def check_out(body: CheckOutRequest, db: Session = Depends(get_db)):
    record = (
        db.query(Attendance)
        .filter(Attendance.user_id == body.user_id, Attendance.event_id == body.event_id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Attendance record not found.")
    if record.status != "present":
        raise HTTPException(status_code=400, detail="User has not checked in yet.")
    if record.checked_out_at is not None:
        raise HTTPException(status_code=400, detail="User has already checked out.")

    now = datetime.utcnow()
    record.status = "checked_out"
    record.checked_out_at = now
    db.commit()
    db.refresh(record)

    return {
        "user_id": record.user_id,
        "event_id": record.event_id,
        "status": record.status,
        "checked_out_at": record.checked_out_at,
    }


@router.get("/roster", dependencies=[Depends(require_admin)])
def roster(event_id: int, db: Session = Depends(get_db)):
    """All users enrolled in (or already checked into) the given event."""
    rows = db.execute(
        text("""
            SELECT u.id, u.name, u.email, u.image_url, u.occupation,
                   a.status, a.check_in_type, a.timestamp, a.checked_out_at
            FROM attendance a
            JOIN users u ON u.id = a.user_id
            WHERE a.event_id = :eid
              AND (u.role IS NULL OR u.role != 'admin')
            ORDER BY u.name
        """),
        {"eid": event_id},
    ).fetchall()
    return [
        {
            "id": r.id,
            "name": r.name,
            "email": r.email,
            "image_url": r.image_url,
            "occupation": r.occupation,
            "status": r.status,
            "check_in_type": r.check_in_type,
            "timestamp": r.timestamp,
            "checked_out_at": r.checked_out_at,
        }
        for r in rows
    ]


@router.get("/present")
def present_attendees(
    event_id: Optional[int] = None,
    access_token: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
):
    """Full profiles of everyone who has checked in (status=present) for an event."""
    caller_role = None
    if access_token:
        try:
            from auth import decode_token
            payload = decode_token(access_token)
            caller_role = payload.get("role")
        except Exception:
            pass

    query = """
        SELECT u.id, u.name, u.email, u.phone, u.linkedin, u.occupation,
               u.company, u.industry, u.business_description,
               u.image_url, a.timestamp, a.check_in_type, e.name AS event_name
        FROM attendance a
        JOIN users u ON u.id = a.user_id
        LEFT JOIN events e ON e.id = a.event_id
        WHERE a.status = 'present'
    """
    params = {}
    if event_id is not None:
        query += " AND a.event_id = :eid"
        params["eid"] = event_id
    if caller_role != "admin":
        query += " AND (u.role IS NULL OR u.role != 'admin')"
    query += " ORDER BY a.timestamp DESC"

    rows = db.execute(text(query), params).fetchall()
    return [
        {
            "id": r.id,
            "name": r.name,
            "email": r.email,
            "phone": r.phone,
            "linkedin": r.linkedin,
            "occupation": r.occupation,
            "company": r.company,
            "industry": r.industry,
            "business_description": r.business_description,
            "image_url": r.image_url,
            "checked_in_at": r.timestamp,
            "check_in_type": r.check_in_type,
            "event_name": r.event_name,
        }
        for r in rows
    ]


@router.get("/logs", dependencies=[Depends(require_admin)])
def attendance_logs(event_id: Optional[int] = None, db: Session = Depends(get_db)):
    if event_id is not None:
        rows = db.execute(
            text("""
                SELECT a.id, u.name, u.image_url, a.status, a.check_in_type,
                       a.timestamp, a.event_id, e.name AS event_name
                FROM attendance a
                JOIN users u ON u.id = a.user_id
                LEFT JOIN events e ON e.id = a.event_id
                WHERE a.event_id = :eid
                ORDER BY a.timestamp DESC
                LIMIT 200
            """),
            {"eid": event_id},
        ).fetchall()
    else:
        rows = db.execute(
            text("""
                SELECT a.id, u.name, u.image_url, a.status, a.check_in_type,
                       a.timestamp, a.event_id, e.name AS event_name
                FROM attendance a
                JOIN users u ON u.id = a.user_id
                LEFT JOIN events e ON e.id = a.event_id
                ORDER BY a.timestamp DESC
                LIMIT 200
            """)
        ).fetchall()

    return [
        {
            "id": r.id,
            "name": r.name,
            "image_url": r.image_url,
            "status": r.status,
            "check_in_type": r.check_in_type,
            "timestamp": r.timestamp,
            "event_id": r.event_id,
            "event_name": r.event_name,
        }
        for r in rows
    ]
