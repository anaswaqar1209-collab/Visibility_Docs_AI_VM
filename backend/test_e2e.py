import sys
import os
import asyncio

sys.path.insert(0, os.path.abspath('.'))

from app.services.workflow_service import workflow_service
from app.services.pinecone_service import pinecone_service

async def run_test():
    print("--- STARTING E2E TEST ---")
    
    # 1. Create a dummy test file
    test_file_path = "test_invoice.txt"
    with open(test_file_path, "w") as f:
        f.write("INVOICE\n\nInvoice Number: INV-9999\nVendor: Apple Inc.\nTotal: $1,200.00\nDate: 2026-07-22\n\nItems:\n1x Macbook Pro - $1200.00")
        
    print(f"Created dummy file: {test_file_path}")
    
    # 2. Run the workflow service
    from app.services.ocr_service import process_document
    from app.services.agent_orchestrator import orchestrator
    from app.services.rag_service import rag_service
    
    print("\n1. Running OCR...")
    text = process_document(test_file_path)
    print(f"OCR Output length: {len(text)}")
    
    print("\n2. Running Orchestrator (Classification + Extraction)...")
    result = await orchestrator.process(text, test_file_path)
    print(f"Classification: {result.classification.document_type} (Agent: {result.classification.agent_type})")
    print(f"Extraction Keys: {list(result.extracted_data.keys())}")
    
    print("\n3. Testing Embedding & Pinecone Upsert...")
    try:
        rag_service.index_document("test_doc_123", text, "org_test", result.classification.document_type, result.classification.agent_type)
        print("Pinecone chunking and upsert SUCCEEDED!")
    except Exception as e:
        print(f"Pinecone Upsert FAILED: {e}")
        
    os.remove(test_file_path)
    print("\n--- E2E TEST COMPLETE ---")

if __name__ == "__main__":
    asyncio.run(run_test())
