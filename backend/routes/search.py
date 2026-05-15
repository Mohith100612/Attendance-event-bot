from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import require_admin
from database import get_db
from groq_client import parse_query
from models import User
from search_engine import get_engine, user_to_dict

router = APIRouter(prefix="/api/search", tags=["search"])


class ReindexRequest(BaseModel):
    ids: List[str]


@router.post("/reindex", dependencies=[Depends(require_admin)])
def reindex(body: ReindexRequest):
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="Search engine not initialised.")
    count = engine.reindex_by_ids(body.ids)
    return {"reindexed": count}


@router.post("/reindex-all", dependencies=[Depends(require_admin)])
def reindex_all(db: Session = Depends(get_db)):
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="Search engine not initialised.")
    users = [user_to_dict(u) for u in db.query(User).filter(User.role != "admin").all()]
    count = engine.reindex_all_from_db(users)
    return {"reindexed": count}


@router.post("/rebuild", dependencies=[Depends(require_admin)])
def rebuild_index(db: Session = Depends(get_db)):
    """Wipe Pinecone and re-embed every non-admin user from the SQL DB.
    Use this to clear orphan vectors left by earlier ingestion paths."""
    engine = get_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="Search engine not initialised.")
    engine.delete_all()
    users = [user_to_dict(u) for u in db.query(User).filter(User.role != "admin").all()]
    count = engine.reindex_all_from_db(users)
    return {"deleted_all": True, "reindexed": count}


@router.get("")
async def search(
    q: str = Query(..., min_length=1, description="Natural language search query"),
    limit: int = Query(10, ge=1, le=50),
    experience_level: Optional[str] = Query(None),
    organization: Optional[str] = Query(None),
):
    engine = get_engine()
    if engine is None:
        return {"query": q, "expanded_query": None, "total": 0, "results": []}

    parsed = await parse_query(q)
    semantic_query = parsed["semantic_query"]
    filters = parsed["filters"]

    if experience_level:
        filters["experience_level"] = experience_level
    if organization:
        filters["organization"] = organization

    results = engine.search(query=semantic_query, limit=limit, filters=filters or None)

    return {
        "query":          q,
        "expanded_query": semantic_query if semantic_query != q else None,
        "total":          len(results),
        "results":        results,
    }
