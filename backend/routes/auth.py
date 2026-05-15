import os

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from auth import create_access_token, get_current_user, hash_password, verify_password
from database import get_db
from image_storage import save_base64_image, save_upload_bytes
from models import Attendance, AdminSettings, Event, User
from notifications import send_registration_email
import search_engine

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_auth_cookie(response: Response, user: User) -> dict:
    token = create_access_token(user.id, user.role)
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=os.getenv("RENDER") is not None,
        max_age=7 * 24 * 3600,
    )
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role}


@router.post("/login")
def login(
    response: Response,
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.email == email.strip()).first()
    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    return _set_auth_cookie(response, user)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("access_token", samesite="lax", secure=os.getenv("RENDER") is not None)
    return {"success": True}


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "role": current_user.role,
    }


@router.post("/signup")
async def signup(
    response: Response,
    background_tasks: BackgroundTasks,
    name: str = Form(...),
    email: str = Form(None),
    password: str = Form(None),
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
):
    if email:
        existing = db.query(User).filter(User.email == email.strip()).first()
        if existing:
            raise HTTPException(status_code=400, detail="An account with this email already exists.")

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
        password_hash=hash_password(password) if password else None,
        role="user",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    background_tasks.add_task(search_engine.bg_upsert, search_engine.user_to_dict(user))

    if event_id is not None:
        db.add(Attendance(user_id=user.id, event_id=event_id, status="enrolled"))
        db.commit()

        if user.email:
            base_url = os.getenv("APP_BASE_URL", "http://localhost:5173").rstrip("/")
            display_url = f"{base_url}/display/{event_id}"

            admin_cfg = None
            if event.created_by:
                admin_cfg = db.query(AdminSettings).filter(AdminSettings.user_id == event.created_by).first()
            if not admin_cfg:
                admin_cfg = db.query(AdminSettings).filter(
                    AdminSettings.email_user.isnot(None),
                    AdminSettings.email_password.isnot(None),
                ).first()

            background_tasks.add_task(
                send_registration_email,
                user.email, user.name, event_name, display_url,
                admin_cfg.email_user if admin_cfg else None,
                admin_cfg.email_password if admin_cfg else None,
                admin_cfg.email_from if admin_cfg else None,
            )

    if password:
        return _set_auth_cookie(response, user)
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role}
