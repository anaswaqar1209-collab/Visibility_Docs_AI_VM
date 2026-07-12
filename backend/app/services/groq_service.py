import os
import json
import re
from groq import Groq
from ..config import settings


class GroqService:
    def __init__(self):
        api_key = settings.GROQ_API_KEY or os.getenv("GROQ_API_KEY", "")
        self.client = Groq(api_key=api_key) if api_key and api_key != "gsk_your_groq_api_key" else None
        self.model = "llama-3.3-70b-versatile"
        self.vision_models = [
            "meta-llama/llama-4-scout-17b-16e-instruct",
            "qwen/qwen3.6-27b",
            "llama-3.2-90b-vision-preview",
        ]
        self._vision_model_idx = 0
        self.available = self.client is not None
        self.vision_available = True

    def chat(self, messages: list[dict], temperature: float = 0.1, max_tokens: int = 4096) -> str:
        if not self.available:
            return self._fallback_response(messages)
        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content

    def chat_vision(self, messages: list[dict], temperature: float = 0.1, max_tokens: int = 4096) -> str:
        if not self.available or not self.vision_available:
            return self._fallback_response(messages)

        errors = []
        for i in range(self._vision_model_idx, len(self.vision_models)):
            model = self.vision_models[i]
            try:
                response = self.client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                self._vision_model_idx = i
                return response.choices[0].message.content
            except Exception as e:
                err = str(e).lower()
                errors.append(f"{model}: {e}")
                if "does not support image" in err or "cannot read" in err:
                    continue
                raise

        self.vision_available = False
        return self._fallback_response(messages)

    def _fallback_response(self, messages: list[dict]) -> str:
        last = messages[-1]["content"] if messages else ""
        if isinstance(last, list):
            texts = [c["text"] for c in last if isinstance(c, dict) and c.get("type") == "text"]
            last = " ".join(texts)
        return f"[Groq API not configured. Please set GROQ_API_KEY in .env]\n\nReceived: {str(last)[:200]}"

    def summarize_document(self, text: str, max_length: int = 500) -> str:
        prompt = f"Summarize this document concisely (max {max_length} words):\n\n{text[:4000]}"
        return self.chat([{"role": "user", "content": prompt}], temperature=0.1, max_tokens=1024)

    def answer_question(self, question: str, context: str, chat_history: list[dict] = None) -> str:
        if not self.available:
            return "Groq API is not configured. Please set GROQ_API_KEY in your .env file."

        messages = [{"role": "system", "content": "You are a document analysis assistant. Answer questions based ONLY on the provided document context. If the answer is not in the context, say 'I cannot find this information in the document.'"}]

        if chat_history:
            for msg in chat_history[-5:]:
                messages.append(msg)

        messages.append({
            "role": "user",
            "content": f"Document Context:\n{context}\n\nQuestion: {question}"
        })

        return self.chat(messages, temperature=0.1, max_tokens=2048)

    def _parse_json(self, text: str, default: dict) -> dict:
        try:
            json_match = re.search(r'\{.*\}', text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
            return default
        except (json.JSONDecodeError, Exception):
            return default


groq_service = GroqService()
