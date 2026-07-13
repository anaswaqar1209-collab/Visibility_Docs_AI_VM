import numpy as np
import threading
import logging
import hashlib
from .pinecone_service import pinecone_service

logger = logging.getLogger("visibility-docs")


class EmbeddingService:
    def __init__(self):
        self.model = None
        self.model_loaded = False
        self.dimension = 384
        self._lock = threading.Lock()
        self._cache = {}
        self._cache_max = 256

    def _load_model(self):
        if self.model_loaded:
            return
        with self._lock:
            if self.model_loaded:
                return
            try:
                import os as _os
                _os.environ["USE_SHARED_MEMORY"] = "0"
                from sentence_transformers import SentenceTransformer
                self.model = SentenceTransformer("all-MiniLM-L6-v2", device="cpu")
                self.dimension = self.model.get_sentence_embedding_dimension()
                self.model_loaded = True
                logger.info("Embedding model loaded successfully")
            except Exception as e:
                logger.warning(f"Embedding model unavailable: {e}")
                self.model_loaded = True
                self.model = None

    def load(self):
        """Eager-load the model. Call at startup."""
        if not self.model_loaded:
            self._load_model()

    def embed_text(self, text: str) -> list[float]:
        key = hashlib.md5(text.encode()).hexdigest()
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        self._load_model()
        if self.model is None:
            print(f"[EMBED] Model not available, returning zero vector")
            return [0.0] * self.dimension
        try:
            t0 = __import__("time").time()
            embedding = self.model.encode(text, normalize_embeddings=True, show_progress_bar=False)
            result = embedding.tolist()
            duration = __import__("time").time() - t0
            if len(self._cache) >= self._cache_max:
                self._cache.clear()
            self._cache[key] = result
            print(f"[EMBED] Text embedded: dim={len(result)}, time={duration:.2f}s")
            return result
        except Exception as e:
            logger.error(f"embed_text failed: {e}")
            return [0.0] * self.dimension

    def embed_chunks(self, chunks: list[str], document_id: str = None, organization_id: str = None) -> list[list[float]]:
        print(f"[EMBED] Processing {len(chunks)} chunks for doc {document_id[:12] if document_id else '?'}...")
        uncached = []
        uncached_idx = []
        results = [None] * len(chunks)
        for i, chunk in enumerate(chunks):
            key = hashlib.md5(chunk.encode()).hexdigest()
            cached = self._cache.get(key)
            if cached is not None:
                results[i] = cached
            else:
                uncached.append(chunk)
                uncached_idx.append(i)
        print(f"[EMBED] Cache hits: {len(results) - len(uncached)}/{len(chunks)}, to encode: {len(uncached)}")
        if uncached:
            self._load_model()
            if self.model is None:
                for idx in uncached_idx:
                    results[idx] = [0.0] * self.dimension
                return results
            try:
                t0 = __import__("time").time()
                embeddings = self.model.encode(uncached, normalize_embeddings=True, show_progress_bar=False)
                duration = __import__("time").time() - t0
                print(f"[EMBED] Encoded {len(uncached)} chunks in {duration:.2f}s")
                for idx, emb in zip(uncached_idx, embeddings):
                    val = emb.tolist()
                    results[idx] = val
                    if len(self._cache) >= self._cache_max:
                        self._cache.clear()
                    self._cache[hashlib.md5(chunks[idx].encode()).hexdigest()] = val
            except Exception as e:
                logger.error(f"embed_chunks encode failed: {e}")
                for idx in uncached_idx:
                    results[idx] = [0.0] * self.dimension

        if document_id and organization_id and pinecone_service.available:
            try:
                vectors = []
                for i, (chunk, emb) in enumerate(zip(chunks, results)):
                    vid = f"{document_id}_{hashlib.md5(chunk.encode()).hexdigest()}"
                    vectors.append((vid, emb, {
                        "document_id": document_id,
                        "organization_id": organization_id,
                        "chunk_index": i,
                        "chunk_text": chunk[:1000],
                    }))
                print(f"[EMBED] Upserting {len(vectors)} vectors to Pinecone (namespace={organization_id})...")
                t0 = __import__("time").time()
                pinecone_service.upsert(vectors, namespace=organization_id)
                print(f"[EMBED] Pinecone upsert done in {__import__('time').time()-t0:.2f}s")
            except Exception as e:
                logger.error(f"embed_chunks pinecone upsert failed: {e}")
                print(f"[EMBED] Pinecone upsert FAILED: {e}")
        return results

    def embed_query(self, query: str) -> list[float]:
        return self.embed_text(query)

embedding_service = EmbeddingService()
