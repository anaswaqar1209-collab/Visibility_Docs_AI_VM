import re
import hashlib

def _is_atomic_start(stripped):
    if stripped.startswith("```"): return "code_block"
    if stripped.startswith(">"): return "admonition"
    return None

def _parse_atomic_blocks(text: str) -> list[dict]:
    lines = text.split('\n')
    blocks = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        atype = _is_atomic_start(stripped)

        if atype == "code_block":
            block_lines = [line]
            i += 1
            while i < len(lines):
                block_lines.append(lines[i])
                if lines[i].strip().startswith("```"):
                    break
                i += 1
            blocks.append({"type": "code", "content": "\n".join(block_lines), "words": len(" ".join(block_lines).split())})
            i += 1

        elif stripped.startswith("|") and stripped.endswith("|"):
            table_lines = [line]
            i += 1
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i])
                i += 1
            blocks.append({"type": "table", "content": "\n".join(table_lines), "words": len(" ".join(table_lines).split())})

        elif not stripped:
            i += 1
            continue

        elif atype == "admonition":
            admon_lines = [line]
            i += 1
            while i < len(lines) and lines[i].strip() and not _is_atomic_start(lines[i].strip()):
                admon_lines.append(lines[i])
                i += 1
            blocks.append({"type": "admonition", "content": "\n".join(admon_lines), "words": len(" ".join(admon_lines).split())})

        elif re.match(r'^\d+[.)]\s', stripped):
            list_lines = [line]
            i += 1
            while i < len(lines) and re.match(r'^\d+[.)]\s', lines[i].strip()):
                list_lines.append(lines[i])
                i += 1
            blocks.append({"type": "numbered_list", "content": "\n".join(list_lines), "words": len(" ".join(list_lines).split())})

        elif re.match(r'^[-*]\s', stripped):
            list_lines = [line]
            i += 1
            while i < len(lines) and re.match(r'^[-*]\s', lines[i].strip()):
                list_lines.append(lines[i])
                i += 1
            blocks.append({"type": "bullet_list", "content": "\n".join(list_lines), "words": len(" ".join(list_lines).split())})

        elif stripped.startswith("---"):
            i += 1
            continue

        elif stripped.startswith("<!--"):
            i += 1
            continue

        else:
            para_lines = [line]
            i += 1
            while i < len(lines) and lines[i].strip() and not _is_atomic_start(lines[i].strip()):
                stripped_next = lines[i].strip()
                if re.match(r'^\d+[.)]\s', stripped_next) or re.match(r'^[-*]\s', stripped_next):
                    break
                para_lines.append(lines[i])
                i += 1
            text_content = "\n".join(para_lines)
            blocks.append({"type": "paragraph", "content": text_content, "words": len(text_content.split())})

    return blocks


def chunk_text(text: str, max_words: int = 250) -> list[dict]:
    if not text:
        return []

    blocks = _parse_atomic_blocks(text)
    if not blocks:
        return []

    def recursive_split(content: str, separators: list[str], max_w: int) -> list[str]:
        if len(content.split()) <= max_w:
            return [content]
        if not separators:
            words = content.split()
            return [" ".join(words[i:i+max_w]) for i in range(0, len(words), max_w)]

        sep = separators[0]
        if sep == ".":
            splits = [s.strip() for s in re.split(r'(?<=\.)\s+', content) if s.strip()]
        else:
            splits = [s for s in content.split(sep) if s]

        good_splits = []
        for s in splits:
            if len(s.split()) <= max_w:
                good_splits.append(s)
            else:
                good_splits.extend(recursive_split(s, separators[1:], max_w))

        merged = []
        current = []
        current_len = 0
        join_str = " " if sep == "." else sep
        for s in good_splits:
            slen = len(s.split())
            if current_len + slen > max_w and current:
                merged.append(join_str.join(current))
                current = [s]
                current_len = slen
            else:
                current.append(s)
                current_len += slen
        if current:
            merged.append(join_str.join(current))
        return merged

    chunks = []
    chunk_id = 0
    current_chunk_texts = []
    current_words = 0

    for block in blocks:
        b_words = block["words"]
        b_type = block["type"]
        b_content = block["content"]

        if b_type == "table":
            if current_words + b_words > max_words and current_chunk_texts:
                ct = "\n\n".join(current_chunk_texts)
                chunks.append({
                    "content": ct,
                    "chunk_id": hashlib.md5(ct.encode()).hexdigest(),
                    "chunk_index": chunk_id,
                    "word_count": current_words,
                })
                chunk_id += 1
                current_chunk_texts = []
                current_words = 0

            if b_words > max_words and not current_chunk_texts:
                chunks.append({
                    "content": b_content,
                    "chunk_id": hashlib.md5(b_content.encode()).hexdigest(),
                    "chunk_index": chunk_id,
                    "word_count": b_words,
                })
                chunk_id += 1
            else:
                current_chunk_texts.append(b_content)
                current_words += b_words
        else:
            if current_words + b_words > max_words:
                if current_chunk_texts:
                    ct = "\n\n".join(current_chunk_texts)
                    chunks.append({
                        "content": ct,
                        "chunk_id": hashlib.md5(ct.encode()).hexdigest(),
                        "chunk_index": chunk_id,
                        "word_count": current_words,
                    })
                    chunk_id += 1
                    current_chunk_texts = []
                    current_words = 0

                if b_words > max_words:
                    splits = recursive_split(b_content, ["\n\n", "\n", ".", " "], max_words)
                    for s in splits:
                        slen = len(s.split())
                        if current_words + slen > max_words and current_chunk_texts:
                            ct = "\n\n".join(current_chunk_texts)
                            chunks.append({
                                "content": ct,
                                "chunk_id": hashlib.md5(ct.encode()).hexdigest(),
                                "chunk_index": chunk_id,
                                "word_count": current_words,
                            })
                            chunk_id += 1
                            current_chunk_texts = [s]
                            current_words = slen
                        else:
                            current_chunk_texts.append(s)
                            current_words += slen
                else:
                    current_chunk_texts.append(b_content)
                    current_words += b_words
            else:
                current_chunk_texts.append(b_content)
                current_words += b_words

    if current_chunk_texts:
        ct = "\n\n".join(current_chunk_texts)
        chunks.append({
            "content": ct,
            "chunk_id": hashlib.md5(ct.encode()).hexdigest(),
            "chunk_index": chunk_id,
            "word_count": current_words,
        })

    return chunks

if __name__ == "__main__":
    text = """This is a paragraph.
It has two lines.

| Header | Header 2 |
|---|---|
| Row 1 | Row 1 |
| Row 2 | Row 2 |

""" + "This is a really long sentence that should eventually get split up because it is so so so long. " * 30
    
    chunks = chunk_text(text, max_words=20)
    for c in chunks:
        print(f"CHUNK {c['chunk_index']} (words: {c['word_count']}):\n{c['content'][:100]}\n")
