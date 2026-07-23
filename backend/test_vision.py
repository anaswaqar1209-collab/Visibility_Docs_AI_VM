import sys
import os
import base64
from PIL import Image
import io
from dotenv import load_dotenv

sys.path.append(os.path.dirname(__file__))

load_dotenv()

from app.services.groq_service import groq_service

img = Image.new('RGB', (100, 30), color = (255, 255, 255))
import PIL.ImageDraw as ImageDraw
d = ImageDraw.Draw(img)
d.text((10,10), "Hello World", fill=(0,0,0))
buf = io.BytesIO()
img.save(buf, format="JPEG")
b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

print("Testing Vision OCR directly via groq_service...")
content = [{"type": "text", "text": "Extract text"}, {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}]
try:
    res = groq_service.chat_vision([{"role": "user", "content": content}])
    print("Result:", repr(res))
except Exception as e:
    print("Error:", e)
