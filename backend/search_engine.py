import os
import re
import time
import logging
from typing import Optional, List, Dict, Any

from pinecone import Pinecone, ServerlessSpec
from fastembed import TextEmbedding

logger = logging.getLogger(__name__)

PINECONE_API_KEY  = os.getenv("PINECONE_API_KEY", "")
PINECONE_INDEX    = os.getenv("PINECONE_INDEX", "attendees")
PINECONE_CLOUD    = os.getenv("PINECONE_CLOUD", "aws")
PINECONE_REGION   = os.getenv("PINECONE_REGION", "us-east-1")
EMBEDDING_MODEL   = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
VECTOR_SIZE       = int(os.getenv("VECTOR_SIZE", "384"))
SCORE_THRESHOLD   = float(os.getenv("SCORE_THRESHOLD", "0.55"))

_engine: Optional["SearchEngine"] = None


def get_engine() -> Optional["SearchEngine"]:
    return _engine


def init_engine() -> None:
    global _engine
    if not PINECONE_API_KEY:
        logger.warning("[search] PINECONE_API_KEY not set — vector search disabled")
        return
    try:
        _engine = SearchEngine()
    except Exception as e:
        logger.error("[search] Failed to initialize: %s", e)


def user_to_dict(user) -> dict:
    """Convert a SQLAlchemy User model to a plain dict safe for background tasks."""
    return {
        "id":                   user.id,
        "name":                 user.name,
        "email":                user.email,
        "phone":                user.phone,
        "company":              user.company,
        "occupation":           user.occupation,
        "industry":             user.industry,
        "business_description": user.business_description,
        "website":              user.website,
        "linkedin":             user.linkedin,
    }


def bg_upsert(user_dict: dict) -> None:
    """Background-task-safe upsert — swallows errors."""
    engine = get_engine()
    if engine:
        try:
            engine.upsert(user_dict)
        except Exception as e:
            logger.warning("search bg_upsert failed user=%s: %s", user_dict.get("id"), e)


def bg_delete(user_id: int) -> None:
    """Background-task-safe delete — swallows errors."""
    engine = get_engine()
    if engine:
        try:
            engine.delete(user_id)
        except Exception as e:
            logger.warning("search bg_delete failed user=%s: %s", user_id, e)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _strip_noise(text: str) -> str:
    """Remove emoji, non-ASCII symbols, and collapse whitespace."""
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^\w\s.,&@()\-/]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _build_text(u: dict) -> str:
    parts = [
        u.get("role") or "",
        u.get("industry") or "",
        u.get("organization") or "",
        u.get("detailed_profile") or "",
    ]
    raw = " ".join(p for p in parts if p).strip()
    return _strip_noise(raw)


def _clean_meta(payload: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    for k, v in payload.items():
        if v is None:
            continue
        if isinstance(v, (str, int, float, bool)):
            out[k] = v
        else:
            out[k] = str(v)
    return out


def _user_payload(u: dict) -> dict:
    uid = str(u["id"])
    return {
        "_original_id":       uid,
        "full_name":          u.get("name") or "",
        "email":              u.get("email") or f"user-{uid}@local.invalid",
        "phone":              u.get("phone"),
        "organization":       u.get("company") or u.get("occupation") or "Independent",
        "role":               u.get("occupation") or u.get("industry") or "Member",
        "industry":           u.get("industry") or "",
        "detailed_profile":   u.get("business_description"),
        "linkedin_url":       u.get("website") or u.get("linkedin"),
    }


# ── SearchEngine ──────────────────────────────────────────────────────────────

class SearchEngine:
    def __init__(self):
        pc = Pinecone(api_key=PINECONE_API_KEY)
        self._ensure_index(pc)
        self.index = pc.Index(PINECONE_INDEX)
        logger.info("[search] Loading embedding model: %s", EMBEDDING_MODEL)
        self.embedder = TextEmbedding(model_name=EMBEDDING_MODEL)
        logger.info("[search] Search engine ready")

    def _ensure_index(self, pc: Pinecone) -> None:
        existing = {idx.name for idx in pc.list_indexes()}
        if PINECONE_INDEX in existing:
            return
        logger.info("[search] Creating Pinecone index '%s'...", PINECONE_INDEX)
        pc.create_index(
            name=PINECONE_INDEX,
            dimension=VECTOR_SIZE,
            metric="cosine",
            spec=ServerlessSpec(cloud=PINECONE_CLOUD, region=PINECONE_REGION),
        )
        start = time.time()
        while time.time() - start < 60:
            if pc.describe_index(PINECONE_INDEX).status.get("ready"):
                return
            time.sleep(2)
        raise TimeoutError("Pinecone index not ready in 60s")

    def _embed(self, text: str) -> List[float]:
        return list(self.embedder.embed([text]))[0].tolist()

    def _embed_batch(self, texts: List[str]) -> List[List[float]]:
        return [v.tolist() for v in self.embedder.embed(texts)]

    def upsert(self, u: dict) -> None:
        uid = str(u["id"])
        payload = _clean_meta(_user_payload(u))
        text = _build_text(payload)
        if not text:
            return
        self.index.upsert(vectors=[{
            "id":       uid,
            "values":   self._embed(text),
            "metadata": payload,
        }])

    def upsert_bulk(self, users: List[dict]) -> None:
        if not users:
            return
        payloads = [_clean_meta(_user_payload(u)) for u in users]
        pairs = [(p, _build_text(p)) for p in payloads]
        pairs = [(p, t) for p, t in pairs if t]   # skip empty profiles
        if not pairs:
            return
        payloads, texts = zip(*pairs)
        vectors  = self._embed_batch(list(texts))
        batch = [
            {"id": p["_original_id"], "values": v, "metadata": p}
            for p, v in zip(payloads, vectors)
        ]
        for i in range(0, len(batch), 100):
            self.index.upsert(vectors=batch[i:i + 100])
        logger.info("[search] Bulk upserted %d users", len(batch))

    def delete(self, user_id: int) -> None:
        self.index.delete(ids=[str(user_id)])

    def delete_all(self) -> None:
        self.index.delete(delete_all=True)

    def search(
        self,
        query: str,
        limit: int = 10,
        filters: Optional[Dict[str, str]] = None,
    ) -> List[dict]:
        vec = self._embed(query)
        pf  = {k: {"$eq": v} for k, v in filters.items() if v} if filters else None
        resp = self.index.query(vector=vec, top_k=limit, include_metadata=True, filter=pf)
        results = []
        for m in resp["matches"]:
            if m["score"] < SCORE_THRESHOLD:
                continue
            meta = m["metadata"]
            results.append({
                "id":               meta.get("_original_id", m["id"]),
                "full_name":        meta.get("full_name", ""),
                "role":             meta.get("role", ""),
                "organization":     meta.get("organization", ""),
                "experience_level": meta.get("experience_level"),
                "detailed_profile": meta.get("detailed_profile"),
                "linkedin_url":     meta.get("linkedin_url"),
                "score":            round(min(m["score"], 1.0), 4),
            })
        return sorted(results, key=lambda r: r["score"], reverse=True)

    def reindex_all_from_db(self, users: List[dict]) -> int:
        """Re-embed all users from source DB records (picks up new fields)."""
        if not users:
            return 0
        self.upsert_bulk(users)
        logger.info("[search] Full reindex complete: %d users", len(users))
        return len(users)

    def reindex_by_ids(self, ids: List[str]) -> int:
        """Re-embed specific vectors using their existing Pinecone metadata."""
        fetch_result = self.index.fetch(ids=ids)
        vectors = fetch_result.get("vectors", {})
        batch = []
        for vid, vdata in vectors.items():
            meta = vdata.get("metadata", {})
            text = _build_text(meta)
            if not text:
                continue
            batch.append({"id": vid, "values": self._embed(text), "metadata": meta})
        if batch:
            self.index.upsert(vectors=batch)
        logger.info("[search] Reindexed %d vectors", len(batch))
        return len(batch)
