import hashlib
import time
import unicodedata
from openai import OpenAI, RateLimitError
from ..config import settings

_REFUSAL = "Δεν βρέθηκε στο έγγραφο."

_SYSTEM_PROMPT = (
    "You are a precise invoice analysis assistant. "
    "Answer ONLY using the provided context. "
    f"If the answer is not explicitly present in the context, respond with exactly: '{_REFUSAL}' "
    "Do not add information not present in the context."
)

# ── Answer cache ───────────────────────────────────────────────────────────────
_answer_cache: dict[str, dict] = {}

# ── Usage counters ─────────────────────────────────────────────────────────────
_usage: dict[str, int] = {
    "cache_hits": 0,
    "cache_misses": 0,
    "total_input_tokens": 0,
    "total_output_tokens": 0,
    "rate_limit_hits": 0,
}


def get_usage_stats() -> dict:
    return {**_usage, "cache_size": len(_answer_cache)}


def _normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text.lower().strip())


def _cache_key(question: str, source_file: str | None, top_k: int) -> str:
    raw = f"{source_file or ''}|{_normalize(question)}|{top_k}|{settings.gemini_chat_model}"
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def _trim_chunk(text: str, max_chars: int = 400) -> str:
    return text[:max_chars] if len(text) > max_chars else text


class LLMService:
    def __init__(self):
        self._client = OpenAI(
            api_key=settings.gemini_api_key,
            base_url=settings.gemini_base_url,
        )

    def _call(self, messages: list[dict]) -> any:
        """Call the API with exponential backoff on 429."""
        delay = 1.0
        for attempt in range(4):
            try:
                return self._client.chat.completions.create(
                    model=settings.gemini_chat_model,
                    messages=messages,
                    temperature=0,
                    max_tokens=settings.max_tokens,
                )
            except RateLimitError:
                _usage["rate_limit_hits"] += 1
                if attempt == 3:
                    raise
                time.sleep(delay)
                delay *= 2

    def _build_context(self, chunks: list[dict]) -> str:
        return "\n\n".join(
            f"[{c['metadata'].get('chunk_type', 'chunk')}] {_trim_chunk(c['text'])}"
            for c in chunks
        )

    def generate_answer(
        self,
        query: str,
        context_chunks: list[dict],
        source_file: str | None = None,
    ) -> dict:
        key = _cache_key(query, source_file, len(context_chunks))
        if key in _answer_cache:
            _usage["cache_hits"] += 1
            return {**_answer_cache[key], "cached": True}

        _usage["cache_misses"] += 1
        context = self._build_context(context_chunks)
        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {query}"},
        ]
        response = self._call(messages)
        if response and response.usage:
            _usage["total_input_tokens"] += response.usage.prompt_tokens or 0
            _usage["total_output_tokens"] += response.usage.completion_tokens or 0

        answer = response.choices[0].message.content or _REFUSAL
        refused = _REFUSAL in answer
        result = {"answer": answer, "refused": refused}
        _answer_cache[key] = result
        return {**result, "cached": False}

    def generate_chat_answer(
        self,
        messages: list[dict],
        context_chunks: list[dict],
        source_file: str | None = None,
    ) -> dict:
        # Only send latest user question — not the full history — to keep cost constant.
        user_messages = [m for m in messages if m["role"] == "user"]
        latest_query = user_messages[-1]["content"] if user_messages else ""

        key = _cache_key(latest_query, source_file, len(context_chunks))
        if key in _answer_cache:
            _usage["cache_hits"] += 1
            return {**_answer_cache[key], "cached": True}

        _usage["cache_misses"] += 1
        context = self._build_context(context_chunks)
        call_messages = [
            {"role": "system", "content": f"{_SYSTEM_PROMPT}\n\nContext from invoice:\n{context}"},
            {"role": "user", "content": latest_query},
        ]
        response = self._call(call_messages)
        if response and response.usage:
            _usage["total_input_tokens"] += response.usage.prompt_tokens or 0
            _usage["total_output_tokens"] += response.usage.completion_tokens or 0

        answer = response.choices[0].message.content or _REFUSAL
        refused = _REFUSAL in answer
        result = {"answer": answer, "refused": refused}
        _answer_cache[key] = result
        return {**result, "cached": False}
