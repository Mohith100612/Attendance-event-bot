import base64
import httpx
import json
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

GROQ_API_KEY        = os.getenv("GROQ_API_KEY")
GROQ_BASE_URL       = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
GROQ_MODEL          = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
GROQ_QUERY_EXPANSION = os.getenv("GROQ_QUERY_EXPANSION", "true").lower() == "true"


def _auth_header(api_key: str) -> str:
    # "user:pass" format → Basic auth (nginx-proxied Ollama)
    # plain token → Bearer (Groq / raw Ollama)
    if ":" in api_key:
        return "Basic " + base64.b64encode(api_key.encode()).decode()
    return f"Bearer {api_key}"


PARSE_PROMPT = """\
You are a search assistant for a professional directory of event attendees.
Given a natural language query, produce a compact keyword-rich search phrase \
that would retrieve the most relevant professional profiles from a semantic vector database.

Rules:
- Strip conversational filler ("people who", "find me", "show me", "I want", "give me").
- Preserve the full intent of the query — domain, role, industry, activity, specialty.
- Expand with synonyms, related job titles, and adjacent terms a professional profile \
  would actually contain. Stay on-topic; do not drift into unrelated fields.
- 6-10 words total.

Also extract optional hard filters:
- "experience_level": "junior" | "mid" | "senior" | "expert" — only if explicitly mentioned
    junior = 0-2 yrs / fresher; mid = 3-5 yrs; senior = 5-8 yrs; expert = 10+ yrs / lead
- "organization": exact company name — only if explicitly mentioned

Return ONLY valid JSON, no markdown, no explanation:
{{"semantic_query": "...", "filters": {{}}}}

Example:
Query: "senior data scientists at Google"
{{"semantic_query": "data scientist machine learning analytics Python statistics", "filters": {{"experience_level": "senior", "organization": "Google"}}}}

Now parse this query:
Query: "{query}"
"""


async def _call_llm(prompt: str, max_tokens: int = 150) -> Optional[str]:
    if not GROQ_API_KEY:
        return None
    headers = {
        "Authorization": _auth_header(GROQ_API_KEY),
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Try OpenAI-compat endpoint first (Groq / OpenAI / Ollama with /v1)
            resp = await client.post(
                f"{GROQ_BASE_URL}/chat/completions",
                headers=headers,
                json={
                    "model": GROQ_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": max_tokens,
                    "temperature": 0.1,
                },
            )
            if resp.status_code == 404:
                # Proxy blocks /v1/chat/completions → fall back to native Ollama /api/chat
                base = GROQ_BASE_URL.rstrip("/").removesuffix("/v1")
                resp = await client.post(
                    f"{base}/api/chat",
                    headers=headers,
                    json={
                        "model": GROQ_MODEL,
                        "messages": [{"role": "user", "content": prompt}],
                        "stream": False,
                        "options": {"temperature": 0.1, "num_predict": max_tokens},
                    },
                )
                resp.raise_for_status()
                # Ollama may return newline-delimited JSON chunks even with stream=false;
                # concatenate content from every chunk that has text.
                decoder = json.JSONDecoder()
                text = resp.text.strip()
                parts, pos = [], 0
                while pos < len(text):
                    try:
                        chunk, end = decoder.raw_decode(text, pos)
                        token = chunk.get("message", {}).get("content", "")
                        if token:
                            parts.append(token)
                        pos = end
                        while pos < len(text) and text[pos] in " \t\n\r":
                            pos += 1
                    except json.JSONDecodeError:
                        break
                return "".join(parts).strip() or None
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        logger.warning("LLM call failed: %s", e)
        return None


async def parse_query(query: str) -> dict:
    """
    Parse a natural language query into:
      - semantic_query: expanded query for vector search
      - filters: hard filters (experience_level, organization)

    Falls back to raw query with no filters if LLM is unavailable.
    """
    if not GROQ_API_KEY or not GROQ_QUERY_EXPANSION:
        return {"semantic_query": query, "filters": {}}

    raw = await _call_llm(PARSE_PROMPT.format(query=query))
    if not raw:
        return {"semantic_query": query, "filters": {}}

    try:
        cleaned = raw.replace("```json", "").replace("```", "").strip()
        # raw_decode stops at the end of the first valid JSON object,
        # ignoring any extra text the LLM appends after it
        parsed, _ = json.JSONDecoder().raw_decode(cleaned)
        semantic = parsed.get("semantic_query", query).strip() or query
        filters  = {
            k: v for k, v in parsed.get("filters", {}).items()
            if v and isinstance(v, str)
        }
        logger.info("Parsed '%s' → semantic='%s' filters=%s", query, semantic[:60], filters)
        return {"semantic_query": semantic, "filters": filters}
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        logger.warning("Failed to parse LLM response '%s': %s", raw, e)
        return {"semantic_query": query, "filters": {}}
