from openai import OpenAI
from ..config import settings

_REFUSAL = "Δεν βρέθηκε στο έγγραφο."

_SYSTEM_PROMPT = (
    "You are a precise invoice analysis assistant. "
    "Answer ONLY using the provided context. Each context line is tagged with "
    "its trust level:\n"
    "  [verified]     — two independent extractors agree. Use these as ground truth.\n"
    "  [model_only]   — fine-tuned extractor only. Trust for IDs/dates/names; "
    "be cautious with amounts.\n"
    "  [gemini_only]  — VLM only. Reasonable but unverified.\n"
    "  [disputed]     — sources disagree. The line shows both values separated by ⟂. "
    "Mention BOTH possibilities and that they conflict; do NOT pick one silently.\n"
    "  [ocr_block]    — raw OCR text. Use only when no extracted line answers the question.\n"
    f"If the answer is not explicitly present in the context, respond with exactly: '{_REFUSAL}' "
    "Never invent or normalize values that are not literally in the context."
)


def _format_chunk(c: dict) -> str:
    meta = c.get("metadata", {})
    src = meta.get("source_type", "ocr_block")
    ctype = meta.get("chunk_type", "chunk")
    verification = meta.get("verification", "model_only")
    if src == "extracted":
        tag = f"[{verification}/{ctype}"
        conf = meta.get("confidence")
        if isinstance(conf, (int, float)):
            tag += f" conf={conf:.2f}"
        tag += "]"
    else:
        tag = f"[{src}/{ctype}]"
    return f"{tag} {c['text']}"


class LLMService:
    def __init__(self):
        self._client = OpenAI(
            api_key=settings.gemini_api_key,
            base_url=settings.gemini_base_url,
        )

    def generate_answer(self, query: str, context_chunks: list[dict]) -> dict:
        context = "\n\n".join(_format_chunk(c) for c in context_chunks)

        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {query}"},
        ]

        response = self._client.chat.completions.create(
            model=settings.gemini_chat_model,
            messages=messages,
            temperature=0,
            max_tokens=512,
        )

        answer = response.choices[0].message.content or _REFUSAL
        refused = _REFUSAL in answer

        return {"answer": answer, "refused": refused}

    def generate_chat_answer(self, messages: list[dict], context_chunks: list[dict]) -> dict:
        context = "\n\n".join(_format_chunk(c) for c in context_chunks)

        system = f"{_SYSTEM_PROMPT}\n\nContext from invoice:\n{context}"
        full_messages = [{"role": "system", "content": system}] + messages

        response = self._client.chat.completions.create(
            model=settings.gemini_chat_model,
            messages=full_messages,
            temperature=0,
            max_tokens=512,
        )

        answer = response.choices[0].message.content or _REFUSAL
        refused = _REFUSAL in answer

        return {"answer": answer, "refused": refused}

    def self_check(self, answer: str, context_chunks: list[dict]) -> bool:
        if not context_chunks:
            return False

        context = "\n\n".join(c["text"] for c in context_chunks)
        prompt = (
            "Does the following answer appear verbatim or as a paraphrase of the provided context? "
            "Answer only Yes or No.\n\n"
            f"Answer: {answer}\n\nContext:\n{context}"
        )

        response = self._client.chat.completions.create(
            model=settings.gemini_chat_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=5,
        )

        result = (response.choices[0].message.content or "").strip().lower()
        return result.startswith("yes")
