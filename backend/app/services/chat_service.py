import time
from .conversation_service import conversation_service
from .rag_service import rag_service
from .document_service import document_service
from ..database import SupabaseDB
from .orchestration_logger import get_chat_logger, C
from .agent_orchestrator import _load_phase3_prompt, _load_prompt, DOCUMENT_TO_PHASE3_AGENT, PHASE3_AGENT_PROMPT_MAP

_RESUME_KEYWORDS = ["resume", "cv ", "candidate", "applicant", "hiring", "recruit",
                    "top.*resume", "best.*candidate", "rank.*resume", "score.*resume",
                    "sorted.*resume", "highest.*score", "top.*candidate",
                    "give me.*top", "list.*resume", "show.*candidate", "list.*candidate",
                    "top.*resume", "recommend.*candidate", "best.*fit"]

_AGGREGATE_KEYWORDS = [r"\bsum\b", r"\btotal\b", r"\baggregate\b", r"\bcombine\b",
                       r"\boverall\b", r"\bgrand total\b", r"\ball\b.*\btotal\b",
                       r"\btotal\b.*\ball\b", r"\badd up\b", r"\bsum up\b",
                       r"\baccumulated\b", r"\bcombined\b", r"\btogether\b"]


class ChatService:
    def _get_or_create_session(self, session_id: str, organization_id: str, document_ids: list = None) -> tuple[str, list, bool]:
        is_first = True
        if session_id:
            existing = SupabaseDB.get_chat_session(session_id)
            if existing:
                stored_ids = existing.get("document_ids") or []
                messages = existing.get("messages") or []
                is_first = len(messages) == 0
                if messages:
                    conversation_service.load_history_from_db(session_id, messages)
                resolved = document_ids if document_ids is not None else stored_ids
                if document_ids is not None and set(document_ids) != set(stored_ids):
                    SupabaseDB.update_chat_session_doc_ids(session_id, document_ids)
                return session_id, resolved, is_first
        doc_list = document_ids or []
        new_id = SupabaseDB.create_chat_session(organization_id, "New Chat", doc_list)
        return new_id, doc_list, True

    def _auto_title(self, session_id: str, first_question: str):
        title = first_question[:80].strip()
        if len(title) == 80:
            title = title[:77] + "..."
        SupabaseDB.update_chat_session_title(session_id, title)

    def _save_exchange(self, session_id: str, question: str, answer: str, sources: list, is_first: bool):
        SupabaseDB.save_chat_message(session_id, "user", question)
        SupabaseDB.save_chat_message(session_id, "assistant", answer, sources)
        if is_first:
            self._auto_title(session_id, question)

    def _fetch_extraction_summary(self, document_ids: list, organization_id: str) -> str:
        if not document_ids:
            return ""
        try:
            import json
            from ..database import _get_supabase, _use_supabase, _local_select_in
            unique_ids = list(set(document_ids))
            client = _get_supabase()
            if _use_supabase and client:
                r = client.table("document_extractions") \
                    .select("document_id, extraction_type, extracted_data, confidence") \
                    .in_("document_id", unique_ids) \
                    .eq("organization_id", organization_id) \
                    .execute()
                rows = getattr(r, "data", [])
            else:
                rows = _local_select_in("document_extractions",
                    columns="document_id, extraction_type, extracted_data, confidence",
                    filters={"organization_id": organization_id},
                    in_column="document_id", in_values=unique_ids)
            if not rows:
                return ""

            doc_info = {}
            try:
                title_result = SupabaseDB.select("documents",
                    columns="id, title",
                    filters={"organization_id": organization_id},
                )
                title_data = getattr(title_result, "data", title_result if isinstance(title_result, list) else [])
                for row in title_data:
                    doc_info[row["id"]] = row.get("title", "")
            except Exception:
                pass

            lines = ["[Structured Document Data for Aggregation]"]
            totals = {}
            parsed_count = 0

            # Group extractions by document_id, merging image data into main extraction
            doc_extractions = {}
            for row in rows:
                did = row.get("document_id", "")
                ext_type = row.get("extraction_type", "")
                raw = row.get("extracted_data", "{}")
                if isinstance(raw, str):
                    try:
                        parsed = json.loads(raw)
                    except Exception:
                        continue
                else:
                    parsed = raw or {}
                if not isinstance(parsed, dict):
                    continue

                if did not in doc_extractions:
                    doc_extractions[did] = {"type": ext_type, "data": {}}
                if ext_type == "image_extraction":
                    doc_extractions[did]["has_images"] = True
                    doc_extractions[did]["images"] = parsed.get("images", [])
                else:
                    doc_extractions[did]["type"] = ext_type
                    doc_extractions[did]["data"].update(parsed)

            for did, ext_info in doc_extractions.items():
                parsed = ext_info["data"]
                title = doc_info.get(did, did)
                lines.append(f"\n  Document: {title}  (id: {did})")
                lines.append(f"  Type: {ext_info['type']}")

                for key, val in parsed.items():
                    if key.startswith("_"):
                        continue
                    if isinstance(val, str) and val:
                        lines.append(f"    {key}: {val}")
                    elif isinstance(val, (int, float)):
                        lines.append(f"    {key}: {val}")
                        totals[key] = totals.get(key, 0) + val

                if ext_info.get("has_images"):
                    img_count = len(ext_info.get("images", []))
                    lines.append(f"    images: {img_count} image(s) with vision descriptions in document context")
                parsed_count += 1

            if parsed_count > 1 and totals:
                lines.append("\n  --- Aggregated Totals ---")
                for key, val in sorted(totals.items()):
                    lines.append(f"    Sum of {key}: {val}")

            result = "\n".join(lines)
            return result
        except Exception as e:
            chat_log = get_chat_logger()
            chat_log.warn(f"Extraction summary error: {e}")
            return ""

    def chat_with_document(self, question: str, document_ids: list, organization_id: str,
                           document_type: str = None, phase3_agent: str = None,
                           status: str = None, date_from: str = None, date_to: str = None,
                           chat_history: list[dict] = None, session_id: str = None) -> dict:
        chat_log = get_chat_logger()
        chat_log.chat_start(question, session_id=session_id or "", doc_count=len(document_ids or []))
        t_start = time.time()

        sid, resolved_ids, is_first = self._get_or_create_session(session_id, organization_id, document_ids)

        hybrid_kwargs = dict(
            query=question,
            organization_id=organization_id,
            document_type=document_type,
            phase3_agent=phase3_agent,
            status=status,
            date_from=date_from,
            date_to=date_to,
            document_ids=resolved_ids if resolved_ids else None,
            limit=15,
        )
        search_results = rag_service.hybrid_search(**hybrid_kwargs)

        q_lower = question.lower()
        is_resume_query = any(
            __import__("re").search(kw, q_lower) for kw in _RESUME_KEYWORDS
        )
        is_finance_query = (
            document_type == "invoice"
            or phase3_agent == "finance_agent"
            or any(term in q_lower for term in [
                "invoice", "subtotal", "amount due", "grand total", "due date",
                "payment terms", "vendor", "customer", "bill to", "ship to",
                "tax", "vat", "gst", "line item", "line items", "invoice number",
            ])
        )

        if not search_results and not is_resume_query and document_type:
            chat_log.warn(f"No results with document_type={document_type} — retrying without type filter")
            retry_kwargs = {k: v for k, v in hybrid_kwargs.items() if k != "document_type"}
            search_results = rag_service.hybrid_search(**retry_kwargs)

        if not search_results:
            resumes = []
            if is_resume_query:
                try:
                    resumes = document_service.list_documents(organization_id)
                    if resolved_ids:
                        resolved_set = set(resolved_ids)
                        resumes = [r for r in resumes if r["id"] in resolved_set]
                    document_service._batch_attach_extractions(resumes, organization_id)
                    resumes = [r for r in resumes if r.get("cv_score") is not None]
                    resumes.sort(key=lambda x: x.get("cv_score", 0) or 0, reverse=True)
                except Exception:
                    resumes = []

            resume_context = ""
            resume_sources = []
            if resumes:
                lines = ["[Resume Rankings (sorted by CV evaluation score)]"]
                for i, r in enumerate(resumes[:20], 1):
                    score_str = f"{r['cv_score']}/100" if r["cv_score"] is not None else "N/A"
                    lines.append(f"{i}. {r['title']} — {score_str}")
                    resume_sources.append({
                        "document_id": r["id"],
                        "document_title": r["title"],
                        "cv_score": r.get("cv_score"),
                        "score": r.get("cv_score", 0) / 100.0,
                    })
                resume_context = "\n".join(lines)

            # If search returned nothing but we are clearly in finance/invoice mode,
            # answer directly from structured extraction data when available.
            finance_context = ""
            if is_finance_query and resolved_ids:
                finance_context = self._fetch_extraction_summary(resolved_ids, organization_id)
            if finance_context:
                chat_log.search_strategy("Structured Extraction Fallback", "no vector matches, using invoice metadata")
                finance_prompt = (
                    "You are a Finance Agent for Visibility Docs AI.\n\n"
                    "Use the provided structured extraction summary to answer the question exactly.\n"
                    "If the answer is missing, say you cannot find it in the documents.\n"
                    "Do not invent numbers, dates, or names.\n"
                )
                chat_log.llm_call("llama-3.3-70b-versatile", len(finance_context), len(question), 1)
                llm_t0 = time.time()
                answer = conversation_service.chat(question, finance_context, session_id=sid, system_prompt=finance_prompt)
                chat_log.llm_response(time.time() - llm_t0, len(answer))
                self._save_exchange(sid, question, answer, [], is_first)
                total = time.time() - t_start
                chat_log.chat_end(total, 0)
                return {
                    "answer": answer,
                    "sources": [],
                    "document_id": resolved_ids[0] if resolved_ids else "",
                    "history": conversation_service.get_history(sid),
                    "session_id": sid,
                }

            chat_log.search_strategy("Context Building", "no results found")
            chat_log.warn("No relevant documents found in search")
            chat_log.llm_call("llama-3.3-70b-versatile", 0, len(question), 0)
            system_prompt = ""
            if resume_context:
                system_prompt = "You are a Resume Screening assistant. Use the [Resume Rankings] block to answer ranking/comparison questions. Do not make up information."
            if is_first:
                llm_t0 = time.time()
                answer = conversation_service.chat(question, resume_context, session_id=sid,
                    system_prompt=system_prompt)
                chat_log.llm_response(time.time() - llm_t0, len(answer))
            else:
                llm_t0 = time.time()
                answer = conversation_service.chat(question, resume_context, session_id=sid, is_followup=True)
                chat_log.llm_response(time.time() - llm_t0, len(answer))
            self._save_exchange(sid, question, answer, resume_sources[:5], is_first)
            total = time.time() - t_start
            chat_log.chat_end(total, 0)
            return {
                "answer": answer,
                "sources": resume_sources[:5],
                "document_id": resolved_ids[0] if resolved_ids else "",
                "history": conversation_service.get_history(sid),
                "session_id": sid,
            }

        context_parts = []
        sources = []
        for r in search_results:
            context_parts.append(f"[Document: {r['document_title']}]: {r['chunk_text']}")
            sources.append({
                "document_id": r["document_id"],
                "document_title": r["document_title"],
                "document_type": r.get("document_type", ""),
                "cv_score": r.get("cv_score"),
                "phase3_agent": r.get("phase3_agent", ""),
                "page_number": r["page_number"],
                "score": r["score"],
            })

        context = "\n\n".join(context_parts)
        context_len = len(context)

        # ── Attach file_url to sources for frontend file name display ──
        try:
            unique_ids = list(set(s["document_id"] for s in sources))
            if unique_ids:
                file_result = SupabaseDB.select("documents",
                    columns="id, original_file_url",
                    filters={"organization_id": organization_id},
                )
                file_data = getattr(file_result, "data", file_result if isinstance(file_result, list) else [])
                if isinstance(file_data, list):
                    id_to_url = {row["id"]: row.get("original_file_url", "") for row in file_data if row.get("id") in unique_ids}
                    for s in sources:
                        s["file_url"] = id_to_url.get(s["document_id"], "")
        except Exception:
            pass

        # ── Resume ranking: if query mentions resumes, inject sorted scores ──
        resumes = []
        if is_resume_query:
            try:
                resumes = document_service.list_documents(organization_id)
                if resolved_ids:
                    resolved_set = set(resolved_ids)
                    resumes = [r for r in resumes if r["id"] in resolved_set]
                document_service._batch_attach_extractions(resumes, organization_id)
                resumes = [r for r in resumes if r.get("cv_score") is not None]
                resumes.sort(key=lambda x: x.get("cv_score", 0) or 0, reverse=True)
            except Exception:
                resumes = []
            if resumes:
                lines = ["[Resume Rankings (sorted by CV evaluation score)]"]
                for i, r in enumerate(resumes[:20], 1):
                    score_str = f"{r['cv_score']}/100" if r["cv_score"] is not None else "N/A"
                    lines.append(f"{i}. {r['title']} — {score_str}")
                resume_block = "\n".join(lines)
                context = resume_block + "\n\n" + context if context else resume_block
                chat_log.info(f"Injected {len(resumes)} resume scores into context")

        # ── Structured extraction summary for aggregate/multi-doc queries ──
        is_aggregate_query = any(
            __import__("re").search(kw, q_lower) for kw in _AGGREGATE_KEYWORDS
        )
        if (is_aggregate_query or is_finance_query) and resolved_ids:
            extraction_summary = self._fetch_extraction_summary(resolved_ids, organization_id)
            if extraction_summary:
                context = extraction_summary + "\n\n" + context if context else extraction_summary
                chat_log.info(f"Injected structured extraction summary for {len(resolved_ids)} documents")

        chat_log.search_strategy("Context Building", f"{len(search_results)} chunks → {context_len} chars")
        doc_types_seen = {}
        agent_prompts_seen = {}
        for r in search_results:
            dt = r.get("document_type", "unknown")
            doc_types_seen[dt] = doc_types_seen.get(dt, 0) + 1
            p3a = r.get("phase3_agent", "")
            if p3a:
                prompt_file = f"prompts/phase3/{p3a}.md"
                agent_prompts_seen[prompt_file] = agent_prompts_seen.get(prompt_file, 0) + 1
        if doc_types_seen:
            chat_log.info(f"Document types: {', '.join(f'{k}={v}' for k, v in doc_types_seen.items())}")
        if agent_prompts_seen:
            chat_log.info(f"Agent prompts used: {', '.join(f'{k}' for k, v in agent_prompts_seen.items())}")

        unique_docs = list(set(r["document_id"] for r in search_results))
        chat_log.info(f"Unique documents: {len(unique_docs)}")
        for i, s in enumerate(sources[:5]):
            p3a = s.get("phase3_agent", "")
            agent_tag = f" [{p3a}]" if p3a else ""
            doc_type = s.get("document_type") or ""
            chat_log.source_item(i, s["document_title"], doc_type + agent_tag, s["score"])

        # ── Determine dominant agent from selected documents directly ──
        doc_agent_counts = {}
        if resolved_ids:
            try:
                doc_result = SupabaseDB.select("documents",
                    columns="id, document_type, phase3_agent",
                    filters={"organization_id": organization_id},
                )
                doc_data = getattr(doc_result, "data", doc_result if isinstance(doc_result, list) else [])
                resolved_set = set(resolved_ids)
                for d in doc_data:
                    if d.get("id") in resolved_set:
                        p3a = d.get("phase3_agent") or DOCUMENT_TO_PHASE3_AGENT.get(d.get("document_type", ""), "other_agent")
                        if p3a:
                            doc_agent_counts[p3a] = doc_agent_counts.get(p3a, 0) + 1
            except Exception:
                pass

        # Also count from search results as fallback
        agent_counts = {}
        for r in search_results:
            p3a = r.get("phase3_agent") or DOCUMENT_TO_PHASE3_AGENT.get(r.get("document_type", ""), "other_agent")
            agent_counts[p3a] = agent_counts.get(p3a, 0) + 1

        # Use selected-doc agents if available, otherwise fall back to search result agents
        dominant_source = doc_agent_counts if doc_agent_counts else agent_counts
        dominant_agent = max(dominant_source, key=dominant_source.get) if dominant_source else "other_agent"

        # Load the full agent .md prompt and adapt it for Q&A
        qa_prompt = ""
        try:
            if is_finance_query or dominant_agent == "finance_agent":
                qa_prompt = (
                    "You are the Finance Agent for Visibility Docs AI, answering questions about invoices and other financial documents.\n\n"
                    "Use ONLY the provided context. Prefer the structured extraction summary when it exists, because it contains exact extracted fields.\n\n"
                    "Rules:\n"
                    "0. Always answer in the same language as the user's question — Urdu/Saraiki question → Urdu answer, English question → English answer.\n"
                    "1. Answer directly and precisely.\n"
                    "2. For invoice questions, use exact values for invoice number, dates, vendor, customer, subtotal, tax, total, due date, payment terms, and line items.\n"
                    "3. Keep currency symbols and units intact.\n"
                    "4. If the answer is not present, say \"I cannot find this information in the documents.\"\n"
                    "5. If there is a mismatch between structured data and raw text, mention it briefly.\n"
                    "6. Do not invent values.\n"
                    "7. If line items are present, list them cleanly and include quantities/prices when available.\n"
                    "8. Do not output JSON.\n"
                )
            else:
                raw_prompt = _load_phase3_prompt(f"{dominant_agent}.md")
                if raw_prompt:
                    import re
                    qa_prompt = raw_prompt.replace("{text}", "{context}")
                    # Remove extraction-specific JSON instructions, keep Document text line
                    qa_prompt = re.sub(
                        r"Return ONLY valid JSON\..*?(?=\nDocument text:)",
                        "Answer the user's question based ONLY on the provided document context below.",
                        qa_prompt,
                        flags=re.DOTALL,
                    )
                    # Remove the now-unnecessary "Document text:" line
                    qa_prompt = qa_prompt.replace("\nDocument text:\n{context}", "")
                    qa_prompt += (
                        "\n\nRules:\n"
                        "0. Always answer in the same language as the user's question — Urdu/Saraiki question → Urdu answer, English question → English answer.\n"
                        "1. Answer concisely and directly using the context.\n"
                        "2. If the context contains image/vision descriptions, use them to answer.\n"
                        "3. If the answer is NOT in the context, say \"I cannot find this information in the documents.\"\n"
                        "4. Do NOT make up or hallucinate information.\n"
                        "5. Do NOT output JSON or extract fields — just answer the question naturally.\n"
                        "6. If the context has tables or diagrams, explain what they show.\n"
                    )
                    resume_rank_instruction = (
                        "\n7. The context may include a [Resume Rankings] block with CV evaluation scores. "
                        "Use those scores to rank, compare, or recommend candidates when asked.\n"
                    ) if is_resume_query and any(r.get("cv_score") is not None for r in resumes) else ""
                    qa_prompt += resume_rank_instruction
        except Exception:
            pass

        if not qa_prompt:
            # Fallback: generic prompt with agent label
            agent_label = dominant_agent.replace("_", " ").title()
            if is_finance_query or dominant_agent == "finance_agent":
                qa_prompt = (
                    "You are a Finance Agent for Visibility Docs AI.\n\n"
                    "Answer only from the provided context and structured summary.\n\n"
                    "Rules:\n"
                    "1. Be exact about amounts, dates, and names.\n"
                    "2. Keep currency symbols and percentages intact.\n"
                    "3. If the answer is missing, say you cannot find it in the documents.\n"
                    "4. Do not hallucinate or infer unsupported numbers.\n"
                    "5. Do not output JSON.\n"
                )
            else:
                resume_rank_instruction = (
                    "\n7. The context may include a [Resume Rankings] block with CV evaluation scores. "
                    "Use those scores to rank, compare, or recommend candidates when asked.\n"
                ) if is_resume_query and any(r.get("cv_score") is not None for r in resumes) else ""
                qa_prompt = (
                    f"You are the {agent_label} - a document Q&A assistant for Visibility Docs AI.\n\n"
                    "Your job is to answer the user's question based ONLY on the provided document context below.\n\n"
                    "Rules:\n"
                    "1. Answer concisely and directly using the context.\n"
                    "2. If the context contains image/vision descriptions, use them to answer.\n"
                    "3. If the answer is NOT in the context, say \"I cannot find this information in the documents.\"\n"
                    "4. Do NOT make up or hallucinate information.\n"
                    "5. Do NOT output JSON or extract fields - just answer the question.\n"
                    "6. If the context has tables or diagrams, explain what they show.\n"
                    f"{resume_rank_instruction}"
                )
        chat_log.info(f"Built Q&A prompt for agent: {dominant_agent} ({len(qa_prompt)} chars)")

        chat_log.llm_call("llama-3.3-70b-versatile", context_len, len(question), len(sources))
        llm_t0 = time.time()
        is_followup = not is_first
        answer = conversation_service.chat(question, context, session_id=sid, is_followup=is_followup,
                                            system_prompt=qa_prompt)
        chat_log.llm_response(time.time() - llm_t0, len(answer))

        history = conversation_service.get_history(sid)
        self._save_exchange(sid, question, answer, sources[:5], is_first)

        total = time.time() - t_start
        chat_log.chat_end(total, len(sources))
        chat_log.info(f"Answer length: {len(answer)} chars")

        return {
            "answer": answer,
            "sources": sources[:5],
            "document_id": sources[0]["document_id"] if sources else "",
            "history": history,
            "session_id": sid,
        }


chat_service = ChatService()
