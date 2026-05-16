import chromadb
from openai import OpenAI
from ..config import settings


class ChromaEmbedder:
    def __init__(self):
        self._client = chromadb.PersistentClient(path=settings.chroma_persist_dir)
        self._collection = self._client.get_or_create_collection(
            name="invoices",
            metadata={"hnsw:space": "cosine"},
        )
        self._openai = OpenAI(
            api_key=settings.gemini_api_key,
            base_url=settings.gemini_base_url,
        )

    def _embed(self, texts: list[str]) -> list[list[float]]:
        response = self._openai.embeddings.create(
            model=settings.gemini_embed_model,
            input=texts,
        )
        return [item.embedding for item in response.data]

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
            }
            for c in chunks
        ]

        self._collection.upsert(ids=ids, embeddings=embeddings, metadatas=metadatas, documents=texts)

    def query(self, text: str, n_results: int = 5, where: dict | None = None) -> list[dict]:
        count = self._collection.count()
        if count == 0:
            return []
        n_results = min(n_results, count)

        embedding = self._embed([text])[0]
        kwargs: dict = {"query_embeddings": [embedding], "n_results": n_results}
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
        return output

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
