import chromadb
import requests
from ..config import settings

# Gemini's text-embedding-004 is only reachable via the native REST API,
# not the OpenAI-compatible shim.  We call batchEmbedContents directly.
_EMBED_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta"
    "/models/{model}:batchEmbedContents?key={key}"
)


class ChromaEmbedder:
    def __init__(self):
        self._client = chromadb.PersistentClient(path=settings.chroma_persist_dir)
        self._collection = self._client.get_or_create_collection(
            name="invoices",
            metadata={"hnsw:space": "cosine"},
        )

    def _embed(self, texts: list[str]) -> list[list[float]]:
        url = _EMBED_URL_TEMPLATE.format(
            model=settings.gemini_embed_model,
            key=settings.gemini_api_key,
        )
        payload = {
            "requests": [
                {
                    "model": f"models/{settings.gemini_embed_model}",
                    "content": {"parts": [{"text": t}]},
                }
                for t in texts
            ]
        }
        resp = requests.post(url, json=payload, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        return [e["values"] for e in data["embeddings"]]

    def embed_chunks(self, chunks: list[dict]) -> None:
        if not chunks:
            return

        texts = [c["text"] for c in chunks]
        embeddings = self._embed(texts)

        ids = [f"{c['source_file']}_{c['chunk_index']}" for c in chunks]
        metadatas = [
            {
                "page_num": c["page_num"],
                "x0": c["x0"],
                "y0": c["y0"],
                "x1": c["x1"],
                "y1": c["y1"],
                "source_file": c["source_file"],
                "chunk_type": c["chunk_type"],
                "chunk_index": c["chunk_index"],
                "text": c["text"],
                "source_type": c.get("source_type", "ocr_block"),
                "confidence": float(c.get("confidence", 1.0)),
                "entity": c.get("entity", ""),
                "verification": c.get("verification", "model_only"),
                "agreement": float(c.get("agreement", 0.0)),
                "model_value": c.get("model_value", ""),
                "gemini_value": c.get("gemini_value", ""),
            }
            for c in chunks
        ]

        self._collection.upsert(ids=ids, embeddings=embeddings, metadatas=metadatas, documents=texts)

    def query(self, text: str, n_results: int = 5, where: dict | None = None,
              boost_extracted: bool = True) -> list[dict]:
        count = self._collection.count()
        if count == 0:
            return []
        # over-fetch so we can promote model-extracted chunks to the top
        fetch_k = min(max(n_results * 3, n_results), count)

        embedding = self._embed([text])[0]
        kwargs: dict = {"query_embeddings": [embedding], "n_results": fetch_k}
        if where:
            kwargs["where"] = where

        results = self._collection.query(**kwargs, include=["metadatas", "distances", "documents"])

        output = []
        if results["ids"] and results["ids"][0]:
            for meta, dist, doc in zip(
                results["metadatas"][0],
                results["distances"][0],
                results["documents"][0],
            ):
                output.append({"text": doc, "metadata": meta, "distance": dist})

        if boost_extracted:
            # Trust ladder: verified ≫ model_only ≫ gemini_only ≫ ocr_block ≫ disputed.
            # Stable sort, breaking ties by vector distance.
            tier = {"verified": 0, "model_only": 1, "gemini_only": 2,
                    "model_or_ocr": 3, "disputed": 4}

            def _rank(item: dict) -> tuple[int, float]:
                meta = item["metadata"]
                if meta.get("source_type") == "extracted":
                    v = meta.get("verification", "model_only")
                    return tier.get(v, 1), item["distance"]
                return 3, item["distance"]

            output.sort(key=_rank)
        return output[:n_results]

    def delete_by_source(self, source_file: str) -> None:
        try:
            self._collection.delete(where={"source_file": source_file})
        except Exception:
            pass

    def list_sources(self) -> list[str]:
        results = self._collection.get(include=["metadatas"])
        seen = set()
        for meta in results["metadatas"]:
            seen.add(meta.get("source_file", ""))
        return sorted(s for s in seen if s)
