import aspose.slides as slides
try:
    pres = slides.Presentation()
    slide = pres.slides[0]
    slide.shapes.add_auto_shape(slides.ShapeType.RECTANGLE, 50, 50, 100, 100)
    pres.save("test_aspose.pptx", slides.export.SaveFormat.PPTX)
    print("Created PPTX successfully.")
    
    print("Attempting to convert to PDF...")
    pres.save("test_aspose.pdf", slides.export.SaveFormat.PDF)
    print("Converted PPTX to PDF successfully.")
except Exception as e:
    print("Exception:", str(e))
