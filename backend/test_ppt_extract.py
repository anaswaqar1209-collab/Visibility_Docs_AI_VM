"""Test extracting text from legacy .ppt file using olefile."""
import olefile
import struct
import re

def extract_ppt_text(file_path: str) -> str:
    """Extract text from legacy .ppt binary format using OLE parsing."""
    try:
        ole = olefile.OleFileIO(file_path)
    except Exception as e:
        return f"[Cannot open as OLE file: {e}]"
    
    text_parts = []
    
    # Method 1: Read PowerPoint Document stream
    if ole.exists('PowerPoint Document'):
        try:
            data = ole.openstream('PowerPoint Document').read()
            # PowerPoint binary records: look for text records
            # Record types for text:
            # 0x0FA0 = TextCharsAtom (Unicode)
            # 0x0FA8 = TextBytesAtom (ASCII)
            # 0x0FBA = CString (Unicode string)
            
            pos = 0
            while pos < len(data) - 8:
                rec_ver_inst = struct.unpack_from('<H', data, pos)[0]
                rec_type = struct.unpack_from('<H', data, pos + 2)[0]
                rec_len = struct.unpack_from('<I', data, pos + 4)[0]
                
                if rec_len > len(data) - pos - 8:
                    break
                    
                if rec_type == 0x0FA8:  # TextBytesAtom (ASCII/Latin1)
                    try:
                        text = data[pos + 8: pos + 8 + rec_len].decode('latin-1', errors='ignore')
                        text = text.strip()
                        if text and len(text) > 1:
                            text_parts.append(text)
                    except Exception:
                        pass
                        
                elif rec_type == 0x0FA0:  # TextCharsAtom (UTF-16LE)
                    try:
                        text = data[pos + 8: pos + 8 + rec_len].decode('utf-16-le', errors='ignore')
                        text = text.strip()
                        if text and len(text) > 1:
                            text_parts.append(text)
                    except Exception:
                        pass
                
                pos += 8 + rec_len
                
        except Exception as e:
            text_parts.append(f"[Error reading PowerPoint Document stream: {e}]")
    
    # Method 2: Also check for Current User stream info
    if ole.exists('Current User'):
        try:
            pass  # Just checking it exists
        except Exception:
            pass
    
    ole.close()
    
    if not text_parts:
        return "[No text found in legacy PPT file]"
    
    # Clean and deduplicate
    seen = set()
    cleaned = []
    for t in text_parts:
        # Clean control characters
        t = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', t)
        t = t.strip()
        if t and t not in seen and len(t) > 1:
            seen.add(t)
            cleaned.append(t)
    
    return "\n\n".join(cleaned)


if __name__ == "__main__":
    import sys
    import glob
    
    # Find all .ppt files in temp dir
    ppt_files = glob.glob("/var/folders/25/r068fplj6f57gd9mvz22q48h0000gn/T/*.ppt")
    
    if not ppt_files:
        print("No .ppt files found")
        sys.exit(1)
    
    for f in ppt_files[:1]:
        print(f"=== Extracting from: {f} ===")
        text = extract_ppt_text(f)
        print(f"Length: {len(text)} chars")
        print(text[:3000])
        print("...")
