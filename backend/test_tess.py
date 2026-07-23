import sys, os, base64, io
from PIL import Image
import PIL.ImageDraw as ImageDraw

sys.path.append(os.path.dirname(__file__))

from app.services.ocr_service import _tesseract_ocr_b64

img = Image.new('RGB', (200, 50), color = (255, 255, 255))
d = ImageDraw.Draw(img)
d.text((10,10), "Test CV Document", fill=(0,0,0))
buf = io.BytesIO()
img.save(buf, format="JPEG")
b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

print("Testing Tesseract...")
print(repr(_tesseract_ocr_b64(b64)))
