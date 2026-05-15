from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from datetime import datetime
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255))
    phone = Column(String(50))
    linkedin = Column(String(255))
    occupation = Column(String(255))
    company = Column(String(255))
    industry = Column(String(255))
    website = Column(String(255))
    business_description = Column(String)
    image_url = Column(String)
    registered_at = Column(DateTime, default=datetime.utcnow)
    password_hash = Column(String(255), nullable=True)
    role = Column(String(20), nullable=False, default="user")


class AdminSettings(Base):
    __tablename__ = "admin_settings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    email_user = Column(String(255), nullable=True)
    email_password = Column(String(255), nullable=True)
    email_from = Column(String(255), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)


class Attendance(Base):
    __tablename__ = "attendance"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    event_id = Column(Integer, ForeignKey("events.id"), nullable=True)
    status = Column(String(50), default="present")
    check_in_type = Column(String(20), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    checked_out_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "event_id", name="uq_attendance_user_event"),
    )
