import os
import json
import sqlite3
import threading
from datetime import datetime
from .config import settings

_local = threading.local()
_use_supabase = False
_supabase_client = None
_supabase_tried = False


def _get_supabase():
    global _supabase_client, _use_supabase, _supabase_tried
    if _supabase_tried:
        return _supabase_client
    _supabase_tried = True
    url = settings.SUPABASE_URL or os.getenv("SUPABASE_URL", "")
    key = settings.SUPABASE_KEY or os.getenv("SUPABASE_KEY", "")
    if (url and key and url != "your_supabase_url"
            and not url.startswith("https://test") and not url.startswith("http://test")):
        try:
            from supabase import create_client
            _supabase_client = create_client(url, key)
            _supabase_client.table("documents").select("id").limit(1).execute()
            _use_supabase = True
        except Exception:
            _supabase_client = None
    return _supabase_client


def _get_local_db():
    if not hasattr(_local, "conn") or _local.conn is None:
        db_path = os.path.join(settings.UPLOAD_DIR, "..", "docs_ai.db")
        _local.conn = sqlite3.connect(db_path, check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
        _init_local_db(_local.conn)
    return _local.conn


def _init_local_db(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            title TEXT NOT NULL,
            document_type TEXT,
            status TEXT DEFAULT 'uploaded',
            original_file_url TEXT,
            file_hash TEXT,
            page_count INTEGER,
            file_size INTEGER,
            language TEXT,
            raw_text TEXT,
            error_message TEXT,
            uploaded_by TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS document_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            page_id TEXT,
            chunk_index INTEGER DEFAULT 0,
            chunk_type TEXT DEFAULT 'paragraph',
            heading TEXT,
            content TEXT NOT NULL,
            metadata TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS document_embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            chunk_id INTEGER,
            embedding BLOB,
            model_name TEXT DEFAULT 'all-MiniLM-L6-v2',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS document_extractions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            extraction_type TEXT NOT NULL,
            extracted_data TEXT NOT NULL,
            confidence REAL DEFAULT 0,
            reviewed INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS documents_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            document_type TEXT NOT NULL,
            extracted_data TEXT DEFAULT '{}',
            field_confidence TEXT DEFAULT '{}',
            overall_confidence REAL DEFAULT 0,
            agent_version TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS processing_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            job_type TEXT DEFAULT 'full_pipeline',
            stage TEXT DEFAULT 'queued',
            status TEXT DEFAULT 'queued',
            progress INTEGER DEFAULT 0,
            error_message TEXT,
            started_at TEXT,
            completed_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS agent_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            agent_name TEXT NOT NULL,
            input_summary TEXT,
            output_summary TEXT,
            confidence REAL,
            duration_ms INTEGER,
            status TEXT DEFAULT 'completed',
            error_message TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS validation_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id TEXT NOT NULL,
            validation_type TEXT NOT NULL,
            source_document_id TEXT NOT NULL,
            target_document_id TEXT,
            source_field TEXT,
            target_field TEXT,
            expected_value TEXT,
            actual_value TEXT,
            match_status TEXT DEFAULT 'pending',
            discrepancy_details TEXT,
            severity TEXT DEFAULT 'info',
            resolved INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            resolved_at TEXT
        );
        CREATE TABLE IF NOT EXISTS workflow_instances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id TEXT NOT NULL,
            workflow_type TEXT NOT NULL,
            document_id TEXT NOT NULL,
            current_stage TEXT DEFAULT 'uploaded',
            status TEXT DEFAULT 'active',
            stages TEXT DEFAULT '[]',
            approvals_required INTEGER DEFAULT 0,
            approvals_obtained INTEGER DEFAULT 0,
            assigned_to TEXT,
            metadata TEXT DEFAULT '{}',
            error_message TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_doc_org ON documents(organization_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_doc ON document_chunks(document_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_org ON document_chunks(organization_id);
        CREATE INDEX IF NOT EXISTS idx_emb_doc ON document_embeddings(document_id);
        CREATE INDEX IF NOT EXISTS idx_emb_chunk ON document_embeddings(chunk_id);
        CREATE INDEX IF NOT EXISTS idx_doc_type ON documents(document_type);
    """)
    try:
        conn.executescript("""
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                content, document_id UNINDEXED, organization_id UNINDEXED, page_id UNINDEXED
            );
        """)
    except Exception:
        pass


class SupabaseDB:
    @staticmethod
    def get_client():
        return _get_supabase()

    @staticmethod
    def insert(table: str, data: dict):
        supabase_ok = False
        try:
            client = _get_supabase()
            if _use_supabase and client:
                client.table(table).insert(data).execute()
                supabase_ok = True
        except Exception:
            pass
        local = _local_insert(table, data)
        return local if not supabase_ok else type("Result", (), {"data": [data]})()

    @staticmethod
    def update(table: str, data: dict, id_column: str, id_value: str):
        supabase_ok = False
        try:
            client = _get_supabase()
            if _use_supabase and client:
                client.table(table).update(data).eq(id_column, id_value).execute()
                supabase_ok = True
        except Exception:
            pass
        local = _local_update(table, data, id_column, id_value)
        return local if not supabase_ok else type("Result", (), {"data": [data]})()

    @staticmethod
    def delete(table: str, id_column: str, id_value: str):
        supabase_ok = False
        try:
            client = _get_supabase()
            if _use_supabase and client:
                client.table(table).delete().eq(id_column, id_value).execute()
                supabase_ok = True
        except Exception:
            pass
        _local_delete(table, id_column, id_value)

    @staticmethod
    def delete_document_cascade(document_id: str):
        try:
            client = _get_supabase()
            if _use_supabase and client:
                client.rpc("delete_document_cascade", {"p_document_id": document_id}).execute()
        except Exception:
            pass
        conn = _get_local_db()
        conn.execute("BEGIN")
        try:
            for tbl in ("document_chunks", "document_embeddings", "document_extractions",
                        "documents_metadata", "processing_jobs", "agent_runs",
                        "workflow_instances"):
                conn.execute(f"DELETE FROM {tbl} WHERE document_id=?", (document_id,))
            conn.execute("DELETE FROM validation_results WHERE source_document_id=?", (document_id,))
            conn.execute("DELETE FROM documents WHERE id=?", (document_id,))
            conn.commit()
        except Exception:
            conn.rollback()

    @staticmethod
    def select(table: str, columns: str = "*", filters: dict = None, like: dict = None, limit: int = None, offset: int = None):
        try:
            client = _get_supabase()
            if _use_supabase and client:
                query = client.table(table).select(columns)
                if filters:
                    for key, value in filters.items():
                        query = query.eq(key, value)
                if like:
                    for key, value in like.items():
                        query = query.ilike(key, f"%{value}%")
                if limit:
                    query = query.limit(limit)
                if offset:
                    query = query.offset(offset)
                result = query.execute()
                if result.data is not None:
                    return result
        except Exception:
            pass
        return _local_select(table, columns, filters, like, limit, offset)

    @staticmethod
    def batch_insert(table: str, records: list[dict]):
        try:
            client = _get_supabase()
            if _use_supabase and client:
                client.table(table).insert(records).execute()
        except Exception:
            pass
        _local_batch_insert(table, records)

    @staticmethod
    def upload_file(bucket: str, path: str, file_data: bytes, content_type: str = None):
        try:
            client = _get_supabase()
            if _use_supabase and client:
                return client.storage.from_(bucket).upload(path, file_data, {"content-type": content_type or "application/octet-stream"})
        except Exception:
            pass
        return None

    @staticmethod
    def delete_file(bucket: str, path: str):
        try:
            client = _get_supabase()
            if _use_supabase and client:
                client.storage.from_(bucket).remove([path])
        except Exception:
            pass

    @staticmethod
    def search_vector(table: str, query_vector: list, match_threshold: float = 0.7, match_count: int = 10, filter_org_id: str = None):
        try:
            client = _get_supabase()
            if _use_supabase and client:
                params = {"query_embedding": query_vector, "match_threshold": match_threshold, "match_count": match_count}
                if filter_org_id:
                    params["filter_org_id"] = filter_org_id
                result = client.rpc("match_documents", params).execute()
                if result.data:
                    return result
        except Exception:
            pass
        return _local_search_vector(query_vector, match_threshold, match_count, filter_org_id)


def _local_insert(table: str, data: dict):
    conn = _get_local_db()
    if table == "documents":
        data["id"] = data.get("id", __import__("uuid").uuid4().hex)
        conn.execute("INSERT OR REPLACE INTO documents (id, organization_id, title, document_type, status, original_file_url, file_hash, page_count, file_size, language, raw_text, error_message, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (data["id"], data.get("organization_id", ""), data.get("title", ""), data.get("document_type"), data.get("status", "uploaded"),
                      data.get("original_file_url"), data.get("file_hash"), data.get("page_count"), data.get("file_size"),
                      data.get("language"), data.get("raw_text"), data.get("error_message"), data.get("uploaded_by", "")))
        conn.commit()
        return type("Result", (), {"data": [dict(conn.execute("SELECT * FROM documents WHERE id=?", (data["id"],)).fetchone())]})()
    if table == "document_chunks":
        cur = conn.execute("INSERT INTO document_chunks (organization_id, document_id, page_id, chunk_type, heading, content, metadata) VALUES (?,?,?,?,?,?,?)",
                           (data.get("organization_id", ""), data.get("document_id", ""), data.get("page_id"), data.get("chunk_type", "paragraph"),
                            data.get("heading"), data.get("content", ""), __import__("json").dumps(data.get("metadata")) if data.get("metadata") else None))
        conn.commit()
        chunk_id = cur.lastrowid
        _local_fts_sync(data.get("document_id"))
        return type("Result", (), {"data": [{**data, "id": chunk_id}]})()
    if table == "document_embeddings":
        cur = conn.execute("INSERT INTO document_embeddings (organization_id, document_id, chunk_id, embedding, model_name) VALUES (?,?,?,?,?)",
                           (data.get("organization_id", ""), data.get("document_id", ""), data.get("chunk_id"),
                            str(data.get("embedding", [])), data.get("model_name", "all-MiniLM-L6-v2")))
        conn.commit()
        return type("Result", (), {"data": [{**data, "id": cur.lastrowid}]})()
    if table == "document_extractions":
        cur = conn.execute("INSERT INTO document_extractions (organization_id, document_id, extraction_type, extracted_data, confidence) VALUES (?,?,?,?,?)",
                           (data.get("organization_id", ""), data.get("document_id", ""), data.get("extraction_type", ""),
                            __import__("json").dumps(data.get("extracted_data", {})), data.get("confidence", 0.0)))
        conn.commit()
        return type("Result", (), {"data": [{**data, "id": cur.lastrowid}]})()
    if table == "documents_metadata":
        cur = conn.execute("INSERT INTO documents_metadata (organization_id, document_id, document_type, extracted_data, field_confidence, overall_confidence, agent_version) VALUES (?,?,?,?,?,?,?)",
                           (data.get("organization_id", ""), data.get("document_id", ""), data.get("document_type", ""),
                            __import__("json").dumps(data.get("extracted_data", {})),
                            __import__("json").dumps(data.get("field_confidence", {})),
                            data.get("overall_confidence", 0.0), data.get("agent_version")))
        conn.commit()
        return type("Result", (), {"data": [{**data, "id": cur.lastrowid}]})()
    if table == "processing_jobs":
        cur = conn.execute("INSERT INTO processing_jobs (organization_id, document_id, job_type, stage, status, progress) VALUES (?,?,?,?,?,?)",
                           (data.get("organization_id", ""), data.get("document_id", ""), data.get("job_type", "full_pipeline"),
                            data.get("stage", "queued"), data.get("status", "queued"), data.get("progress", 0)))
        conn.commit()
        return type("Result", (), {"data": [{**data, "id": cur.lastrowid}]})()
    if table == "agent_runs":
        cur = conn.execute("INSERT INTO agent_runs (organization_id, document_id, agent_name, input_summary, output_summary, confidence, duration_ms, status, error_message) VALUES (?,?,?,?,?,?,?,?,?)",
                           (data.get("organization_id", ""), data.get("document_id", ""), data.get("agent_name", ""),
                            data.get("input_summary"), data.get("output_summary"), data.get("confidence"),
                            data.get("duration_ms"), data.get("status", "completed"), data.get("error_message")))
        conn.commit()
        return type("Result", (), {"data": [{**data, "id": cur.lastrowid}]})()
    if table == "validation_results":
        cur = conn.execute("INSERT INTO validation_results (organization_id, validation_type, source_document_id, target_document_id, source_field, target_field, expected_value, actual_value, match_status, discrepancy_details, severity) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                           (data.get("organization_id", ""), data.get("validation_type", ""), data.get("source_document_id", ""),
                            data.get("target_document_id"), data.get("source_field"), data.get("target_field"),
                            data.get("expected_value"), data.get("actual_value"), data.get("match_status", "pending"),
                            data.get("discrepancy_details"), data.get("severity", "info")))
        conn.commit()
        return type("Result", (), {"data": [{**data, "id": cur.lastrowid}]})()
    if table == "workflow_instances":
        cur = conn.execute("INSERT INTO workflow_instances (organization_id, workflow_type, document_id, current_stage, status, stages, approvals_required, approvals_obtained, assigned_to, metadata) VALUES (?,?,?,?,?,?,?,?,?,?)",
                           (data.get("organization_id", ""), data.get("workflow_type", ""), data.get("document_id", ""),
                            data.get("current_stage", "uploaded"), data.get("status", "active"),
                            __import__("json").dumps(data.get("stages", [])), data.get("approvals_required", 0),
                            data.get("approvals_obtained", 0), data.get("assigned_to"),
                            __import__("json").dumps(data.get("metadata", {}))))
        conn.commit()
        return type("Result", (), {"data": [{**data, "id": cur.lastrowid}]})()
    return type("Result", (), {"data": [data]})()


def _local_update(table: str, data: dict, id_column: str, id_value: str):
    conn = _get_local_db()
    sets = ", ".join(f"{k}=?" for k in data.keys())
    values = list(data.values()) + [id_value]
    conn.execute(f"UPDATE {table} SET {sets} WHERE {id_column}=?", values)
    conn.commit()
    return type("Result", (), {"data": [data]})()


def _local_delete(table: str, id_column: str, id_value: str):
    conn = _get_local_db()
    conn.execute(f"DELETE FROM {table} WHERE {id_column}=?", (id_value,))
    conn.commit()
    return type("Result", (), {"data": []})()


def _local_select(table: str, columns: str = "*", filters: dict = None, like: dict = None, limit: int = None, offset: int = None):
    conn = _get_local_db()
    query = f"SELECT {columns} FROM {table}"
    params = []
    where_clauses = []
    if filters:
        for k, v in filters.items():
            where_clauses.append(f"{k}=?")
            params.append(v)
    if like:
        for k, v in like.items():
            where_clauses.append(f"{k} LIKE ?")
            params.append(f"%{v}%")
    if where_clauses:
        query += " WHERE " + " AND ".join(where_clauses)
    if limit:
        query += f" LIMIT {limit}"
    if offset:
        query += f" OFFSET {offset}"
    rows = conn.execute(query, params).fetchall()
    return type("Result", (), {"data": [dict(r) for r in rows]})()


def _local_batch_insert(table: str, records: list[dict]):
    conn = _get_local_db()
    if table == "document_chunks":
        doc_ids = set()
        conn.executemany(
            "INSERT INTO document_chunks (organization_id, document_id, page_id, chunk_type, heading, content, chunk_index, metadata) VALUES (?,?,?,?,?,?,?,?)",
            [(r.get("organization_id", ""), r.get("document_id", ""), r.get("page_id"),
              r.get("chunk_type", "paragraph"), r.get("heading"),
              r.get("content", ""), r.get("chunk_index", 0), __import__("json").dumps(r.get("metadata")) if r.get("metadata") else None) for r in records])
        for r in records:
            if r.get("document_id"):
                doc_ids.add(r["document_id"])
        conn.commit()
        for did in doc_ids:
            _local_fts_sync(did)
    elif table == "document_embeddings":
        conn.executemany(
            "INSERT INTO document_embeddings (organization_id, document_id, chunk_id, embedding, model_name) VALUES (?,?,?,?,?)",
            [(r.get("organization_id", ""), r.get("document_id", ""), r.get("chunk_id"),
              str(r.get("embedding", [])), r.get("model_name", "all-MiniLM-L6-v2")) for r in records])
        conn.commit()


def _local_select_in(table: str, columns: str = "*", filters: dict = None, in_column: str = None, in_values: list = None):
    conn = _get_local_db()
    query = f"SELECT {columns} FROM {table}"
    params = []
    where_clauses = []
    if filters:
        for k, v in filters.items():
            where_clauses.append(f"{k}=?")
            params.append(v)
    if in_column and in_values:
        placeholders = ",".join("?" * len(in_values))
        where_clauses.append(f"{in_column} IN ({placeholders})")
        params.extend(in_values)
    if where_clauses:
        query += " WHERE " + " AND ".join(where_clauses)
    rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def _local_fts_sync(document_id: str = None):
    conn = _get_local_db()
    try:
        if document_id:
            conn.execute("DELETE FROM chunks_fts WHERE document_id=?", (document_id,))
            rows = conn.execute("SELECT id, content, document_id, organization_id, page_id FROM document_chunks WHERE document_id=?", (document_id,)).fetchall()
        else:
            conn.execute("DELETE FROM chunks_fts")
            rows = conn.execute("SELECT id, content, document_id, organization_id, page_id FROM document_chunks").fetchall()
        for r in rows:
            try:
                conn.execute("INSERT INTO chunks_fts (rowid, content, document_id, organization_id, page_id) VALUES (?, ?, ?, ?, ?)",
                             (r["id"], r["content"], r["document_id"], r["organization_id"], r["page_id"]))
            except Exception:
                pass
        conn.commit()
    except Exception:
        pass


def _local_keyword_search(query: str, organization_id: str = None, limit: int = 10, offset: int = 0) -> list[dict]:
    conn = _get_local_db()
    try:
        # Sanitize FTS5 query: escape special characters, wrap terms for prefix matching
        import re
        cleaned = re.sub(r'[^\w\s]', ' ', query).strip()
        terms = [t for t in cleaned.split() if t]
        if not terms:
            return []
        fts_query = " AND ".join(f'"{t}"*' for t in terms)

        sql = "SELECT c.rowid, c.*, rank FROM chunks_fts c WHERE c.content MATCH ?"
        params = [fts_query]
        if organization_id:
            sql += " AND c.organization_id=?"
            params.append(organization_id)
        sql += " ORDER BY rank LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


def _local_search_vector(query_vector: list, match_threshold: float = 0.7, match_count: int = 10, filter_org_id: str = None):
    result_data = []
    try:
        conn = _get_local_db()
        import ast
        rows = conn.execute(
            "SELECT c.*, e.embedding FROM document_chunks c "
            "LEFT JOIN document_embeddings e ON e.chunk_id = c.id "
            "WHERE e.embedding IS NOT NULL"
        ).fetchall()
        if not rows:
            return type("Result", (), {"data": []})()
        scores = []
        for row in rows:
            raw = row["embedding"]
            try:
                stored = list(raw)
            except TypeError:
                stored = ast.literal_eval(raw)
            dot = sum(a * b for a, b in zip(query_vector, stored[:len(query_vector)]))
            norm = (sum(a * a for a in stored) ** 0.5) * (sum(b * b for b in query_vector) ** 0.5)
            score = dot / norm if norm > 0 else 0
            if score >= match_threshold:
                if filter_org_id and row.get("organization_id") != filter_org_id:
                    continue
                r = dict(row)
                r.pop("embedding", None)
                scores.append((score, r))
        scores.sort(key=lambda x: x[0], reverse=True)
        for score, row in scores[:match_count]:
            result_data.append({**row, "similarity": score})
    except Exception:
        pass
    return type("Result", (), {"data": result_data})()
