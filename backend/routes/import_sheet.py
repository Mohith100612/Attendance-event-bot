import csv
import io
import logging
import os
import re
import uuid
from typing import List, Optional

import requests
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from auth import require_admin
from database import get_db
from image_storage import UPLOAD_DIR, save_upload_bytes
from models import Attendance, Event, User
import search_engine

router = APIRouter(prefix="/api/import", tags=["import"])

_HEADERS = {"User-Agent": "Mozilla/5.0"}


def _csv_url(sheet_url: str) -> str:
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", sheet_url)
    if not match:
        raise ValueError("Not a valid Google Sheets URL.")
    sid = match.group(1)
    gid_match = re.search(r"[#&?]gid=(\d+)", sheet_url)
    gid = f"&gid={gid_match.group(1)}" if gid_match else ""
    return f"https://docs.google.com/spreadsheets/d/{sid}/export?format=csv{gid}"


def _direct_url(url: str) -> str:
    """Convert Google Drive sharing link to a direct download URL."""
    m = re.search(r"/file/d/([a-zA-Z0-9-_]+)", url)
    if m:
        return f"https://drive.google.com/uc?export=download&id={m.group(1)}&confirm=t"
    m = re.search(r"[?&]id=([a-zA-Z0-9-_]+)", url)
    if m:
        return f"https://drive.google.com/uc?export=download&id={m.group(1)}&confirm=t"
    return url


def _fetch(url: str) -> requests.Response:
    r = requests.get(url, timeout=20, allow_redirects=True, headers=_HEADERS)
    r.raise_for_status()
    return r


class ImportRequest(BaseModel):
    sheet_url: str


@router.post("/google-sheet", dependencies=[Depends(require_admin)])
def import_from_sheet(body: ImportRequest, db: Session = Depends(get_db)):
    try:
        csv_url = _csv_url(body.sheet_url)
    except ValueError as e:
        return {"success": False, "error": str(e)}

    try:
        sheet_r = _fetch(csv_url)
    except Exception as e:
        return {"success": False, "error": f"Could not fetch sheet — make sure it is shared as 'Anyone with link can view': {e}"}

    reader = csv.DictReader(io.StringIO(sheet_r.text))

    raw_fields = reader.fieldnames or []
    norm = {k: k.strip().lower().replace(" ", "_") for k in raw_fields}

    event_cache: dict[str, int] = {}
    imported = 0
    errors: list[str] = []
    created_users: list[dict] = []

    for raw_row in reader:
        row = {norm[k]: (v or "").strip() for k, v in raw_row.items() if k}

        name = row.get("name", "")
        if not name:
            continue

        event_name = row.get("event_name", row.get("event", ""))
        event_id = None
        if event_name:
            if event_name not in event_cache:
                ev = db.query(Event).filter(Event.name == event_name).first()
                if not ev:
                    ev = Event(name=event_name)
                    db.add(ev)
                    db.commit()
                    db.refresh(ev)
                event_cache[event_name] = ev.id
            event_id = event_cache[event_name]

        image_url = None
        photo_raw = row.get("photo", row.get("photo_url", row.get("image", "")))
        if photo_raw:
            try:
                photo_r = _fetch(_direct_url(photo_raw))
                filename = f"{uuid.uuid4().hex}.jpg"
                filepath = os.path.join(UPLOAD_DIR, filename)
                with open(filepath, "wb") as f:
                    f.write(photo_r.content)
                image_url = f"/uploads/{filename}"
            except Exception as e:
                errors.append(f"{name}: photo download failed — {e}")

        user = User(
            name=name,
            email=row.get("gmail", row.get("email", "")) or None,
            phone=row.get("phone_no", row.get("phone_number", row.get("phone", ""))) or None,
            linkedin=row.get("linkedin", "") or None,
            occupation=row.get("occupation", "") or None,
            company=row.get("company", row.get("organization", "")) or None,
            industry=row.get("industry", "") or None,
            business_description=(
                row.get("business_description")
                or row.get("business description")
                or row.get("description")
                or None
            ),
            image_url=image_url,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        if event_id is not None:
            db.add(Attendance(user_id=user.id, event_id=event_id, status="enrolled"))
            db.commit()

        created_users.append(search_engine.user_to_dict(user))
        imported += 1

    engine = search_engine.get_engine()
    if engine:
        engine.upsert_bulk(created_users)

    return {
        "success": True,
        "imported": imported,
        "skipped": len(errors),
        "events_created": list(event_cache.keys()),
        "errors": errors,
    }


def _file_missing_on_disk(image_url: Optional[str]) -> bool:
    """True if image_url is set but the referenced file is not in UPLOAD_DIR."""
    if not image_url:
        return False
    fname = os.path.basename(image_url)
    return not os.path.exists(os.path.join(UPLOAD_DIR, fname))


def _fill_if_null(obj, **fields) -> bool:
    """Set attributes on obj only where the current value is falsy. Returns True if anything changed.
    Special case: image_url is also replaced if the existing file is missing on disk (orphan URL)."""
    changed = False
    for k, v in fields.items():
        if not v:
            continue
        current = getattr(obj, k, None)
        if not current:
            setattr(obj, k, v)
            changed = True
        elif k == "image_url" and _file_missing_on_disk(current):
            setattr(obj, k, v)
            changed = True
    return changed


@router.post("/csv-upload", dependencies=[Depends(require_admin)])
async def import_csv_upload(
    csv_file: UploadFile = File(...),
    images: List[UploadFile] = File(...),
    event_name: str = Form(""),
    db: Session = Depends(get_db),
):
    try:
        return await _do_csv_upload(csv_file, images, event_name, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("CSV import failed")
        raise HTTPException(status_code=500, detail=f"Import crashed: {type(e).__name__}: {e}")


async def _do_csv_upload(csv_file, images, event_name, db):
    raw = await csv_file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="CSV file is empty.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV has no header row.")
    raw_fields = reader.fieldnames or []
    norm = {k: k.strip().lower().replace(" ", "_") for k in raw_fields}

    img_map: dict[str, bytes] = {}
    for img in images:
        if not img.filename:
            continue
        img_map[os.path.basename(img.filename)] = await img.read()

    event_id: Optional[int] = None
    event_created = False
    event_name = (event_name or "").strip()
    if event_name:
        ev = db.query(Event).filter(Event.name == event_name).first()
        if not ev:
            ev = Event(name=event_name)
            db.add(ev)
            db.commit()
            db.refresh(ev)
            event_created = True
        event_id = ev.id

    inserted = 0
    updated = 0
    enrolled = 0
    errors: list[str] = []
    touched_users: list[dict] = []

    for raw_row in reader:
        row = {norm[k]: (v or "").strip() for k, v in raw_row.items() if k}

        name = row.get("full_name") or row.get("name") or ""
        if not name:
            continue
        email = (row.get("email") or row.get("gmail") or "").lower() or None

        image_url = None
        img_ref = row.get("image_filename") or row.get("photo") or row.get("image") or ""
        if img_ref:
            img_bytes = img_map.get(os.path.basename(img_ref))
            if img_bytes:
                try:
                    _, saved = save_upload_bytes(img_bytes, os.path.basename(img_ref))
                    image_url = f"/uploads/{saved}"
                except Exception as e:
                    errors.append(f"{name}: failed to save photo — {e}")
            else:
                errors.append(f"{name}: image file '{os.path.basename(img_ref)}' not uploaded")

        existing = db.query(User).filter(User.email.ilike(email)).first() if email else None

        if existing:
            if existing.role == "admin":
                errors.append(f"{name}: skipped (matches admin account)")
                continue
            changed = _fill_if_null(
                existing,
                name=name,
                phone=row.get("phone") or row.get("phone_no") or row.get("phone_number") or None,
                linkedin=row.get("linkedin") or None,
                occupation=row.get("occupation") or None,
                company=row.get("company") or row.get("organization") or None,
                industry=row.get("industry") or None,
                business_description=(
                    row.get("business_description")
                    or row.get("description")
                    or None
                ),
                image_url=image_url,
            )
            if changed:
                db.commit()
                db.refresh(existing)
                updated += 1
            user = existing
        else:
            user = User(
                name=name,
                email=email,
                phone=row.get("phone") or row.get("phone_no") or row.get("phone_number") or None,
                linkedin=row.get("linkedin") or None,
                occupation=row.get("occupation") or None,
                company=row.get("company") or row.get("organization") or None,
                industry=row.get("industry") or None,
                business_description=(
                    row.get("business_description")
                    or row.get("description")
                    or None
                ),
                image_url=image_url,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            inserted += 1

        if event_id is not None:
            existing_att = db.query(Attendance).filter(
                Attendance.user_id == user.id,
                Attendance.event_id == event_id,
            ).first()
            if not existing_att:
                db.add(Attendance(user_id=user.id, event_id=event_id, status="enrolled"))
                db.commit()
                enrolled += 1

        touched_users.append(search_engine.user_to_dict(user))

    engine = search_engine.get_engine()
    if engine and touched_users:
        try:
            engine.upsert_bulk(touched_users)
        except Exception as e:
            errors.append(f"search index sync failed: {e}")

    return {
        "success": True,
        "inserted": inserted,
        "updated": updated,
        "enrolled_in_event": enrolled,
        "event_created": event_created,
        "event_name": event_name or None,
        "skipped": len(errors),
        "errors": errors,
    }
