import sys
import os

# add backend to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__))))

from app.services.embedding_service import embedding_service

def test():
    print("Loading model...")
    embedding_service.load()
    print(f"Model dimension: {embedding_service.dimension}")
    assert embedding_service.dimension == 768, f"Expected dimension 768, got {embedding_service.dimension}"
    
    print("Embedding text...")
    vector = embedding_service.embed_text("This is a test document.")
    print(f"Vector length: {len(vector)}")
    assert len(vector) == 768, f"Expected vector length 768, got {len(vector)}"
    print("Test passed!")

if __name__ == "__main__":
    test()
