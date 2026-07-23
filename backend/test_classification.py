import sys
import os
import json
from dotenv import load_dotenv

sys.path.append(os.path.dirname(__file__))

load_dotenv()

from app.services.agent_orchestrator import classification_agent

test_cases = [
    {
        "filename": "john_doe_resume.pdf",
        "text": "John Doe\nSoftware Engineer\nEmail: john.doe@example.com\n\nExperience:\n- Backend Developer at Tech Corp (2020-2023)\n  - Built APIs in Python and Go.\n\nEducation:\n- B.S. Computer Science, University of X (2016-2020)\n\nSkills: Python, Go, SQL, AWS",
        "expected": "resume"
    },
    {
        "filename": "invoice_9921.pdf",
        "text": "ACME Corp\n123 Main St.\n\nTAX INVOICE\nInvoice #: INV-9921\nDate: Oct 1, 2023\nBill To: Client Inc.\n\nDescription | Qty | Price | Total\nConsulting | 10 | 150 | 1500\n\nSubtotal: 1500\nTax (10%): 150\nTotal Due: 1650\n\nPlease pay within 30 days.",
        "expected": "invoice"
    },
    {
        "filename": "Q3_AllHands.ppt",
        "text": "Q3 Company All-Hands\nWelcome everyone!\n\nAgenda:\n1. Q3 Financial Results\n2. Product Roadmap Update\n3. Employee Awards\n\nNext Slide:\nOur revenue grew by 15% this quarter.",
        "expected": "presentation"
    },
    {
        "filename": "employee_handbook_v2.pdf",
        "text": "Employee Handbook - Company Policies\n\nSection 1: Paid Time Off (PTO)\nAll full-time employees are entitled to 20 days of PTO per year.\n\nSection 2: Code of Conduct\nEmployees must maintain a professional environment...",
        "expected": "hr_document"
    },
    {
        "filename": "vendor_SLA.docx",
        "text": "Service Level Agreement (SLA)\nBetween BuyCorp and SupplyInc.\n\n1. Delivery Time\nSupplyInc agrees to deliver all components within 48 hours of purchase order receipt.\n\n2. Penalties\nLate deliveries will incur a 5% fee.",
        "expected": "supplier_agreement"
    }
]

print("Running Classification Tests...\n")
correct = 0

for i, case in enumerate(test_cases, 1):
    print(f"Test {i}: {case['filename']}")
    try:
        result = classification_agent.classify(case["text"], case["filename"])
        pred_type = result.get("document_type")
        pred_agent = result.get("agent_type")
        confidence = result.get("confidence", 0)
        reasoning = result.get("reasoning", "")
        
        is_match = pred_type == case["expected"]
        if is_match:
            correct += 1
            
        print(f"  Predicted Type : {pred_type} (Expected: {case['expected']})")
        print(f"  Predicted Agent: {pred_agent}")
        print(f"  Confidence     : {confidence}")
        print(f"  Reasoning      : {reasoning}")
        print(f"  Match          : {'✅ YES' if is_match else '❌ NO'}\n")
    except Exception as e:
        print(f"  Error: {e}\n")

accuracy = (correct / len(test_cases)) * 100
print(f"Overall Accuracy: {accuracy}% ({correct}/{len(test_cases)})")
