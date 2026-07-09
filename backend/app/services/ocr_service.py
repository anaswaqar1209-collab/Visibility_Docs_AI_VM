import os
import base64
import io
import tempfile
import logging
import fitz
from PIL import Image
from ..config import settings

logger = logging.getLogger("visibility-docs")


class OCRService:
    _BATCH_SIZE = 5
    _MAX_WIDTH = 768
    _JPEG_QUALITY = 80

    def pdf_to_images(self, pdf_path: str, max_width: int = None, quality: int = None) -> list[dict]:
        doc = fitz.open(pdf_path)
        tmp_dir = tempfile.mkdtemp(prefix="ocr_")
        max_width = max_width or self._MAX_WIDTH
        quality = quality or self._JPEG_QUALITY
        pages = []
        for i, page in enumerate(doc):
            page_pix = page.get_pixmap(dpi=150)
            img = Image.frombytes("RGB", [page_pix.width, page_pix.height], page_pix.samples)
            w_percent = max_width / float(img.width)
            h_size = int(float(img.height) * float(w_percent))
            img = img.resize((max_width, h_size), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality, optimize=True)
            buf.seek(0)
            b64 = base64.b64encode(buf.read()).decode("utf-8")
            out = os.path.join(tmp_dir, f"page_{i+1:04d}.jpg")
            img.save(out, format="JPEG", quality=quality, optimize=True)
            pages.append({"path": out, "b64": b64, "page_num": i + 1, "size": len(b64)})
        doc.close()
        return pages

    def _extract_pymupdf_text(self, file_path: str) -> tuple[str, int]:
        try:
            doc = fitz.open(file_path)
            page_count = doc.page_count
            text = ""
            for page in doc:
                text += page.get_text()
            doc.close()
            return text, page_count
        except Exception:
            return "", 0

    def _is_text_sufficient(self, text: str, page_count: int) -> bool:
        if page_count == 0:
            return False
        return len(text.strip()) / page_count > 50

    def _vision_ocr(self, pages: list[dict]) -> str:
        from .groq_service import groq_service

        if not groq_service.available or not groq_service.vision_available:
            logger.warning("Groq vision not available, falling back to direct text")
            return ""

        texts = []
        for i in range(0, len(pages), self._BATCH_SIZE):
            batch = pages[i:i + self._BATCH_SIZE]
            content = [{"type": "text", "text": "You are an OCR engine. This is a document page image — treat it as a TEXT PAGE, not a photograph. Extract EVERY character, word, and number exactly as it appears. Preserve paragraphs, line breaks, and formatting. Output ONLY the extracted text with no commentary, no descriptions, no formatting markers. Prefix each page with '--- Page X ---'."}]
            for p in batch:
                content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{p['b64']}"}})
            try:
                result = groq_service.chat_vision(
                    [{"role": "user", "content": content}],
                    temperature=0.0,
                    max_tokens=4096,
                )
                if result and not result.startswith("[Groq"):
                    texts.append(result)
                else:
                    texts.append("")
            except Exception as e:
                logger.warning(f"Vision OCR batch {i//self._BATCH_SIZE + 1} failed: {e}")
                texts.append("")

        return "\n\n".join(texts)

    def process_document(self, file_path: str) -> dict:
        ext = os.path.splitext(file_path)[1].lower()
        logger.info(f"[OCR] Processing: {file_path}")

        if ext == ".pdf":
            direct_text, page_count = self._extract_pymupdf_text(file_path)
            logger.info(f"[OCR] PyMuPDF: {len(direct_text)} chars, {page_count} pages")
            if self._is_text_sufficient(direct_text, page_count):
                logger.info(f"[OCR] Direct text sufficient ({len(direct_text.strip())//max(page_count,1)} chars/page)")
                return {"text": direct_text, "page_count": page_count, "source": "direct"}
            logger.info(f"[OCR] Direct text insufficient, using vision OCR")

        pages = self.pdf_to_images(file_path)
        logger.info(f"[OCR] Converted to {len(pages)} JPEG images (768px, {self._JPEG_QUALITY}% quality)")

        t0 = __import__("time").time()
        text = self._vision_ocr(pages)
        duration = __import__("time").time() - t0
        logger.info(f"[OCR] Vision done: {len(text)} chars in {duration:.1f}s ({len(pages)} pages)")

        if not text.strip():
            logger.warning("[OCR] Vision returned empty, trying direct text fallback")
            direct_text, page_count = self._extract_pymupdf_text(file_path)
            if direct_text.strip():
                return {"text": direct_text, "page_count": page_count, "source": "direct_fallback"}
            text = "[OCR failed]"

        return {"text": text, "page_count": len(pages), "source": "vision"}


ocr_service = OCRService()
