import time
from .conversation_service import conversation_service
from .rag_service import rag_service
from ..database import SupabaseDB
from .orchestration_logger import get_chat_logger, C
from .agent_orchestrator import _load_phase3_prompt, _load_prompt, DOCUMENT_TO_PHASE3_AGENT, PHASE3_AGENT_PROMPT_MAP


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
                return session_id, stored_ids, is_first
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

        if not search_results:
            chat_log.search_strategy("Context Building", "no results found")
            chat_log.warn("No relevant documents found in search")
            chat_log.llm_call("llama-3.3-70b-versatile", 0, len(question), 0)
            if is_first:
                answer = "I could not find any relevant information in the selected documents."
                llm_t0 = time.time()
                conversation_service.chat(question, "", session_id=sid)
                chat_log.llm_response(time.time() - llm_t0, len(answer))
            else:
                llm_t0 = time.time()
                answer = conversation_service.chat(question, "", session_id=sid, is_followup=True)
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

        context_parts = []
        sources = []
        for r in search_results:
            context_parts.append(f"[Document: {r['document_title']}]: {r['chunk_text']}")
            sources.append({
                "document_id": r["document_id"],
                "document_title": r["document_title"],
                "document_type": r.get("document_type", ""),
                "phase3_agent": r.get("phase3_agent", ""),
                "page_number": r["page_number"],
                "score": r["score"],
            })

        context = "\n\n".join(context_parts)
        context_len = len(context)

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
            chat_log.source_item(i, s["document_title"], s.get("document_type", "") + agent_tag, s["score"])

        # ── Build Q&A system prompt from agent type (NOT extraction prompt) ──
        agent_counts = {}
        for r in search_results:
            p3a = r.get("phase3_agent") or DOCUMENT_TO_PHASE3_AGENT.get(r.get("document_type", ""), "other_agent")
            agent_counts[p3a] = agent_counts.get(p3a, 0) + 1
        dominant_agent = max(agent_counts, key=agent_counts.get) if agent_counts else "other_agent"
        agent_label = dominant_agent.replace("_", " ").title()

        qa_prompt = (
            f"You are the {agent_label} — a document Q&A assistant for Visibility Docs AI.\n\n"
            "Your job is to answer the user's question based ONLY on the provided document context below.\n\n"
            "Rules:\n"
            "1. Answer concisely and directly using the context.\n"
            "2. If the context contains image/vision descriptions, use them to answer.\n"
            "3. If the answer is NOT in the context, say \"I cannot find this information in the documents.\"\n"
            "4. Do NOT make up or hallucinate information.\n"
            "5. Do NOT output JSON or extract fields — just answer the question.\n"
            "6. If the context has tables or diagrams, explain what they show.\n"
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
