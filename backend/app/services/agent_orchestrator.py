import os
import json
import logging
from .orchestration_logger import get_logger, C

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
    "resume": "hr_agent",
    "transcript": "hr_agent",
    "other": "other_agent",
}

VALID_PHASE3_AGENTS = set(PHASE3_AGENT_PROMPT_MAP.keys())

HEURISTIC_RULES = [
    (
        "finance_agent",
        "invoice",
        [
            "invoice", "subtotal", "tax", "total", "amount due", "due date",
            "invoice #", "inv-", "tax invoice", "bill to", "ship to",
            "payment terms", "net 30", "unit price", "quantity", "line items",
            "gst", "grand total",
        ],
    ),
    (
        "finance_agent",
        "financial_statement",
        [
            "balance sheet", "income statement", "profit & loss", "p&l",
            "cash flow", "assets", "liabilities", "equity", "revenue",
            "expenses", "net profit", "gross margin", "operating income",
            "financial summary", "financial statement",
        ],
    ),
    (
        "procurement_agent",
        "purchase_order",
        [
            "purchase order", "po number", "po-", "order date", "supplier",
            "vendor", "delivery date", "ship to", "requisition",
            "payment terms", "net 30", "order quantity", "buyer",
        ],
    ),
    (
        "procurement_agent",
        "quotation",
        [
            "quotation", "quote", "quotation #", "price list", "valid until",
            "offer", "estimate", "proposal", "unit price",
        ],
    ),
    (
        "hr_agent",
        "hr_document",
        [
            "employee", "salary", "appraisal", "leave application",
            "offer letter", "hr policy", "payroll", "designation",
            "department", "training", "manager", "employee id",
            "performance review", "appointment letter",
        ],
    ),
    (
        "legal_agent",
        "contract",
        [
            "contract", "agreement", "party a", "party b", "nda",
            "governing law", "jurisdiction", "clause", "termination",
            "renewal", "signature", "whereas", "in witness whereof",
            "indemnity", "confidentiality", "lease agreement",
            "service agreement", "binding", "executed",
        ],
    ),
    (
        "hr_agent",
        "resume",
        [
            "resume", "cv", "curriculum vitae", "work experience",
            "education", "skills", "professional summary",
            "employment history", "qualifications", "achievements",
            "certifications", "objective",
        ],
    ),
    (
        "compliance_agent",
        "audit_report",
        [
            "audit report", "audit findings", "observations",
            "non-conformance", "corrective action", "finding",
            "critical", "major", "minor", "recommendations",
            "auditor", "scope", "compliance status",
        ],
    ),
    (
        "compliance_agent",
        "quality_report",
        [
            "quality report", "quality control", "qc", "quality assurance",
            "qa", "inspection report", "defect", "pass rate", "fail rate",
            "specification", "tolerance", "quality metrics",
        ],
    ),
    (
        "compliance_agent",
        "certificate",
        [
            "certificate", "certification", "certificate of",
            "this certifies", "cert no", "certificate of analysis",
            "certificate of origin", "certificate of compliance",
            "iso certificate", "certifying body",
        ],
    ),
    (
        "compliance_agent",
        "maintenance_report",
        [
            "maintenance", "service report", "repair", "equipment",
            "downtime", "technician", "work order", "breakdown",
            "fault", "servicing", "preventive maintenance",
        ],
    ),
    (
        "compliance_agent",
        "sop",
        [
            "standard operating procedure", "sop", "procedure",
            "steps", "instructions", "protocol", "step-by-step",
            "operating procedure", "process guide",
        ],
    ),
    (
        "compliance_agent",
        "engineering_drawing",
        [
            "drawing", "dwg", "schematic", "dimension", "tolerance",
            "scale", "revision", "title block", "part no",
            "drawn by", "checked by", "blueprint", "datum",
        ],
    ),
    (
        "hr_agent",
        "transcript",
        [
            "transcript", "grade", "gpa", "semester", "course",
            "credit hours", "cgpa", "academic record", "marksheet",
            "marks sheet", "result card", "examination", "credits earned",
            "grade point", "student name", "roll number", "registration no",
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
                "agent_type": "other_agent",
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

        log = get_logger()
        log.info(f"Text: {len(text)} chars")
        prompt_template = _load_prompt("classification_agent.md")
        if not prompt_template:
            log.warn("No prompt template found, using heuristic fallback")
            return self._heuristic_classify(text, filename)

        prompt = prompt_template.replace("{text}", text[:64000]).replace("{filename}", filename)
        try:
            t0 = __import__("time").time()
            log.info("Calling Groq API (llama-8b)...")
            result = groq_service._parse_json(
                groq_service.chat([{"role": "user", "content": prompt}], temperature=0.05, max_tokens=2048),
                {},
            )
            duration = __import__("time").time() - t0
            if not result:
                log.warn(f"LLM returned empty ({duration:.1f}s), falling back to heuristic")
                return self._heuristic_classify(text, filename)
            doc_type = str(result.get("document_type", "other")).lower().replace(" ", "_")
            agent_type = str(result.get("phase3_agent", "")).lower().replace(" ", "_")

            from ..models.schemas import DocumentType
            valid_types = {t.value for t in DocumentType}
            if doc_type not in valid_types:
                log.warn(f"Invalid doc_type '{doc_type}' from LLM, falling back to 'other'")
                doc_type = "other"

            if agent_type not in VALID_PHASE3_AGENTS:
                old_agent = agent_type
                agent_type = DOCUMENT_TO_PHASE3_AGENT.get(doc_type, "other_agent")
                log.warn(f"Invalid agent '{old_agent}' from LLM → mapped to '{agent_type}' for '{doc_type}'")

            result_data = {
                "document_type": doc_type,
                "agent_type": agent_type,
                "confidence": float(result.get("confidence", 0)),
                "reasoning": result.get("reasoning", ""),
                "language": result.get("language", "en"),
                "estimated_quality": result.get("estimated_quality", "medium"),
            }
            log.result("Result", f"type={doc_type}, agent={agent_type}, conf={result_data['confidence']:.2f}, time={duration:.1f}s", C.GREEN)
            return result_data
        except Exception as e:
            log.warn(f"LLM error: {e}, falling back to heuristic")
            logger.warning(f"Classification agent fallback used: {e}")
            fallback = self._heuristic_classify(text, filename)
            fallback["reasoning"] = f"{fallback['reasoning']}; LLM fallback reason: {e}"
            return fallback


class CategoryExtractionAgent:
    def extract(self, text: str, document_type: str, agent_type: str = "") -> dict:
        from .groq_service import groq_service

        agent = agent_type or DOCUMENT_TO_PHASE3_AGENT.get(document_type, "other_agent")
        log = get_logger()
        log.info(f"DocType: {document_type} | Text: {len(text)} chars")
        prompt_template = _load_phase3_prompt(f"{agent}.md")
        if not prompt_template:
            log.warn(f"No prompt found for agent '{agent}', returning empty")
            return {"extracted_data": {}, "confidence": 0.0}

        prompt = prompt_template.replace("{text}", text[:64000] if text else "")
        log.info(f"Prompt loaded ({len(prompt_template)} chars), calling Groq API...")

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
            log.result("Fields", f"{fields[:8]}", C.GREEN)
            log.result("Confidence", f"{avg_confidence:.2f}", C.GREEN)
            log.result("Duration", f"{duration:.1f}s", C.DIM)
            return {
                "extracted_data": result if isinstance(result, dict) else {},
                "confidence": avg_confidence,
                "field_confidence": field_confidence,
                "agent_type": agent,
            }
        except Exception as e:
            log.fail(f"Extraction failed: {e}")
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
