import os
import json
import logging

logger = logging.getLogger("visibility-docs")

PROMPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "prompts")


def _load_prompt(filename: str) -> str:
    path = os.path.join(PROMPTS_DIR, filename)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    return ""


def _load_phase3_prompt(filename: str) -> str:
    return _load_prompt(os.path.join("phase3", filename))


PHASE3_AGENT_PROMPT_MAP = {
    "finance_agent": os.path.join("phase3", "finance_agent.md"),
    "procurement_agent": os.path.join("phase3", "procurement_agent.md"),
    "hr_agent": os.path.join("phase3", "hr_agent.md"),
    "legal_agent": os.path.join("phase3", "legal_agent.md"),
    "compliance_agent": os.path.join("phase3", "compliance_agent.md"),
    "other_agent": os.path.join("phase3", "other.md"),
}

DOCUMENT_TO_PHASE3_AGENT = {
    "invoice": "finance_agent",
    "financial_statement": "finance_agent",
    "purchase_order": "procurement_agent",
    "quotation": "procurement_agent",
    "contract": "legal_agent",
    "hr_document": "hr_agent",
    "certificate": "compliance_agent",
    "audit_report": "compliance_agent",
    "quality_report": "compliance_agent",
    "maintenance_report": "compliance_agent",
    "sop": "compliance_agent",
    "engineering_drawing": "compliance_agent",
    "other": "other_agent",
}

VALID_PHASE3_AGENTS = set(PHASE3_AGENT_PROMPT_MAP.keys())

HEURISTIC_RULES = [
    (
        "finance_agent",
        "invoice",
        [
            "invoice", "subtotal", "tax", "total", "amount due", "due date", "receipt",
            "balance", "payment", "currency", "bank details", "financial statement",
            "profit and loss", "p&l", "revenue",
        ],
    ),
    (
        "procurement_agent",
        "purchase_order",
        [
            "purchase order", "po number", "quotation", "supplier", "vendor", "requisition",
            "delivery date", "incoterms", "order quantity", "line items", "buyer",
        ],
    ),
    (
        "hr_agent",
        "hr_document",
        [
            "employee", "salary", "appraisal", "leave", "offer letter", "hr policy",
            "payroll", "designation", "department", "training", "manager",
        ],
    ),
    (
        "legal_agent",
        "contract",
        [
            "contract", "agreement", "party a", "party b", "nda", "governing law",
            "jurisdiction", "clause", "termination", "renewal", "signature",
        ],
    ),
    (
        "compliance_agent",
        "audit_report",
        [
            "audit", "certificate", "sop", "standard operating procedure", "quality report",
            "maintenance", "inspection", "non-conformance", "corrective action", "compliance",
            "finding", "recommendation", "regulation",
        ],
    ),
]


class ClassificationAgent:
    def _heuristic_classify(self, text: str, filename: str = "") -> dict:
        haystack = f"{filename}\n{text}".lower()
        best = None
        best_score = 0

        for agent_type, doc_type, keywords in HEURISTIC_RULES:
            score = sum(1 for keyword in keywords if keyword in haystack)
            if score > best_score:
                best = (agent_type, doc_type)
                best_score = score

        if not best:
            return {
                "document_type": "other",
                "agent_type": "compliance_agent",
                "confidence": 0.15,
                "reasoning": "Heuristic fallback did not find a strong match",
                "language": "en",
                "estimated_quality": "low",
            }

        agent_type, doc_type = best
        confidence = min(0.95, 0.35 + (best_score * 0.12))
        return {
            "document_type": doc_type,
            "agent_type": agent_type,
            "confidence": confidence,
            "reasoning": f"Heuristic fallback matched {best_score} keyword groups for {agent_type}",
            "language": "en",
            "estimated_quality": "medium",
        }

    def classify(self, text: str, filename: str = "") -> dict:
        from .groq_service import groq_service

        print(f"[CLASSIFY] Classifying document: {filename} (text: {len(text)} chars)")
        prompt_template = _load_prompt("classification_agent.md")
        if not prompt_template:
            print(f"[CLASSIFY] No prompt template found, using heuristic")
            return self._heuristic_classify(text, filename)

        prompt = prompt_template.replace("{text}", text[:64000]).replace("{filename}", filename)
        try:
            t0 = __import__("time").time()
            result = groq_service._parse_json(
                groq_service.chat([{"role": "user", "content": prompt}], temperature=0.05, max_tokens=2048),
                {},
            )
            duration = __import__("time").time() - t0
            if not result:
                print(f"[CLASSIFY] LLM returned empty, falling back to heuristic")
                return self._heuristic_classify(text, filename)
            doc_type = str(result.get("document_type", "other")).lower().replace(" ", "_")
            agent_type = str(result.get("phase3_agent", "")).lower().replace(" ", "_")

            from ..models.schemas import DocumentType
            valid_types = {t.value for t in DocumentType}
            if doc_type not in valid_types:
                print(f"[CLASSIFY] Invalid doc_type '{doc_type}' from LLM, falling back to 'other'")
                doc_type = "other"

            if agent_type not in VALID_PHASE3_AGENTS:
                old_agent = agent_type
                agent_type = DOCUMENT_TO_PHASE3_AGENT.get(doc_type, "other_agent")
                print(f"[CLASSIFY] Invalid agent '{old_agent}' from LLM, mapped to '{agent_type}' for type '{doc_type}'")

            result_data = {
                "document_type": doc_type,
                "agent_type": agent_type,
                "confidence": float(result.get("confidence", 0)),
                "reasoning": result.get("reasoning", ""),
                "language": result.get("language", "en"),
                "estimated_quality": result.get("estimated_quality", "medium"),
            }
            print(f"[CLASSIFY] Result: type={doc_type}, agent={agent_type}, conf={result_data['confidence']:.2f}, lang={result_data['language']}, time={duration:.1f}s")
            return result_data
        except Exception as e:
            print(f"[CLASSIFY] LLM classification error: {e}, falling back to heuristic")
            logger.warning(f"Classification agent fallback used: {e}")
            fallback = self._heuristic_classify(text, filename)
            fallback["reasoning"] = f"{fallback['reasoning']}; LLM fallback reason: {e}"
            return fallback


class CategoryExtractionAgent:
    def extract(self, text: str, document_type: str, agent_type: str = "") -> dict:
        from .groq_service import groq_service

        agent = agent_type or DOCUMENT_TO_PHASE3_AGENT.get(document_type, "other_agent")
        print(f"[EXTRACT] Agent: {agent} | DocType: {document_type} | Text: {len(text)} chars")
        prompt_template = _load_phase3_prompt(f"{agent}.md")
        if not prompt_template:
            print(f"[EXTRACT] No prompt found for agent '{agent}', returning empty")
            return {"extracted_data": {}, "confidence": 0.0}

        prompt = prompt_template.replace("{text}", text[:64000] if text else "")
        print(f"[EXTRACT] Prompt loaded ({len(prompt_template)} chars), sending to LLM...")

        try:
            t0 = __import__("time").time()
            result = groq_service._parse_json(groq_service.chat(
                [{"role": "user", "content": prompt}], temperature=0.05, max_tokens=4096
            ), {})
            duration = __import__("time").time() - t0
            field_confidence = result.pop("_field_confidence", {}) if isinstance(result, dict) else {}
            avg_confidence = 0.7
            if field_confidence:
                scores = [v for v in field_confidence.values() if isinstance(v, (int, float))]
                avg_confidence = sum(scores) / len(scores) if scores else 0.7
            fields = list(result.keys()) if isinstance(result, dict) else []
            print(f"[EXTRACT] Result: agent={agent}, fields={fields[:8]}, conf={avg_confidence:.2f}, time={duration:.1f}s")
            return {
                "extracted_data": result if isinstance(result, dict) else {},
                "confidence": avg_confidence,
                "field_confidence": field_confidence,
                "agent_type": agent,
            }
        except Exception as e:
            print(f"[EXTRACT] FAILED: {e}")
            import traceback as tb
            tb.print_exc()
            logger.error(f"Category extraction agent ({document_type}) error: {e}")
            return {
                "extracted_data": {},
                "confidence": 0.0,
                "field_confidence": {},
                "agent_type": agent,
            }


classification_agent = ClassificationAgent()
category_agents = CategoryExtractionAgent()
