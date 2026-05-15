import os

from fastapi import APIRouter, BackgroundTasks, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.orm import Session

from auth import require_admin
from database import get_db
from image_storage import UPLOAD_DIR, save_base64_image, save_upload_bytes
from models import Attendance, AdminSettings, Event, User
from notifications import send_registration_email
import search_engine

router = APIRouter(prefix="/api/register", tags=["register"])


@router.post("")
async def register_user(
    background_tasks: BackgroundTasks,
    name: str = Form(...),
    email: str = Form(None),
    phone: str = Form(None),
    linkedin: str = Form(None),
    occupation: str = Form(None),
    company: str = Form(None),
    industry: str = Form(None),
    business_description: str = Form(None),
    event_id: int = Form(None),
    image: UploadFile = File(None),
    image_base64: str = Form(None),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    event_name = None
    if event_id is not None:
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found.")
        event_name = event.name

    image_url = None
    if image:
        file_bytes = await image.read()
        _, filename = save_upload_bytes(file_bytes, image.filename)
        image_url = f"/uploads/{filename}"
    elif image_base64:
        filepath = save_base64_image(image_base64)
        image_url = f"/uploads/{os.path.basename(filepath)}"

    user = User(
        name=name.strip(),
        email=email.strip() if email else None,
        phone=phone.strip() if phone else None,
        linkedin=linkedin.strip() if linkedin else None,
        occupation=occupation.strip() if occupation else None,
        company=company.strip() if company else None,
        industry=industry.strip() if industry else None,
        business_description=business_description.strip() if business_description else None,
        image_url=image_url,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    background_tasks.add_task(search_engine.bg_upsert, search_engine.user_to_dict(user))

    if event_id is not None:
        db.add(Attendance(user_id=user.id, event_id=event_id, status="enrolled"))
        db.commit()

        if user.email:
            admin_cfg = db.query(AdminSettings).filter(AdminSettings.user_id == current_user.id).first()
            base_url = os.getenv("APP_BASE_URL", "http://localhost:5173").rstrip("/")
            display_url = f"{base_url}/display/{event_id}"
            background_tasks.add_task(
                send_registration_email,
                user.email, user.name, event_name, display_url,
                admin_cfg.email_user if admin_cfg else None,
                admin_cfg.email_password if admin_cfg else None,
                admin_cfg.email_from if admin_cfg else None,
            )

    return {
        "success": True,
        "user_id": user.id,
        "name": user.name,
        "event_name": event_name,
    }


@router.get("/users", dependencies=[Depends(require_admin)])
def list_users(db: Session = Depends(get_db)):
    users = db.query(User).filter(User.role != "admin").order_by(User.registered_at.desc()).all()
    return [
        {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "phone": u.phone,
            "linkedin": u.linkedin,
            "occupation": u.occupation,
            "company": u.company,
            "industry": u.industry,
            "business_description": u.business_description,
            "image_url": u.image_url,
            "registered_at": u.registered_at,
            "role": u.role,
        }
        for u in users
    ]


@router.post("/users/{user_id}/photo", dependencies=[Depends(require_admin)])
async def set_user_photo(
    user_id: int,
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    file_bytes = await image.read()
    _, filename = save_upload_bytes(file_bytes, image.filename)

    old_url = user.image_url
    user.image_url = f"/uploads/{filename}"
    db.commit()
    db.refresh(user)

    if old_url:
        old_path = os.path.join(UPLOAD_DIR, os.path.basename(old_url))
        if os.path.exists(old_path):
            try:
                os.remove(old_path)
            except OSError:
                pass

    background_tasks.add_task(search_engine.bg_upsert, search_engine.user_to_dict(user))

    return {"success": True, "image_url": user.image_url}


@router.delete("/users/{user_id}", dependencies=[Depends(require_admin)])
def delete_user(user_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.role == "admin":
        raise HTTPException(status_code=403, detail="Admin accounts cannot be deleted.")

    db.query(Attendance).filter(Attendance.user_id == user_id).delete()

    if user.image_url:
        filename = os.path.basename(user.image_url)
        filepath = os.path.join(UPLOAD_DIR, filename)
        if os.path.exists(filepath):
            os.remove(filepath)

    db.delete(user)
    db.commit()

    background_tasks.add_task(search_engine.bg_delete, user_id)

    return {"success": True}
