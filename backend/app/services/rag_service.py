import re
import hashlib
from ..database import SupabaseDB
from ..config import settings
from .embedding_service import embedding_service
from .pinecone_service import pinecone_service


_NUMERED_RE = None
_CHAPTER_RE = None


def _get_patterns():
    global _NUMERED_RE, _CHAPTER_RE
    if _NUMERED_RE is None:
        import re
        _NUMERED_RE = re.compile(r'^\d+(?:\.\d+)*(?:\s+|\.\s+)(.+)')
        _CHAPTER_RE = re.compile(r'^(?:chapter|section|appendix|part|article)\s+\d+', re.IGNORECASE)
    return _NUMERED_RE, _CHAPTER_RE


def _detect_headings_from_file(file_path: str) -> list[dict]:
    import fitz
    numbered_re, chapter_re = _get_patterns()

    doc = fitz.open(file_path)
    page_height = doc[0].rect.height if doc.page_count > 0 else 842
    headings = []
    for page_num in range(doc.page_count):
        page = doc[page_num]
        blocks = page.get_text("dict").get("blocks", [])
        font_sizes = []
        spans_data = []
        for block in blocks:
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    txt = span.get("text", "").strip()
                    if txt:
                        font_sizes.append(span.get("size", 0))
                        spans_data.append({
                            "text": txt,
                            "size": span.get("size", 0),
                            "flags": span.get("flags", 0),
                            "font": span.get("font", ""),
                            "bbox": line.get("bbox", [0, 0, 0, 0]),
                        })
        if not font_sizes:
            continue
        font_sizes.sort()
        body_size = font_sizes[len(font_sizes) // 2]

        for sp in spans_data:
            txt = sp["text"]
            if len(txt) < 2 or len(txt) > 150:
                continue
            if txt.isdigit():
                continue
            size = sp["size"]
            flags = sp["flags"]
            font = sp["font"]
            is_bold = bool(flags & 16) or "bold" in font.lower()
            y0 = sp["bbox"][1]
            if y0 < page_height * 0.06 or y0 > page_height * 0.94:
                continue

            is_heading = False
            level = 0
            if size > body_size * 1.15:
                is_heading = True
                level = 1 if size > body_size * 1.4 else 2
            elif is_bold and len(txt) < 100 and size >= body_size * 0.9:
                is_heading = True
                level = 3
            m = numbered_re.match(txt)
            if m:
                is_heading = True
                level = min(level, 3) if level else 3
            if chapter_re.match(txt):
                is_heading = True
                level = 1
            if txt.isupper() and len(txt) > 3 and len(txt) < 60 and not is_bold:
                is_heading = True
                level = min(level, 2) if level else 2

            if is_heading:
                headings.append({
                    "heading": txt,
                    "page": page_num + 1,
                    "level": level,
                    "y0": y0,
                })
    doc.close()

    headings.sort(key=lambda h: (h["page"], h["y0"]))
    collapsed = []
    for h in headings:
        if collapsed and collapsed[-1]["heading"] == h["heading"] and collapsed[-1]["page"] == h["page"]:
            continue
        collapsed.append(h)

    page1_top = [h for h in collapsed if h["page"] == 1 and h["y0"] < page_height * 0.15]
    if len(page1_top) >= 3:
        page1_top_set = {h["heading"] for h in page1_top}
        collapsed = [h for h in collapsed if h["heading"] not in page1_top_set or h["page"] != 1]

    collapsed = [h for h in collapsed if not (h["level"] == 3 and len(h["heading"].split()) == 1)]

    return collapsed


def _detect_headings_from_text(text: str) -> list[dict]:
    numbered_re, chapter_re = _get_patterns()
    headings = []
    lines = text.split("\n")
    body_sizes = [len(l.split()) for l in lines if l.strip()]
    avg_line_words = sum(body_sizes) / max(len(body_sizes), 1) if body_sizes else 10

    for idx, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        md_match = re.match(r'^(#{1,6})\s+(.+)', stripped)
        if md_match:
            level = len(md_match.group(1))
            headings.append({"heading": md_match.group(2), "level": level})
        elif numbered_re.match(stripped):
            prev_line = lines[idx - 1].strip() if idx > 0 else ""
            if prev_line and len(prev_line) > 3 and not numbered_re.match(prev_line):
                headings.append({"heading": stripped, "level": 3})
        elif chapter_re.match(stripped):
            headings.append({"heading": stripped, "level": 1})
        elif stripped.isupper() and len(stripped) > 3 and len(stripped) < 80:
            word_count = len(stripped.split())
            if word_count < avg_line_words * 0.7:
                headings.append({"heading": stripped, "level": 2})

    return headings


def _merge_headings(text_headings: list[dict], pdf_headings: list[dict]) -> list[dict]:
    seen = set()
    merged = []
    for h in pdf_headings + text_headings:
        key = h.get("heading", "").strip().lower()
        if key and key not in seen:
            seen.add(key)
            merged.append(h)
    return merged


def _build_sections(text: str, headings: list[dict]) -> list[dict]:
    if not headings:
        return []
    raw_sections = []
    search_pos = 0
    for i, h in enumerate(headings):
        start_text = h["heading"]
        start_idx = text.find(start_text, search_pos)
        if start_idx < 0:
            continue
        end_idx = len(text)
        if i + 1 < len(headings):
            next_text = headings[i + 1]["heading"]
            nxt = text.find(next_text, start_idx + len(start_text))
            if nxt > start_idx:
                end_idx = nxt
        section_text = text[start_idx:end_idx].strip()
        if section_text:
            raw_sections.append({
                "heading": h["heading"],
                "content": section_text,
                "level": h.get("level", 3),
            })
            search_pos = end_idx
    if not raw_sections:
        return []

    merged = []
    buffer = None
    for sec in raw_sections:
        content_words = len(sec["content"].split())
        is_tiny = content_words < 30 and sec["level"] >= 2
        if is_tiny:
            if buffer is None:
                buffer = sec
            else:
                buffer["content"] += "\n" + sec["content"]
        else:
            if buffer:
                merged.append(buffer)
                buffer = None
            merged.append(sec)
    if buffer:
        if merged:
            merged[-1]["content"] += "\n" + buffer["content"]
        else:
            merged.append(buffer)
    return merged


def _chunk_by_sections(text: str, headings: list[dict], max_words: int = 350) -> list[dict]:
    sections = _build_sections(text, headings)
    if not sections:
        return []

    chunks = []
    import re
    for sec in sections:
        content = sec["content"]
        words = content.split()
        if len(words) <= max_words:
            cid = hashlib.md5(content.encode()).hexdigest()
            chunks.append({
                "content": content,
                "chunk_id": cid,
                "chunk_index": len(chunks),
                "word_count": len(words),
                "heading": sec["heading"],
                "chunk_type": "section",
            })
        else:
            sentences = re.split(r'(?<=[.!?])\s+', content)
            current = []
            current_words = 0
            for sent in sentences:
                sw = len(sent.split())
                if current_words + sw > max_words and current:
                    chunk_text = " ".join(current)
                    cid = hashlib.md5(chunk_text.encode()).hexdigest()
                    chunks.append({
                        "content": chunk_text,
                        "chunk_id": cid,
                        "chunk_index": len(chunks),
                        "word_count": current_words,
                        "heading": sec["heading"],
                        "chunk_type": "section",
                    })
                    current = [sent]
                    current_words = sw
                else:
                    current.append(sent)
                    current_words += sw
            if current:
                chunk_text = " ".join(current)
                cid = hashlib.md5(chunk_text.encode()).hexdigest()
                chunks.append({
                    "content": chunk_text,
                    "chunk_id": cid,
                    "chunk_index": len(chunks),
                    "word_count": current_words,
                    "heading": sec["heading"],
                    "chunk_type": "section",
                })
    return chunks


ATOMIC_PATTERNS = [
    (re.compile(r'^\|.+\|$'), "table"),
    (re.compile(r'^```'), "code_block"),
    (re.compile(r'^(?:>?\s*)?(?:\*\*)?(?:Warning|Note|Caution|Important|Notice|Danger|Info)(?:\*\*)?\s*[:]?\s*', re.IGNORECASE), "admonition"),
    (re.compile(r'^\s*(?:-\s+|\*\s+|\d+[.)]\s+)'), "list_item"),
]


def _is_atomic_start(line: str) -> str | None:
    for pat, atype in ATOMIC_PATTERNS:
        if pat.match(line):
            return atype
    return None


def _parse_atomic_blocks(text: str) -> list[dict]:
    lines = text.split('\n')
    blocks = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        atype = _is_atomic_start(stripped)

        if atype == "code_block":
            block_lines = [line]
            i += 1
            while i < len(lines):
                block_lines.append(lines[i])
                if lines[i].strip().startswith("```"):
                    break
                i += 1
            blocks.append({"type": "code", "content": "\n".join(block_lines), "words": len(" ".join(block_lines).split())})
            i += 1

        elif stripped.startswith("|") and stripped.endswith("|"):
            table_lines = [line]
            i += 1
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i])
                i += 1
            blocks.append({"type": "table", "content": "\n".join(table_lines), "words": len(" ".join(table_lines).split())})

        elif not stripped:
            i += 1
            continue

        elif atype == "admonition":
            admon_lines = [line]
            i += 1
            while i < len(lines) and lines[i].strip() and not _is_atomic_start(lines[i].strip()):
                admon_lines.append(lines[i])
                i += 1
            blocks.append({"type": "admonition", "content": "\n".join(admon_lines), "words": len(" ".join(admon_lines).split())})

        elif re.match(r'^\d+[.)]\s', stripped):
            list_lines = [line]
            i += 1
            while i < len(lines) and re.match(r'^\d+[.)]\s', lines[i].strip()):
                list_lines.append(lines[i])
                i += 1
            blocks.append({"type": "numbered_list", "content": "\n".join(list_lines), "words": len(" ".join(list_lines).split())})

        elif re.match(r'^[-*]\s', stripped):
            list_lines = [line]
            i += 1
            while i < len(lines) and re.match(r'^[-*]\s', lines[i].strip()):
                list_lines.append(lines[i])
                i += 1
            blocks.append({"type": "bullet_list", "content": "\n".join(list_lines), "words": len(" ".join(list_lines).split())})

        elif stripped.startswith("---"):
            i += 1
            continue

        elif stripped.startswith("<!--"):
            i += 1
            continue

        else:
            para_lines = [line]
            i += 1
            while i < len(lines) and lines[i].strip() and not _is_atomic_start(lines[i].strip()):
                stripped_next = lines[i].strip()
                if re.match(r'^\d+[.)]\s', stripped_next) or re.match(r'^[-*]\s', stripped_next):
                    break
                para_lines.append(lines[i])
                i += 1
            text_content = "\n".join(para_lines)
            blocks.append({"type": "paragraph", "content": text_content, "words": len(text_content.split())})

    return blocks


def _markdown_aware_chunk(text: str, max_words: int = 250) -> list[dict]:
    if not text:
        return []

    blocks = _parse_atomic_blocks(text)
    if not blocks:
        return []

    chunks = []
    current_blocks = []
    current_words = 0
    chunk_id = 0
    current_heading = None

    for block in blocks:
        bw = block["words"]
        if bw > max_words:
            if current_blocks:
                ct = "\n\n".join(b["content"] for b in current_blocks)
                chunks.append({
                    "content": ct,
                    "chunk_id": hashlib.md5(ct.encode()).hexdigest(),
                    "chunk_index": chunk_id,
                    "word_count": current_words,
                    "heading": current_heading,
                    "chunk_type": "markdown_section",
                })
                chunk_id += 1
                current_blocks = []
                current_words = 0

            ct = block["content"]
            chunks.append({
                "content": ct,
                "chunk_id": hashlib.md5(ct.encode()).hexdigest(),
                "chunk_index": chunk_id,
                "word_count": bw,
                "heading": current_heading,
                "chunk_type": block["type"],
            })
            chunk_id += 1
            continue

        if current_words + bw > max_words and current_blocks:
            ct = "\n\n".join(b["content"] for b in current_blocks)
            chunks.append({
                "content": ct,
                "chunk_id": hashlib.md5(ct.encode()).hexdigest(),
                "chunk_index": chunk_id,
                "word_count": current_words,
                "heading": current_heading,
                "chunk_type": "markdown_section",
            })
            chunk_id += 1
            current_blocks = [block]
            current_words = bw
        else:
            current_blocks.append(block)
            current_words += bw

        content = block["content"]
        first_line = content.split("\n")[0].strip()
        if first_line.startswith("#"):
            current_heading = first_line.lstrip("#").strip()
        elif first_line.startswith("##"):
            current_heading = first_line.lstrip("#").strip()

    if current_blocks:
        ct = "\n\n".join(b["content"] for b in current_blocks)
        chunks.append({
            "content": ct,
            "chunk_id": hashlib.md5(ct.encode()).hexdigest(),
            "chunk_index": chunk_id,
            "word_count": current_words,
            "heading": current_heading,
            "chunk_type": "markdown_section",
        })

    return chunks


class RAGService:
    def chunk_text(self, text: str, max_words: int = 250) -> list[dict]:
        if not text:
            return []

        chunks = _markdown_aware_chunk(text, max_words)
        if chunks:
            return chunks

        import re
        sentences = re.split(r'(?<=[.!?])\s+', text)
        sentences = [s.strip() for s in sentences if s.strip()]

        if len(sentences) <= 1:
            sentences = re.split(r'(?<=[,;:\u060C\u061F])\s+|\n+', text)
            sentences = [s.strip() for s in sentences if s.strip()]

        if len(sentences) <= 1 or len(sentences) >= 0.8 * len(text.split()):
            words = text.split()
            chunks = []
            chunk_id = 0
            for i in range(0, len(words), max_words):
                chunk_words = words[i:i + max_words]
                chunk_text = " ".join(chunk_words)
                chunks.append({
                    "content": chunk_text,
                    "chunk_id": hashlib.md5(chunk_text.encode()).hexdigest(),
                    "chunk_index": chunk_id,
                    "word_count": len(chunk_words),
                })
                chunk_id += 1
            return chunks

        chunks = []
        current_chunk = []
        current_word_count = 0
        chunk_id = 0

        for sentence in sentences:
            sentence_words = len(sentence.split())
            if current_word_count + sentence_words > max_words and current_chunk:
                chunk_text = " ".join(current_chunk)
                chunks.append({
                    "content": chunk_text,
                    "chunk_id": hashlib.md5(chunk_text.encode()).hexdigest(),
                    "chunk_index": chunk_id,
                    "word_count": current_word_count,
                })
                chunk_id += 1
                current_chunk = [sentence]
                current_word_count = sentence_words
            else:
                current_chunk.append(sentence)
                current_word_count += sentence_words

        if current_chunk:
            chunk_text = " ".join(current_chunk)
            chunks.append({
                "content": chunk_text,
                "chunk_id": hashlib.md5(chunk_text.encode()).hexdigest(),
                "chunk_index": chunk_id,
                "word_count": current_word_count,
            })

        return chunks

    def index_document(self, document_id: str, organization_id: str, text: str, file_path: str = None, page_number: int = None):
        print(f"\n[INDEX] Indexing document {document_id[:12] if document_id else '?'}... ({len(text)} chars)")

        headings = []
        if file_path:
            try:
                headings = _detect_headings_from_file(file_path)
                if headings:
                    print(f"[INDEX] PyMuPDF detected {len(headings)} headings")
            except Exception as e:
                print(f"[INDEX] PyMuPDF heading detection failed: {e}")
        text_headings = _detect_headings_from_text(text)
        if text_headings:
            print(f"[INDEX] Text regex detected {len(text_headings)} heading patterns")
        headings = _merge_headings(text_headings, headings)

        if headings:
            chunks = _chunk_by_sections(text, headings)
            if chunks:
                print(f"[INDEX] Topic-wise chunking: {len(chunks)} chunks from {len(headings)} headings")
            else:
                chunks = self.chunk_text(text)
                print(f"[INDEX] Section building produced empty chunks, falling back to word-count chunking")
        else:
            chunks = self.chunk_text(text)
            print(f"[INDEX] No headings detected, using word-count chunking ({len(chunks)} chunks)")

        if not chunks:
            print(f"[INDEX] No chunks generated")
            return
        print(f"[INDEX] Generated {len(chunks)} chunks")

        embeddings = embedding_service.embed_chunks(
            [c["content"] for c in chunks],
            document_id=document_id,
            organization_id=organization_id,
        )
        print(f"[INDEX] Got {len(embeddings)} embeddings")

        try:
            chunk_records = []
            emb_records = []
            for chunk, embedding in zip(chunks, embeddings):
                heading = chunk.get("heading")
                ctype = chunk.get("chunk_type", "paragraph")
                meta = {"chunk_index": chunk.get("chunk_index", 0), "word_count": chunk.get("word_count", 0)}
                if heading:
                    meta["heading"] = heading
                chunk_records.append({
                    "organization_id": organization_id,
                    "document_id": document_id,
                    "page_id": page_number,
                    "chunk_index": chunk.get("chunk_index", 0),
                    "chunk_type": ctype,
                    "heading": heading,
                    "content": chunk["content"],
                    "chunk_text": chunk["content"],
                    "metadata": meta,
                })
                emb_records.append({
                    "organization_id": organization_id,
                    "document_id": document_id,
                    "embedding": embedding,
                    "model_name": "all-MiniLM-L6-v2",
                })
            SupabaseDB.batch_insert("document_chunks", chunk_records)
            SupabaseDB.batch_insert("document_embeddings", emb_records)
            print(f"[INDEX] Saved {len(chunk_records)} chunks + {len(emb_records)} embeddings to DB")
        except Exception as e:
            print(f"[INDEX] DB save FAILED: {e}")

    def index_image_content(self, markdown: str, document_id: str, organization_id: str, image_metadata: dict = None):
        if not markdown.strip():
            return

        meta = image_metadata or {}
        page_num = meta.get("page_number", 1)
        heading = f"Figure Page {page_num}"

        chunk_text = markdown.strip()
        chunk_id = hashlib.md5(chunk_text.encode()).hexdigest()

        embedding = embedding_service.embed_text(chunk_text)
        print(f"[IMAGE-INDEX] Embedded image {meta.get('image_id','?')}: dim={len(embedding)}")

        try:
            enriched_meta = {
                "chunk_index": 0,
                "word_count": len(chunk_text.split()),
                "heading": heading,
                "image_id": meta.get("image_id", ""),
                "image_path": meta.get("image_path", ""),
                "page_number": page_num,
                "image_index": meta.get("image_index", 0),
                "chunk_type": "image",
                "source": "vision_image",
            }
            chunk_rec = {
                "organization_id": organization_id,
                "document_id": document_id,
                "page_id": page_num,
                "chunk_index": 0,
                "chunk_type": "image",
                "heading": heading,
                "content": chunk_text,
                "chunk_text": chunk_text,
                "metadata": enriched_meta,
            }
            emb_rec = {
                "organization_id": organization_id,
                "document_id": document_id,
                "embedding": embedding,
                "model_name": "all-MiniLM-L6-v2",
            }
            SupabaseDB.insert("document_chunks", chunk_rec)
            SupabaseDB.insert("document_embeddings", emb_rec)
            print(f"[IMAGE-INDEX] Saved image chunk + embedding to DB")

            # Also upsert to Pinecone
            if pinecone_service.available:
                vid = f"{document_id}_{chunk_id}"
                pinecone_service.upsert([(vid, embedding, {
                    "document_id": document_id,
                    "organization_id": organization_id,
                    "chunk_index": 0,
                    "chunk_type": "image",
                    "chunk_text": chunk_text[:1000],
                    "image_id": meta.get("image_id", ""),
                    "page_number": page_num,
                })], namespace=organization_id)
                print(f"[IMAGE-INDEX] Upserted to Pinecone")
        except Exception as e:
            print(f"[IMAGE-INDEX] DB save FAILED: {e}")

    def _resolve_doc_filters(self, organization_id: str, document_type: str = None,
                              phase3_agent: str = None, status: str = None,
                              date_from: str = None, date_to: str = None) -> list[str] | None:
        filters = {"organization_id": organization_id}
        if document_type:
            filters["document_type"] = document_type
        if phase3_agent:
            filters["phase3_agent"] = phase3_agent
        if status:
            filters["status"] = status

        if not any([document_type, phase3_agent, status, date_from, date_to]):
            return None

        try:
            from ..database import _local_select, _get_supabase, _use_supabase, SupabaseDB
            result = SupabaseDB.select("documents", columns="id", filters=filters, limit=10000)
            data = getattr(result, "data", result if isinstance(result, list) else [])
            ids = [r["id"] for r in data if isinstance(r, dict)]
            if not ids:
                return []

            if date_from or date_to:
                local_result = _local_select("documents", columns="id", filters={"organization_id": organization_id})
                local_data = getattr(local_result, "data", local_result if isinstance(local_result, list) else [])
                import re
                filtered = []
                for r in local_data:
                    if isinstance(r, dict):
                        created = r.get("created_at", "")
                        if created:
                            if date_from and created < date_from:
                                continue
                            if date_to and created > date_to + "T23:59:59":
                                continue
                            if r["id"] in ids:
                                filtered.append(r["id"])
                ids = filtered

            return ids
        except Exception:
            return None

    def _fetch_doc_titles(self, doc_ids: list[str], org_id: str) -> dict:
        titles = {}
        if not doc_ids:
            return titles
        try:
            unique_ids = list(set(doc_ids))
            from ..database import _local_select_in, _get_supabase, _use_supabase
            client = _get_supabase()
            if _use_supabase and client:
                r = client.table("documents").select("id, title, document_type, phase3_agent").in_("id", unique_ids).eq("organization_id", org_id).execute()
                if getattr(r, "data", None):
                    for row in r.data:
                        titles[row["id"]] = (row.get("title", "") or "", row.get("document_type", "") or "", row.get("phase3_agent", "") or "")
            else:
                rows = _local_select_in("documents", columns="id, title, document_type, phase3_agent",
                                        filters={"organization_id": org_id}, in_column="id", in_values=unique_ids)
                for r in rows:
                    titles[r["id"]] = (r.get("title", "") or "", r.get("document_type", "") or "", r.get("phase3_agent", "") or "")
        except Exception:
            pass
        return titles

    def hybrid_search(self, query: str, organization_id: str, document_type: str = None,
                      phase3_agent: str = None, status: str = None,
                      date_from: str = None, date_to: str = None,
                      document_ids: list = None, limit: int = 20, offset: int = 0) -> list[dict]:
        from .orchestration_logger import get_chat_logger
        chat_log = get_chat_logger()

        # Resolve doc-level filters into document_ids
        filter_doc_ids = self._resolve_doc_filters(
            organization_id=organization_id,
            document_type=document_type,
            phase3_agent=phase3_agent,
            status=status,
            date_from=date_from,
            date_to=date_to,
        )
        if filter_doc_ids is not None:
            if document_ids:
                merged_set = set(document_ids) & set(filter_doc_ids)
                document_ids = list(merged_set) if merged_set else []
            else:
                document_ids = filter_doc_ids

        print(f"\n[SEARCH] Query: '{query}' | org={organization_id} | type={document_type or 'all'} | agent={phase3_agent or 'all'} | status={status or 'all'} | docs={len(document_ids) if document_ids else 'all'} | limit={limit}")
        query_embedding = embedding_service.embed_query(query)
        results = []
        seen_ids = set()
        import re
        query_words = [w for w in re.sub(r'[^\w\s]', ' ', query).lower().split() if len(w) >= 2]

        # 1. Pinecone vector search (handles typos via embeddings)
        pinecone_filter_desc = []
        if document_type:
            pinecone_filter_desc.append(f"type={document_type}")
        if phase3_agent:
            pinecone_filter_desc.append(f"agent={phase3_agent}")
        if document_ids:
            pinecone_filter_desc.append(f"doc_ids={len(document_ids)}")
        chat_log.search_strategy("Pinecone Vector Search", ", ".join(pinecone_filter_desc) if pinecone_filter_desc else "no filter")
        pinecone_before = len(results)
        if pinecone_service.available:
            filter_dict = {"organization_id": organization_id}
            if document_type:
                filter_dict["document_type"] = document_type
            if phase3_agent:
                filter_dict["phase3_agent"] = phase3_agent
            if document_ids:
                filter_dict["document_id"] = {"$in": document_ids}
            print(f"[SEARCH] Querying Pinecone (ns='{organization_id}')...")
            pinecone_results = pinecone_service.query(query_embedding, top_k=limit + 10, filter=filter_dict if len(filter_dict) > 1 else None, namespace=organization_id)
            if pinecone_results:
                print(f"[SEARCH] Pinecone returned {len(pinecone_results)} results")
                doc_ids = list(set(r["metadata"].get("document_id", "") for r in pinecone_results))
                title_map = self._fetch_doc_titles(doc_ids, organization_id)
                for r in pinecone_results:
                    meta = r.get("metadata", {})
                    did = meta.get("document_id", "")
                    title, dtype, p3a = title_map.get(did, ("", "", ""))
                    chunk_id = r.get("id", "")
                    if chunk_id in seen_ids:
                        continue
                    seen_ids.add(chunk_id)
                    if document_type and dtype != document_type:
                        continue
                    results.append({
                        "document_id": did,
                        "document_title": title,
                        "document_type": dtype or meta.get("_document_type"),
                        "phase3_agent": p3a,
                        "chunk_text": meta.get("chunk_text", "")[:3000],
                        "page_number": meta.get("page_number"),
                        "score": r.get("score", 0),
                        "metadata": meta,
                    })
                scores = [r.get("score", 0) for r in pinecone_results]
                score_range = f"top={max(scores):.3f}, bottom={min(scores):.3f}" if scores else ""
                new_count = len(results) - pinecone_before
                chat_log.search_result("Pinecone", len(pinecone_results), new_count, score_range)
                print(f"[SEARCH] Pinecone results processed: {new_count} new / {len(results)} total unique")
            else:
                chat_log.search_result("Pinecone", 0, 0, "no results")
                print(f"[SEARCH] Pinecone returned no results")
        else:
            chat_log.search_result("Pinecone", 0, 0, "unavailable")

        # 2. FTS5 keyword search (prefix matching)
        fts5_before = len(results)
        chat_log.search_strategy("FTS5 Keyword Search", f"words: {len(query_words)}")
        print(f"[SEARCH] Running keyword search (FTS5)...")
        try:
            from ..database import _local_keyword_search
            kw_results = _local_keyword_search(query, organization_id, limit=limit * 2)
            if kw_results:
                print(f"[SEARCH] Keywords returned {len(kw_results)} results")
                doc_ids = list(set(r["document_id"] for r in kw_results))
                title_map = self._fetch_doc_titles(doc_ids, organization_id)
                for item in kw_results:
                    did = item.get("document_id", "")
                    chunk_id = item.get("id", "")
                    if chunk_id in seen_ids:
                        continue
                    seen_ids.add(chunk_id)
                    title, dtype, p3a = title_map.get(did, ("", "", ""))
                    if document_type and dtype != document_type:
                        continue
                    results.append({
                        "document_id": did,
                        "document_title": title,
                        "document_type": dtype,
                        "phase3_agent": p3a,
                        "chunk_text": item.get("content", "")[:3000],
                        "page_number": item.get("page_id"),
                        "score": 0.9,
                        "metadata": item.get("metadata"),
                    })
                new_count = len(results) - fts5_before
                chat_log.search_result("FTS5", len(kw_results), new_count)
                print(f"[SEARCH] Keywords contributed {new_count} new results")
            else:
                chat_log.search_result("FTS5", 0, 0, "no results")
                print(f"[SEARCH] FTS5 returned nothing")
        except Exception as e:
            chat_log.search_result("FTS5", 0, 0, f"error: {e}")
            pass

        # 3. Per-word LIKE search (typo-tolerant partial matching)
        like_before = len(results)
        chat_log.search_strategy("Per-word LIKE Search (typo-tolerant)", f"{len(query_words)} words: {query_words[:5]}")
        try:
            like_results = set()
            seen_like = set()
            word_hits = {}
            for word in query_words:
                wr = SupabaseDB.select(
                    "document_chunks",
                    columns="id, document_id, organization_id, page_id, content, metadata",
                    like={"content": word},
                    limit=limit,
                )
                wdata = getattr(wr, "data", wr if isinstance(wr, list) else [])
                if isinstance(wdata, list):
                    word_hits[word] = len(wdata)
                    for item in wdata:
                        if isinstance(item, dict) and item.get("id") not in seen_like:
                            seen_like.add(item.get("id"))
                            like_results.add(item.get("id"))
            if like_results:
                all_like = SupabaseDB.select(
                    "document_chunks",
                    columns="id, document_id, organization_id, page_id, content, metadata",
                    filters={"organization_id": organization_id} if organization_id else None,
                    limit=limit * 3,
                )
                ldata = getattr(all_like, "data", all_like if isinstance(all_like, list) else [])
                if isinstance(ldata, list):
                    doc_ids = list(set(r.get("document_id", "") for r in ldata if isinstance(r, dict) and r.get("id") in like_results))
                    title_map = self._fetch_doc_titles(doc_ids, organization_id)
                    for item in ldata:
                        if not isinstance(item, dict) or item.get("id") not in like_results:
                            continue
                        chunk_id = item.get("id")
                        if chunk_id in seen_ids:
                            continue
                        seen_ids.add(chunk_id)
                        did = item.get("document_id", "")
                        title, dtype, p3a = title_map.get(did, ("", "", ""))
                        if document_type and dtype != document_type:
                            continue
                        results.append({
                            "document_id": did,
                            "document_title": title,
                            "document_type": dtype,
                            "phase3_agent": p3a,
                            "chunk_text": item.get("content", "")[:3000],
                            "page_number": item.get("page_id"),
                            "score": 0.7,
                            "metadata": item.get("metadata"),
                        })
                new_count = len(results) - like_before
                word_breakdown = ", ".join(f"{w}={h}" for w, h in word_hits.items() if h > 0)
                chat_log.search_result("LIKE", len(like_results), new_count, word_breakdown)
            else:
                chat_log.search_result("LIKE", 0, 0, "no matches")
        except Exception as e:
            chat_log.search_result("LIKE", 0, 0, f"error: {e}")
            pass

        # 4. Supabase vector search (handles typos via embeddings)
        sqs_before = len(results)
        chat_log.search_strategy("Supabase Vector Search", f"threshold=0.5, top_k={limit * 2}")
        try:
            vector_results = SupabaseDB.search_vector(
                "document_chunks",
                query_embedding,
                match_threshold=0.5,
                match_count=limit * 2,
                filter_org_id=organization_id,
            )
            vector_count = len(getattr(vector_results, "data", vector_results if isinstance(vector_results, list) else []))
        except Exception:
            vector_results = {"data": []}
            vector_count = 0

        vec_doc_ids = list(set(chunk.get("document_id", "") for chunk in (getattr(vector_results, "data", vector_results if isinstance(vector_results, list) else []) if isinstance(vector_results, (list, dict)) else [])))
        vec_title_map = self._fetch_doc_titles(vec_doc_ids, organization_id) if vec_doc_ids else {}
        for item in getattr(vector_results, "data", vector_results if isinstance(vector_results, list) else []):
            chunk = item if isinstance(item, dict) else {}
            chunk_id = chunk.get("id", "")
            if chunk_id in seen_ids:
                continue
            seen_ids.add(chunk_id)
            if document_type and chunk.get("document_type") != document_type:
                continue
            did = chunk.get("document_id", "")
            title, dtype, p3a = vec_title_map.get(did, ("", "", ""))
            results.append({
                "document_id": did,
                "document_title": title or chunk.get("document_title", ""),
                "document_type": dtype or chunk.get("document_type"),
                "phase3_agent": p3a,
                "chunk_text": chunk.get("content", chunk.get("chunk_text", "")),
                "page_number": chunk.get("page_number", chunk.get("page_id")),
                "score": chunk.get("similarity", chunk.get("score", 0)),
                "metadata": chunk.get("metadata"),
            })
        new_count = len(results) - sqs_before
        chat_log.search_result("Supabase Vector", vector_count, new_count)

        results = sorted(results, key=lambda x: x["score"], reverse=True)
        if document_ids:
            doc_set = set(document_ids)
            results = [r for r in results if r["document_id"] in doc_set]
        final = results[offset:offset + limit]
        chat_log.info(f"Total after sort+filter: {len(final)} chunks (from {len(results)} unique, {len(seen_ids)} total seen)")
        top_scores = [f"{r['document_title'][:30]}: {r['score']:.3f}" for r in final[:3]]
        if top_scores:
            chat_log.info(f"Top results: {', '.join(top_scores)}")
        return final

    def get_document_context(self, document_id: str, organization_id: str, max_chunks: int = 10) -> str:
        try:
            result = SupabaseDB.select(
                "document_chunks",
                columns="content, page_id",
                filters={"document_id": document_id, "organization_id": organization_id},
            )
            chunks = getattr(result, "data", result if isinstance(result, list) else [])
            texts = []
            for c in chunks[:max_chunks]:
                if isinstance(c, dict):
                    page = c.get("page_id", "")
                    content = c.get("content", "")
                    if page:
                        texts.append(f"[Page {page}]: {content}")
                    else:
                        texts.append(content)
            return "\n\n".join(texts)
        except Exception:
            return ""


    def _get_first_embedding(self, document_id: str, organization_id: str) -> list[float] | None:
        try:
            result = SupabaseDB.select("document_embeddings", filters={"document_id": document_id, "organization_id": organization_id})
            data = getattr(result, "data", [])
            if isinstance(data, list) and data:
                emb = data[0].get("embedding") if isinstance(data[0], dict) else None
                if isinstance(emb, str):
                    import ast
                    emb = ast.literal_eval(emb)
                if emb:
                    return emb
        except Exception:
            pass
        return None

    def find_similar(self, document_id: str, organization_id: str, limit: int = 5) -> list[dict]:
        try:
            emb = self._get_first_embedding(document_id, organization_id)
            if emb is None:
                return []

            seen_ids = set()
            results = []

            if pinecone_service.available:
                filter_dict = {"organization_id": organization_id}
                pinecone_results = pinecone_service.query(emb, top_k=limit + 5, filter=filter_dict, namespace=organization_id)
                title_map = {}
                if pinecone_results:
                    doc_ids = list(set(r["metadata"].get("document_id", "") for r in pinecone_results))
                    title_map = self._fetch_doc_titles(doc_ids, organization_id)
                for r in pinecone_results:
                    meta = r.get("metadata", {})
                    did = meta.get("document_id", "")
                    if did == document_id or did in seen_ids:
                        continue
                    seen_ids.add(did)
                    title, dtype = title_map.get(did, ("", ""))
                    results.append({
                        "document_id": did,
                        "document_title": title,
                        "document_type": dtype,
                        "chunk_text": meta.get("chunk_text", "")[:500],
                        "page_number": meta.get("page_number"),
                        "score": r.get("score", 0),
                        "metadata": meta,
                    })
                    if len(results) >= limit:
                        break

            if not results:
                similar = SupabaseDB.search_vector("document_chunks", emb, match_threshold=0.6, match_count=limit * 2, filter_org_id=organization_id)
                items = getattr(similar, "data", similar if isinstance(similar, list) else [])
                for item in items:
                    if isinstance(item, dict):
                        d_id = item.get("document_id", "")
                        if d_id == document_id or d_id in seen_ids:
                            continue
                        seen_ids.add(d_id)
                        results.append({
                            "document_id": d_id,
                            "document_title": item.get("document_title", item.get("content", "")[:50]),
                            "document_type": item.get("document_type"),
                            "chunk_text": item.get("content", item.get("chunk_text", "")),
                            "page_number": item.get("page_number", item.get("page_id")),
                            "score": item.get("similarity", item.get("score", 0)),
                            "metadata": item.get("metadata"),
                        })
                        if len(results) >= limit:
                            break
            return results
        except Exception as e:
            import logging
            logging.getLogger("visibility-docs").error(f"find_similar error: {e}")
            return []


rag_service = RAGService()
