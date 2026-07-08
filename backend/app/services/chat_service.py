from .conversation_service import conversation_service
from .rag_service import rag_service
from ..database import SupabaseDB


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
                           chat_history: list[dict] = None, session_id: str = None) -> dict:
        sid, resolved_ids, is_first = self._get_or_create_session(session_id, organization_id, document_ids)

        if resolved_ids:
            search_results = rag_service.hybrid_search(question, organization_id, document_ids=resolved_ids, limit=15)
        else:
            search_results = rag_service.hybrid_search(question, organization_id, limit=15)

        if not search_results:
            if is_first:
                answer = "I could not find any relevant information in the selected documents."
                conversation_service.chat(question, "", session_id=sid)
            else:
                answer = conversation_service.chat(question, "", session_id=sid, is_followup=True)
            self._save_exchange(sid, question, answer, [], is_first)
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
                "page_number": r["page_number"],
                "score": r["score"],
            })

        context = "\n\n".join(context_parts)

        answer = conversation_service.chat(question, context, session_id=sid, is_followup=not is_first)
        history = conversation_service.get_history(sid)
        self._save_exchange(sid, question, answer, sources[:5], is_first)

        return {
            "answer": answer,
            "sources": sources[:5],
            "document_id": sources[0]["document_id"] if sources else "",
            "history": history,
            "session_id": sid,
        }


chat_service = ChatService()
