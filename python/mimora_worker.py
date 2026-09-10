from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import sqlite3
import sys
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree


SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".md", ".txt"}
SUPPORTED_SCHEDULE_EXTENSIONS = {".xlsx", ".xlsm"}
RAG_ID_PREFIX = "RAG"
DEFAULT_EMBEDDING_PROVIDER = "local"
DEFAULT_LOCAL_EMBEDDING_MODEL = "bge-m3"
DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_MODEL = DEFAULT_LOCAL_EMBEDDING_MODEL
DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434"
DEFAULT_SIMILARITY_THRESHOLD = 0.22
DEFAULT_WORKSPACE_SCORE_BONUS = 0.03
DEFAULT_MAX_CHUNKS_PER_DOCUMENT = 2
DEFAULT_SEARCH_CANDIDATE_COUNT = 50
DEFAULT_RRF_K = 60
DEFAULT_DENSE_RRF_WEIGHT = 1.0
DEFAULT_LEXICAL_RRF_WEIGHT = 1.25
DEFAULT_DENSE_ONLY_THRESHOLD = 0.55
TARGET_CHUNK_CHARS = 3600
CHUNK_OVERLAP_CHARS = 500
SCHEMA = """
CREATE TABLE IF NOT EXISTS rag_documents (
  rag_document_id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  managed_file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_hash TEXT NOT NULL,
  security TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  indexed_at TEXT,
  embedding_provider TEXT,
  embedding_model TEXT,
  embedding_dimension INTEGER,
  chunk_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_documents_file_hash
ON rag_documents(file_hash);
CREATE TABLE IF NOT EXISTS rag_document_workspaces (
  rag_document_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  PRIMARY KEY (rag_document_id, workspace_id),
  FOREIGN KEY (rag_document_id)
    REFERENCES rag_documents(rag_document_id)
    ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS rag_chunks (
  chunk_id TEXT PRIMARY KEY,
  rag_document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  heading TEXT,
  page INTEGER,
  section_index INTEGER,
  faiss_vector_id INTEGER NOT NULL UNIQUE,
  FOREIGN KEY (rag_document_id)
    REFERENCES rag_documents(rag_document_id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_document_id
ON rag_chunks(rag_document_id);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_faiss_vector_id
ON rag_chunks(faiss_vector_id);
CREATE TABLE IF NOT EXISTS rag_index_profile (
  index_name TEXT PRIMARY KEY,
  embedding_provider TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dimension INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
"""


class WorkerError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ExtractedSection:
    section_index: int
    heading: str | None
    page: int | None
    text: str


@dataclass(frozen=True)
class RagChunk:
    chunk_id: str
    rag_document_id: str
    chunk_index: int
    text: str
    heading: str | None
    page: int | None
    section_index: int | None
    faiss_vector_id: int


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_input() -> dict[str, Any]:
    raw_input = sys.stdin.buffer.read().decode("utf-8").strip()
    if not raw_input:
        return {}

    try:
        value = json.loads(raw_input)
    except json.JSONDecodeError as error:
        raise WorkerError("invalid_json", f"Invalid JSON input: {error}") from error

    if not isinstance(value, dict):
        raise WorkerError("invalid_input", "Worker input must be a JSON object.")

    return value


def write_success(data: Any) -> None:
    payload = json.dumps({"ok": True, "data": data}, ensure_ascii=False)
    sys.stdout.buffer.write(payload.encode("utf-8"))


def write_error(error: WorkerError) -> None:
    payload = json.dumps(
        {
            "ok": False,
            "error": {"code": error.code, "message": error.message},
        },
        ensure_ascii=False,
    )
    sys.stdout.buffer.write(payload.encode("utf-8"))


def get_storage_root(input_data: dict[str, Any]) -> Path:
    storage_root = input_data.get("storage_root")
    if not isinstance(storage_root, str) or not storage_root.strip():
        raise WorkerError("invalid_input", "storage_root is required.")
    return Path(storage_root)


def get_database_path(storage_root: Path) -> Path:
    return storage_root / "metadata.sqlite"


def get_index_path(storage_root: Path) -> Path:
    return storage_root / "index" / "internal.faiss"


def get_test_index_path(storage_root: Path) -> Path:
    return storage_root / "index" / "internal-test-vectors.json"


def connect_database(storage_root: Path) -> sqlite3.Connection:
    storage_root.mkdir(parents=True, exist_ok=True)
    (storage_root / "documents").mkdir(parents=True, exist_ok=True)
    (storage_root / "index").mkdir(parents=True, exist_ok=True)
    (storage_root / "temp").mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(get_database_path(storage_root))
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(SCHEMA)
    ensure_schema_migrations(connection)
    ensure_fts_schema(connection)
    connection.commit()
    return connection


def ensure_schema_migrations(connection: sqlite3.Connection) -> None:
    columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(rag_documents)").fetchall()
    }
    if "embedding_dimension" not in columns:
        connection.execute("ALTER TABLE rag_documents ADD COLUMN embedding_dimension INTEGER")


def ensure_fts_schema(connection: sqlite3.Connection) -> None:
    existing_columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(rag_chunks_fts)").fetchall()
    }
    if existing_columns and "original_filename" not in existing_columns:
        connection.execute("DROP TABLE IF EXISTS rag_chunks_fts")

    try:
        connection.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts
            USING fts5(
              chunk_id UNINDEXED,
              rag_document_id UNINDEXED,
              original_filename,
              heading,
              text,
              tokenize='trigram'
            )
            """
        )
    except sqlite3.OperationalError:
        try:
            connection.execute(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts
                USING fts5(
                  chunk_id UNINDEXED,
                  rag_document_id UNINDEXED,
                  original_filename,
                  heading,
                  text
                )
                """
            )
        except sqlite3.OperationalError:
            return
    rebuild_fts_index_if_needed(connection)


def normalize_fts_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[_\-.]+", " ", value)


def rebuild_fts_index_if_needed(connection: sqlite3.Connection) -> None:
    try:
        chunk_count = connection.execute("SELECT COUNT(*) AS count FROM rag_chunks").fetchone()["count"]
        fts_count = connection.execute("SELECT COUNT(*) AS count FROM rag_chunks_fts").fetchone()["count"]
    except sqlite3.OperationalError:
        return

    if int(chunk_count) == int(fts_count):
        return

    connection.execute("DELETE FROM rag_chunks_fts")
    rows = connection.execute(
        """
        SELECT rag_chunks.chunk_id,
               rag_chunks.rag_document_id,
               rag_documents.original_filename,
               rag_chunks.heading,
               rag_chunks.text
        FROM rag_chunks
        INNER JOIN rag_documents
          ON rag_documents.rag_document_id = rag_chunks.rag_document_id
        ORDER BY rag_chunks.faiss_vector_id
        """
    ).fetchall()
    connection.executemany(
        """
        INSERT INTO rag_chunks_fts (
          chunk_id, rag_document_id, original_filename, heading, text
        )
        VALUES (?, ?, ?, ?, ?)
        """,
        [
            (
                row["chunk_id"],
                row["rag_document_id"],
                normalize_fts_text(row["original_filename"]),
                normalize_fts_text(row["heading"]),
                row["text"],
            )
            for row in rows
        ],
    )


def sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_source_path(input_data: dict[str, Any]) -> Path:
    source_path = input_data.get("source_path")
    if not isinstance(source_path, str) or not source_path.strip():
        raise WorkerError("source_file_not_found", "Source file path is required.")

    path_value = Path(source_path)
    if not path_value.is_absolute():
        raise WorkerError("source_file_not_found", "Source file path must be absolute.")
    if not path_value.exists() or not path_value.is_file():
        raise WorkerError("source_file_not_found", "Source file was not found.")
    if path_value.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise WorkerError("unsupported_file_type", f"Unsupported file type: {path_value.suffix.lower()}")
    return path_value


def validate_security(input_data: dict[str, Any]) -> str:
    security = input_data.get("security")
    if security not in {"internal", "sensitive", "personal", "private"}:
        raise WorkerError("invalid_security", "security must be internal, sensitive, personal, or private.")
    return security


def validate_workspace_ids(input_data: dict[str, Any]) -> list[str]:
    workspace_ids = input_data.get("workspace_ids", [])
    if workspace_ids is None:
        return []
    if not isinstance(workspace_ids, list):
        raise WorkerError("invalid_workspace_ids", "workspace_ids must be a list.")

    result: list[str] = []
    seen: set[str] = set()
    for workspace_id in workspace_ids:
        if not isinstance(workspace_id, str):
            raise WorkerError("invalid_workspace_ids", "workspace_ids must contain strings.")
        normalized = workspace_id.strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def sanitize_filename(filename: str) -> str:
    return Path(filename).name.strip() or "document"


def row_to_document(connection: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    workspace_rows = connection.execute(
        """
        SELECT workspace_id
        FROM rag_document_workspaces
        WHERE rag_document_id = ?
        ORDER BY workspace_id
        """,
        (row["rag_document_id"],),
    ).fetchall()
    return {
        "ragDocumentId": row["rag_document_id"],
        "originalFilename": row["original_filename"],
        "managedFilePath": row["managed_file_path"],
        "fileType": row["file_type"],
        "fileSize": row["file_size"],
        "fileHash": row["file_hash"],
        "security": row["security"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "indexedAt": row["indexed_at"],
        "embeddingProvider": row["embedding_provider"],
        "embeddingModel": row["embedding_model"],
        "embeddingDimension": row["embedding_dimension"],
        "chunkCount": row["chunk_count"],
        "workspaceIds": [workspace_row["workspace_id"] for workspace_row in workspace_rows],
    }


def get_document_by_hash(connection: sqlite3.Connection, file_hash: str) -> dict[str, Any] | None:
    row = connection.execute("SELECT * FROM rag_documents WHERE file_hash = ?", (file_hash,)).fetchone()
    return row_to_document(connection, row) if row else None


def get_document_row(connection: sqlite3.Connection, rag_document_id: str) -> sqlite3.Row:
    row = connection.execute(
        "SELECT * FROM rag_documents WHERE rag_document_id = ?",
        (rag_document_id,),
    ).fetchone()
    if not row:
        raise WorkerError("document_not_found", "RAG document was not found.")
    return row


def generate_rag_document_id(connection: sqlite3.Connection) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"{RAG_ID_PREFIX}-{year}-"
    row = connection.execute(
        """
        SELECT rag_document_id
        FROM rag_documents
        WHERE rag_document_id LIKE ?
        ORDER BY rag_document_id DESC
        LIMIT 1
        """,
        (f"{prefix}%",),
    ).fetchone()
    next_number = 1
    if row:
        try:
            next_number = int(str(row["rag_document_id"]).split("-")[-1]) + 1
        except ValueError:
            next_number = 1
    return f"{prefix}{next_number:06d}"


def read_text_with_fallback(path_value: Path) -> str:
    for encoding in ("utf-8", "utf-8-sig", "cp949"):
        try:
            return path_value.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    raise WorkerError("text_decode_failed", "Text file could not be decoded.")


def normalize_text(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", text.replace("\r\n", "\n").replace("\r", "\n")).strip()


def strip_yaml_frontmatter(markdown: str) -> str:
    if not markdown.startswith("---"):
        return markdown
    match = re.match(r"^---[ \t]*\n.*?\n---[ \t]*(?:\n|$)", markdown, flags=re.DOTALL)
    return markdown[match.end():] if match else markdown


def sections_from_heading_text(text: str) -> list[ExtractedSection]:
    sections: list[ExtractedSection] = []
    current_heading: str | None = None
    current_lines: list[str] = []

    def flush() -> None:
        body = normalize_text("\n".join(current_lines))
        if body:
            sections.append(ExtractedSection(len(sections), current_heading, None, body))

    for line in text.splitlines():
        heading_match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if heading_match:
            flush()
            current_heading = heading_match.group(2).strip()
            current_lines = []
            continue
        current_lines.append(line)
    flush()

    if not sections and normalize_text(text):
        sections.append(ExtractedSection(0, None, None, normalize_text(text)))
    return sections


def extract_markdown(path_value: Path) -> dict[str, Any]:
    body = strip_yaml_frontmatter(read_text_with_fallback(path_value))
    return {"sections": [section.__dict__ for section in sections_from_heading_text(body)]}


def extract_text(path_value: Path) -> dict[str, Any]:
    text = normalize_text(read_text_with_fallback(path_value))
    return {"sections": [ExtractedSection(0, None, None, text).__dict__] if text else []}


def extract_pdf(path_value: Path) -> dict[str, Any]:
    try:
        import pymupdf
    except Exception as error:
        raise WorkerError("dependency_missing", "PyMuPDF is required for PDF extraction.") from error

    sections: list[ExtractedSection] = []
    try:
        with pymupdf.open(str(path_value)) as document:
            for page_index in range(document.page_count):
                text = normalize_text(document.load_page(page_index).get_text("text") or "")
                if text:
                    sections.append(ExtractedSection(len(sections), None, page_index + 1, text))
    except Exception as error:
        raise WorkerError("extraction_failed", "PDF text extraction failed.") from error
    return {"sections": [section.__dict__ for section in sections]}


def docx_paragraphs_with_stdlib(path_value: Path) -> list[tuple[str | None, str]]:
    try:
        with zipfile.ZipFile(path_value) as archive:
            xml_text = archive.read("word/document.xml")
    except Exception as error:
        raise WorkerError("extraction_failed", "DOCX text extraction failed.") from error

    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    root = ElementTree.fromstring(xml_text)
    paragraphs: list[tuple[str | None, str]] = []
    for paragraph in root.findall(".//w:p", namespace):
        style_node = paragraph.find("./w:pPr/w:pStyle", namespace)
        style = style_node.attrib.get(f"{{{namespace['w']}}}val") if style_node is not None else None
        text = "".join(node.text or "" for node in paragraph.findall(".//w:t", namespace)).strip()
        if text:
            paragraphs.append((style, text))
    return paragraphs


def extract_docx(path_value: Path) -> dict[str, Any]:
    try:
        from docx import Document
    except Exception:
        paragraphs = docx_paragraphs_with_stdlib(path_value)
    else:
        document = Document(str(path_value))
        paragraphs = [
            (paragraph.style.name if paragraph.style else None, paragraph.text.strip())
            for paragraph in document.paragraphs
            if paragraph.text.strip()
        ]
        for table in document.tables:
            for row in table.rows:
                cell_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                if cell_text:
                    paragraphs.append((None, cell_text))

    sections: list[ExtractedSection] = []
    current_heading: str | None = None
    current_lines: list[str] = []

    def flush() -> None:
        body = normalize_text("\n".join(current_lines))
        if body:
            sections.append(ExtractedSection(len(sections), current_heading, None, body))

    for style, text in paragraphs:
        if style and style.lower().replace(" ", "").startswith("heading"):
            flush()
            current_heading = text
            current_lines = []
        else:
            current_lines.append(text)
    flush()

    if not sections:
        body = normalize_text("\n".join(text for _, text in paragraphs))
        if body:
            sections.append(ExtractedSection(0, None, None, body))
    return {"sections": [section.__dict__ for section in sections]}


def extract_document(path_value: Path) -> dict[str, Any]:
    extension = path_value.suffix.lower()
    if extension == ".pdf":
        return extract_pdf(path_value)
    if extension == ".docx":
        return extract_docx(path_value)
    if extension == ".md":
        return extract_markdown(path_value)
    if extension == ".txt":
        return extract_text(path_value)
    raise WorkerError("unsupported_file_type", f"Unsupported file type: {extension}")


def get_chunk_config(input_data: dict[str, Any] | None = None) -> tuple[int, int]:
    input_data = input_data or {}
    raw_chunk_size = input_data.get("chunk_size")
    raw_chunk_overlap = input_data.get("chunk_overlap")
    chunk_size = (
        int(raw_chunk_size)
        if isinstance(raw_chunk_size, int) and 1000 <= raw_chunk_size <= 12000
        else TARGET_CHUNK_CHARS
    )
    chunk_overlap = (
        int(raw_chunk_overlap)
        if isinstance(raw_chunk_overlap, int) and 0 <= raw_chunk_overlap < chunk_size
        else CHUNK_OVERLAP_CHARS
    )
    return chunk_size, chunk_overlap


def get_float_config(
    input_data: dict[str, Any],
    key: str,
    default_value: float,
    minimum: float,
    maximum: float,
) -> float:
    value = input_data.get(key)
    if not isinstance(value, (int, float)):
        return default_value
    return max(minimum, min(maximum, float(value)))


def get_int_config(
    input_data: dict[str, Any],
    key: str,
    default_value: int,
    minimum: int,
    maximum: int,
) -> int:
    value = input_data.get(key)
    if not isinstance(value, int):
        return default_value
    return max(minimum, min(maximum, int(value)))


def split_long_text(text: str, chunk_size: int = TARGET_CHUNK_CHARS, chunk_overlap: int = CHUNK_OVERLAP_CHARS) -> list[str]:
    normalized = normalize_text(text)
    if len(normalized) <= chunk_size:
        return [normalized] if normalized else []

    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n\s*\n", normalized) if paragraph.strip()]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph
        if len(candidate) <= chunk_size:
            current = candidate
            continue
        if current:
            chunks.append(current)
            overlap = current[-chunk_overlap:].strip() if chunk_overlap > 0 else ""
            current = f"{overlap}\n\n{paragraph}".strip() if overlap else paragraph
        else:
            start = 0
            while start < len(paragraph):
                end = min(len(paragraph), start + chunk_size)
                chunks.append(paragraph[start:end].strip())
                if end >= len(paragraph):
                    break
                start = max(end - chunk_overlap, start + 1)
            current = ""
    if current:
        chunks.append(current)
    return chunks


def next_vector_id(connection: sqlite3.Connection) -> int:
    row = connection.execute("SELECT MAX(faiss_vector_id) AS max_id FROM rag_chunks").fetchone()
    value = row["max_id"] if row else None
    return int(value) + 1 if value is not None else 1


def get_chunk_row_count(connection: sqlite3.Connection) -> int:
    row = connection.execute("SELECT COUNT(*) AS count FROM rag_chunks").fetchone()
    return int(row["count"]) if row else 0


def ensure_index_profile(
    connection: sqlite3.Connection,
    provider: str,
    model: str,
    dimension: int,
) -> None:
    row = connection.execute(
        "SELECT * FROM rag_index_profile WHERE index_name = 'internal'",
    ).fetchone()

    if row:
        matches = (
            row["embedding_provider"] == provider
            and row["embedding_model"] == model
            and int(row["embedding_dimension"]) == dimension
        )
        if not matches and get_chunk_row_count(connection) > 0:
            raise WorkerError(
                "embedding_profile_mismatch",
                "Embedding configuration changed. RAG documents need re-embedding.",
            )

    connection.execute(
        """
        INSERT INTO rag_index_profile (
          index_name,
          embedding_provider,
          embedding_model,
          embedding_dimension,
          updated_at
        )
        VALUES ('internal', ?, ?, ?, ?)
        ON CONFLICT(index_name) DO UPDATE SET
          embedding_provider = excluded.embedding_provider,
          embedding_model = excluded.embedding_model,
          embedding_dimension = excluded.embedding_dimension,
          updated_at = excluded.updated_at
        """,
        (provider, model, dimension, now_iso()),
    )


def assert_index_profile(
    connection: sqlite3.Connection,
    provider: str,
    model: str,
    dimension: int,
) -> None:
    row = connection.execute(
        "SELECT * FROM rag_index_profile WHERE index_name = 'internal'",
    ).fetchone()
    if not row:
        return

    if (
        row["embedding_provider"] != provider
        or row["embedding_model"] != model
        or int(row["embedding_dimension"]) != dimension
    ):
        raise WorkerError(
            "embedding_profile_mismatch",
            "Query embedding profile does not match the current RAG index.",
        )


def build_chunks(
    rag_document_id: str,
    extraction: dict[str, Any],
    first_vector_id: int,
    chunk_size: int = TARGET_CHUNK_CHARS,
    chunk_overlap: int = CHUNK_OVERLAP_CHARS,
) -> list[RagChunk]:
    raw_sections = extraction.get("sections")
    if not isinstance(raw_sections, list):
        raise WorkerError("extraction_failed", "Extractor returned an invalid section list.")

    chunks: list[RagChunk] = []
    vector_id = first_vector_id
    for raw_section in raw_sections:
        if not isinstance(raw_section, dict):
            continue
        text = raw_section.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        heading = raw_section.get("heading")
        page = raw_section.get("page")
        section_index = raw_section.get("section_index")
        for text_part in split_long_text(text, chunk_size, chunk_overlap):
            chunk_index = len(chunks)
            chunks.append(
                RagChunk(
                    chunk_id=f"{rag_document_id}-CH-{chunk_index + 1:06d}",
                    rag_document_id=rag_document_id,
                    chunk_index=chunk_index,
                    text=text_part,
                    heading=heading if isinstance(heading, str) and heading.strip() else None,
                    page=page if isinstance(page, int) else None,
                    section_index=section_index if isinstance(section_index, int) else None,
                    faiss_vector_id=vector_id,
                )
            )
            vector_id += 1
    return chunks


def deterministic_test_embeddings(texts: list[str], dimension: int = 16) -> list[list[float]]:
    vectors: list[list[float]] = []
    for text in texts:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        vector = [((digest[index % len(digest)] / 255.0) * 2.0) - 1.0 for index in range(dimension)]
        length = math.sqrt(sum(value * value for value in vector)) or 1.0
        vectors.append([value / length for value in vector])
    return vectors


class EmbeddingProvider:
    provider_name: str
    model_name: str
    dimension: int | None

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]


class TestEmbeddingProvider(EmbeddingProvider):
    provider_name = "test"

    def __init__(self, model_name: str):
        self.model_name = model_name or "deterministic-test"
        self.dimension = 16

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return deterministic_test_embeddings(texts, self.dimension or 16)


def post_json(url: str, payload: dict[str, Any], headers: dict[str, str] | None = None) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, dict):
        raise WorkerError("embedding_failed", "Embedding response was invalid.")
    return value


def get_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(request, timeout=10) as response:
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, dict):
        raise WorkerError("ollama_unavailable", "Ollama response was invalid.")
    return value


def embed_with_openai(texts: list[str], model: str, api_key: str) -> list[list[float]]:
    if not api_key.strip():
        raise WorkerError("openai_api_key_missing", "OpenAI API Key is required for embedding.")

    request = urllib.request.Request(
        "https://api.openai.com/v1/embeddings",
        data=json.dumps({"model": model, "input": texts, "encoding_format": "float"}).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        print(error.read().decode("utf-8", errors="replace"), file=sys.stderr)
        raise WorkerError("embedding_failed", "OpenAI embedding request failed.") from error
    except Exception as error:
        raise WorkerError("embedding_failed", "OpenAI embedding request failed.") from error

    data = payload.get("data")
    if not isinstance(data, list):
        raise WorkerError("embedding_failed", "OpenAI embedding response was invalid.")

    vectors: list[list[float]] = []
    for item in sorted(data, key=lambda value: value.get("index", 0) if isinstance(value, dict) else 0):
        embedding = item.get("embedding") if isinstance(item, dict) else None
        if not isinstance(embedding, list) or not all(isinstance(value, (int, float)) for value in embedding):
            raise WorkerError("embedding_failed", "OpenAI embedding vector was invalid.")
        vectors.append([float(value) for value in embedding])
    if len(vectors) != len(texts):
        raise WorkerError("embedding_failed", "OpenAI embedding count did not match chunk count.")
    return vectors


class OpenAIEmbeddingProvider(EmbeddingProvider):
    provider_name = "openai"

    def __init__(self, model_name: str, api_key: str):
        self.model_name = model_name or DEFAULT_OPENAI_EMBEDDING_MODEL
        self.api_key = api_key
        self.dimension = None

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        vectors = embed_with_openai(texts, self.model_name, self.api_key)
        self.dimension = len(vectors[0]) if vectors else self.dimension
        return vectors


class LocalEmbeddingProvider(EmbeddingProvider):
    provider_name = "local"

    def __init__(self, model_name: str, ollama_base_url: str):
        self.model_name = model_name or DEFAULT_LOCAL_EMBEDDING_MODEL
        self.ollama_base_url = ollama_base_url.rstrip("/") or DEFAULT_OLLAMA_BASE_URL
        self.dimension = None

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not self.model_name.strip():
            raise WorkerError("embedding_model_unavailable", "Local embedding model is not configured.")

        try:
            payload = post_json(
                f"{self.ollama_base_url}/api/embed",
                {"model": self.model_name, "input": texts},
            )
        except urllib.error.URLError as error:
            raise WorkerError("ollama_unavailable", "Ollama is not reachable.") from error
        except Exception as error:
            raise WorkerError("local_embedding_failed", "Local embedding failed.") from error

        raw_embeddings = payload.get("embeddings")
        if raw_embeddings is None and isinstance(payload.get("embedding"), list):
            raw_embeddings = [payload.get("embedding")]

        if not isinstance(raw_embeddings, list):
            raise WorkerError("local_embedding_failed", "Ollama embedding response was invalid.")

        vectors: list[list[float]] = []
        for embedding in raw_embeddings:
            if not isinstance(embedding, list) or not all(isinstance(value, (int, float)) for value in embedding):
                raise WorkerError("local_embedding_failed", "Ollama embedding vector was invalid.")
            vectors.append([float(value) for value in embedding])

        if len(vectors) != len(texts):
            raise WorkerError("local_embedding_failed", "Ollama embedding count did not match input count.")

        self.dimension = len(vectors[0]) if vectors else self.dimension
        return vectors


def create_embedding_provider(input_data: dict[str, Any]) -> EmbeddingProvider:
    provider = str(input_data.get("embedding_provider") or DEFAULT_EMBEDDING_PROVIDER).strip().lower()
    model = str(input_data.get("embedding_model") or "").strip()

    if provider == "test":
        return TestEmbeddingProvider(model)
    if provider == "openai":
        return OpenAIEmbeddingProvider(model or DEFAULT_OPENAI_EMBEDDING_MODEL, str(input_data.get("openai_api_key") or ""))
    if provider == "local":
        return LocalEmbeddingProvider(
            model or DEFAULT_LOCAL_EMBEDDING_MODEL,
            str(input_data.get("ollama_base_url") or DEFAULT_OLLAMA_BASE_URL),
        )

    raise WorkerError("embedding_provider_unavailable", "Embedding provider is not available.")


def embed_texts(input_data: dict[str, Any], texts: list[str]) -> tuple[str, str, int | None, list[list[float]]]:
    provider = create_embedding_provider(input_data)
    if not texts:
        return provider.provider_name, provider.model_name, provider.dimension, []
    vectors = provider.embed_documents(texts)
    return provider.provider_name, provider.model_name, provider.dimension, vectors


def import_faiss_modules() -> tuple[Any, Any]:
    try:
        import faiss
        import numpy
    except Exception as error:
        raise WorkerError("dependency_missing", "faiss-cpu and numpy are required for FAISS indexing.") from error
    return faiss, numpy


def l2_normalize(vectors: list[list[float]], numpy: Any) -> Any:
    array = numpy.asarray(vectors, dtype="float32")
    norms = numpy.linalg.norm(array, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return array / norms


def add_faiss_vectors(storage_root: Path, chunks: list[RagChunk], vectors: list[list[float]]) -> None:
    if not chunks:
        return
    faiss, numpy = import_faiss_modules()
    normalized_vectors = l2_normalize(vectors, numpy)
    index_path = get_index_path(storage_root)
    if index_path.exists():
        index = faiss.read_index(str(index_path))
        if index.d != normalized_vectors.shape[1]:
            raise WorkerError("faiss_dimension_mismatch", "Existing FAISS index dimension does not match embedding model.")
    else:
        index = faiss.IndexIDMap2(faiss.IndexFlatIP(normalized_vectors.shape[1]))
    ids = numpy.asarray([chunk.faiss_vector_id for chunk in chunks], dtype="int64")
    index.add_with_ids(normalized_vectors, ids)
    faiss.write_index(index, str(index_path))


def remove_faiss_vectors(storage_root: Path, vector_ids: list[int]) -> None:
    index_path = get_index_path(storage_root)
    if not vector_ids or not index_path.exists():
        return
    faiss, numpy = import_faiss_modules()
    index = faiss.read_index(str(index_path))
    index.remove_ids(numpy.asarray(vector_ids, dtype="int64"))
    faiss.write_index(index, str(index_path))


def load_test_vectors(storage_root: Path) -> dict[str, list[float]]:
    path_value = get_test_index_path(storage_root)
    if not path_value.exists():
        return {}
    try:
        value = json.loads(path_value.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return {str(key): vector for key, vector in value.items() if isinstance(vector, list)}


def save_test_vectors(storage_root: Path, vectors: dict[str, list[float]]) -> None:
    get_test_index_path(storage_root).write_text(json.dumps(vectors), encoding="utf-8")


def add_vectors(storage_root: Path, provider: str, chunks: list[RagChunk], vectors: list[list[float]]) -> None:
    if provider == "test":
        stored = load_test_vectors(storage_root)
        for chunk, vector in zip(chunks, vectors):
            stored[str(chunk.faiss_vector_id)] = vector
        save_test_vectors(storage_root, stored)
        return
    add_faiss_vectors(storage_root, chunks, vectors)


def remove_vectors(storage_root: Path, vector_ids: list[int]) -> None:
    stored = load_test_vectors(storage_root)
    if stored:
        for vector_id in vector_ids:
            stored.pop(str(vector_id), None)
        save_test_vectors(storage_root, stored)
    try:
        remove_faiss_vectors(storage_root, vector_ids)
    except WorkerError as error:
        if error.code != "dependency_missing":
            raise


def delete_document_chunks(connection: sqlite3.Connection, storage_root: Path, rag_document_id: str) -> None:
    rows = connection.execute(
        "SELECT faiss_vector_id FROM rag_chunks WHERE rag_document_id = ?",
        (rag_document_id,),
    ).fetchall()
    remove_vectors(storage_root, [int(row["faiss_vector_id"]) for row in rows])
    try:
        connection.execute("DELETE FROM rag_chunks_fts WHERE rag_document_id = ?", (rag_document_id,))
    except sqlite3.OperationalError:
        pass
    connection.execute("DELETE FROM rag_chunks WHERE rag_document_id = ?", (rag_document_id,))


def insert_chunk_fts_rows(
    connection: sqlite3.Connection,
    chunks: list[RagChunk],
    original_filename: str,
) -> None:
    try:
        connection.executemany(
            """
            INSERT INTO rag_chunks_fts (
              chunk_id, rag_document_id, original_filename, heading, text
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                (
                    chunk.chunk_id,
                    chunk.rag_document_id,
                    normalize_fts_text(original_filename),
                    normalize_fts_text(chunk.heading),
                    chunk.text,
                )
                for chunk in chunks
            ],
        )
    except sqlite3.OperationalError:
        pass


def import_document(input_data: dict[str, Any]) -> dict[str, Any]:
    storage_root = get_storage_root(input_data)
    source_path = validate_source_path(input_data)
    security = validate_security(input_data)
    workspace_ids = validate_workspace_ids(input_data)
    file_hash = sha256_file(source_path)
    file_size = source_path.stat().st_size
    file_type = source_path.suffix.lower()

    with connect_database(storage_root) as connection:
        duplicate = get_document_by_hash(connection, file_hash)
        if duplicate:
            return {"status": "duplicate", "document": duplicate, "duplicateOf": duplicate["ragDocumentId"]}

        rag_document_id = generate_rag_document_id(connection)
        document_directory = storage_root / "documents" / rag_document_id
        managed_file_path = document_directory / sanitize_filename(source_path.name)
        created_at = now_iso()
        try:
            document_directory.mkdir(parents=True, exist_ok=False)
            shutil.copy2(source_path, managed_file_path)
            with connection:
                connection.execute(
                    """
                    INSERT INTO rag_documents (
                      rag_document_id, original_filename, managed_file_path,
                      file_type, file_size, file_hash, security, status,
                      created_at, indexed_at, embedding_provider, embedding_model,
                      chunk_count
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', ?, NULL, NULL, NULL, 0)
                    """,
                    (rag_document_id, source_path.name, str(managed_file_path), file_type, file_size, file_hash, security, created_at),
                )
                connection.executemany(
                    """
                    INSERT INTO rag_document_workspaces (rag_document_id, workspace_id)
                    VALUES (?, ?)
                    """,
                    [(rag_document_id, workspace_id) for workspace_id in workspace_ids],
                )
        except Exception as error:
            shutil.rmtree(document_directory, ignore_errors=True)
            if isinstance(error, sqlite3.Error):
                raise WorkerError("database_failed", "RAG document could not be saved.") from error
            raise WorkerError("copy_failed", "RAG document could not be copied.") from error

        return {"status": "imported", "document": row_to_document(connection, get_document_row(connection, rag_document_id))}


def list_documents(input_data: dict[str, Any]) -> list[dict[str, Any]]:
    storage_root = get_storage_root(input_data)
    with connect_database(storage_root) as connection:
        rows = connection.execute("SELECT * FROM rag_documents ORDER BY created_at DESC, rag_document_id DESC").fetchall()
        return [row_to_document(connection, row) for row in rows]


def delete_document(input_data: dict[str, Any]) -> dict[str, Any]:
    storage_root = get_storage_root(input_data)
    rag_document_id = input_data.get("rag_document_id")
    if not isinstance(rag_document_id, str):
        raise WorkerError("invalid_input", "rag_document_id is required.")

    with connect_database(storage_root) as connection:
        row = get_document_row(connection, rag_document_id)
        document_directory = Path(row["managed_file_path"]).parent
        try:
            with connection:
                delete_document_chunks(connection, storage_root, rag_document_id)
                connection.execute("DELETE FROM rag_document_workspaces WHERE rag_document_id = ?", (rag_document_id,))
                connection.execute("DELETE FROM rag_documents WHERE rag_document_id = ?", (rag_document_id,))
            shutil.rmtree(document_directory, ignore_errors=True)
        except sqlite3.Error as error:
            raise WorkerError("database_failed", "RAG document could not be deleted.") from error
        except Exception as error:
            raise WorkerError("delete_failed", "Managed RAG copy could not be deleted.") from error
    return {"ragDocumentId": rag_document_id, "deleted": True}


def replace_document(input_data: dict[str, Any]) -> dict[str, Any]:
    storage_root = get_storage_root(input_data)
    source_path = validate_source_path(input_data)
    rag_document_id = input_data.get("rag_document_id")
    if not isinstance(rag_document_id, str):
        raise WorkerError("invalid_input", "rag_document_id is required.")

    new_hash = sha256_file(source_path)
    with connect_database(storage_root) as connection:
        current_row = get_document_row(connection, rag_document_id)
        if current_row["file_hash"] == new_hash:
            return {"status": "unchanged", "document": row_to_document(connection, current_row)}

        duplicate = get_document_by_hash(connection, new_hash)
        if duplicate and duplicate["ragDocumentId"] != rag_document_id:
            return {"status": "duplicate", "document": row_to_document(connection, current_row), "duplicateOf": duplicate["ragDocumentId"]}

        document_directory = Path(current_row["managed_file_path"]).parent
        new_managed_file_path = document_directory / sanitize_filename(source_path.name)
        try:
            document_directory.mkdir(parents=True, exist_ok=True)
            for child in document_directory.iterdir():
                if child.is_file():
                    child.unlink()
            shutil.copy2(source_path, new_managed_file_path)
            with connection:
                delete_document_chunks(connection, storage_root, rag_document_id)
                connection.execute(
                    """
                    UPDATE rag_documents
                    SET original_filename = ?, managed_file_path = ?, file_type = ?,
                        file_size = ?, file_hash = ?, status = 'imported',
                        indexed_at = NULL, embedding_provider = NULL,
                        embedding_model = NULL, embedding_dimension = NULL,
                        chunk_count = 0
                    WHERE rag_document_id = ?
                    """,
                    (
                        source_path.name,
                        str(new_managed_file_path),
                        source_path.suffix.lower(),
                        source_path.stat().st_size,
                        new_hash,
                        rag_document_id,
                    ),
                )
        except sqlite3.Error as error:
            raise WorkerError("database_failed", "RAG document could not be replaced.") from error
        except Exception as error:
            raise WorkerError("replace_failed", "Managed RAG copy could not be replaced.") from error
        return {"status": "replaced", "document": row_to_document(connection, get_document_row(connection, rag_document_id))}


def index_document(input_data: dict[str, Any]) -> dict[str, Any]:
    storage_root = get_storage_root(input_data)
    rag_document_id = input_data.get("rag_document_id")
    if not isinstance(rag_document_id, str):
        raise WorkerError("invalid_input", "rag_document_id is required.")

    with connect_database(storage_root) as connection:
        row = get_document_row(connection, rag_document_id)
        provider = str(input_data.get("embedding_provider") or DEFAULT_EMBEDDING_PROVIDER).strip().lower()
        if row["security"] == "private" and provider != "local":
            raise WorkerError("private_requires_local_embedding", "Private RAG documents require local embedding.")

        managed_file_path = Path(row["managed_file_path"])
        if not managed_file_path.exists() or not managed_file_path.is_file():
            raise WorkerError("managed_copy_not_found", "Managed RAG copy was not found.")

        try:
            with connection:
                connection.execute("UPDATE rag_documents SET status = 'indexing' WHERE rag_document_id = ?", (rag_document_id,))

            extraction = extract_document(managed_file_path)
            chunk_size, chunk_overlap = get_chunk_config(input_data)
            chunks = build_chunks(
                rag_document_id,
                extraction,
                next_vector_id(connection),
                chunk_size,
                chunk_overlap,
            )
            provider, model, dimension, vectors = embed_texts(input_data, [chunk.text for chunk in chunks])
            if vectors and dimension is None:
                dimension = len(vectors[0])

            with connection:
                delete_document_chunks(connection, storage_root, rag_document_id)
                chunks = build_chunks(
                    rag_document_id,
                    extraction,
                    next_vector_id(connection),
                    chunk_size,
                    chunk_overlap,
                )
                ensure_index_profile(connection, provider, model, dimension or 0)
                add_vectors(storage_root, provider, chunks, vectors)
                connection.executemany(
                    """
                    INSERT INTO rag_chunks (
                      chunk_id, rag_document_id, chunk_index, text, heading,
                      page, section_index, faiss_vector_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            chunk.chunk_id,
                            chunk.rag_document_id,
                            chunk.chunk_index,
                            chunk.text,
                            chunk.heading,
                            chunk.page,
                            chunk.section_index,
                            chunk.faiss_vector_id,
                        )
                        for chunk in chunks
                    ],
                )
                insert_chunk_fts_rows(connection, chunks, str(row["original_filename"]))
                connection.execute(
                    """
                    UPDATE rag_documents
                    SET status = 'indexed', indexed_at = ?, embedding_provider = ?,
                        embedding_model = ?, embedding_dimension = ?, chunk_count = ?
                    WHERE rag_document_id = ?
                    """,
                    (now_iso(), provider, model, dimension, len(chunks), rag_document_id),
                )
        except WorkerError as error:
            with connection:
                delete_document_chunks(connection, storage_root, rag_document_id)
                connection.execute("UPDATE rag_documents SET status = 'failed' WHERE rag_document_id = ?", (rag_document_id,))
            raise error
        except Exception as error:
            with connection:
                delete_document_chunks(connection, storage_root, rag_document_id)
                connection.execute("UPDATE rag_documents SET status = 'failed' WHERE rag_document_id = ?", (rag_document_id,))
            raise WorkerError("indexing_failed", "RAG indexing failed.") from error

        return {"status": "indexed", "document": row_to_document(connection, get_document_row(connection, rag_document_id))}


def workspace_ids_for_document(connection: sqlite3.Connection, rag_document_id: str) -> list[str]:
    rows = connection.execute(
        "SELECT workspace_id FROM rag_document_workspaces WHERE rag_document_id = ? ORDER BY workspace_id",
        (rag_document_id,),
    ).fetchall()
    return [row["workspace_id"] for row in rows]


def get_document_scope(
    document_workspace_ids: list[str],
    query_workspace_ids: list[str],
    include_global: bool,
) -> str | None:
    if not document_workspace_ids:
        return "global" if include_global else None
    if not query_workspace_ids:
        return None
    return "workspace" if set(document_workspace_ids).intersection(query_workspace_ids) else None


def document_matches_security(document_security: str, query_security: str) -> bool:
    if document_security == "private":
        return query_security == "private"
    return query_security != "private"


def chunk_result_from_row(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    dense_score: float | None,
    dense_rank: int | None,
    lexical_score: float | None,
    lexical_rank: int | None,
    hybrid_score: float,
    adjusted_score: float,
    scope: str,
) -> dict[str, Any]:
    return {
        "score": adjusted_score,
        "rawScore": dense_score if dense_score is not None else 0.0,
        "denseScore": dense_score,
        "denseRank": dense_rank,
        "lexicalScore": lexical_score,
        "lexicalRank": lexical_rank,
        "hybridScore": hybrid_score,
        "adjustedScore": adjusted_score,
        "scope": scope,
        "ragDocumentId": row["rag_document_id"],
        "filename": row["original_filename"],
        "workspaceIds": workspace_ids_for_document(connection, row["rag_document_id"]),
        "security": row["security"],
        "chunkId": row["chunk_id"],
        "chunkIndex": row["chunk_index"],
        "heading": row["heading"],
        "page": row["page"],
        "text": row["text"],
    }


def search_test_vectors(storage_root: Path, query_vector: list[float], candidate_limit: int) -> list[tuple[int, float]]:
    scored: list[tuple[int, float]] = []
    for raw_id, vector in load_test_vectors(storage_root).items():
        score = sum(float(left) * float(right) for left, right in zip(query_vector, vector))
        scored.append((int(raw_id), score))
    return sorted(scored, key=lambda item: item[1], reverse=True)[:candidate_limit]


def search_faiss_vectors(storage_root: Path, query_vector: list[float], candidate_limit: int) -> list[tuple[int, float]]:
    faiss, numpy = import_faiss_modules()
    index_path = get_index_path(storage_root)
    if not index_path.exists():
        return []
    index = faiss.read_index(str(index_path))
    scores, ids = index.search(l2_normalize([query_vector], numpy), candidate_limit)
    results: list[tuple[int, float]] = []
    for vector_id, score in zip(ids[0], scores[0]):
        if int(vector_id) >= 0:
            results.append((int(vector_id), float(score)))
    return results


def quote_fts_value(value: str) -> str:
    escaped = value.replace('"', '""')
    return f'"{escaped}"'


def build_fts_queries(query: str) -> list[str]:
    normalized = normalize_text(query)
    if not normalized:
        return []

    raw_terms = [
        term.lower()
        for term in re.findall(r"[0-9A-Za-z_\uac00-\ud7a3]+", normalized, flags=re.UNICODE)
        if len(term) >= 2
    ]
    stop_terms = {
        "\ubb34\uc5c7",
        "\ubb34\uc5c7\uc778\uac00",
        "\uc5b4\ub5bb\uac8c",
        "\uc54c\ub824\uc918",
        "\uc54c\ub824\uc8fc\uc138\uc694",
        "\uad00\ub828",
        "\uad00\ub828\ub41c",
    }
    particle_suffixes = [
        "\uc785\ub2c8\uae4c",
        "\uc778\uac00",
        "\uc5d0\uc11c",
        "\uc73c\ub85c",
        "\uc740",
        "\ub294",
        "\uc774",
        "\uac00",
        "\uc744",
        "\ub97c",
        "\uc758",
        "\uc5d0",
        "\uc640",
        "\uacfc",
        "\ub3c4",
        "\ub9cc",
        "\ub85c",
    ]

    terms: list[str] = []
    seen_terms: set[str] = set()
    for raw_term in raw_terms:
        candidates = [raw_term]
        for suffix in particle_suffixes:
            if raw_term.endswith(suffix) and len(raw_term) > len(suffix) + 1:
                candidates.append(raw_term[: -len(suffix)])
                break
        for candidate in candidates:
            if candidate in stop_terms or len(candidate) < 2 or candidate in seen_terms:
                continue
            seen_terms.add(candidate)
            terms.append(candidate)

    queries = [quote_fts_value(term) for term in terms]
    if terms:
        queries.append(" OR ".join(quote_fts_value(term) for term in terms))

    result: list[str] = []
    seen: set[str] = set()
    for item in queries:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def search_lexical_vectors(
    connection: sqlite3.Connection,
    query: str,
    candidate_limit: int,
) -> list[tuple[int, float]]:
    best_by_vector_id: dict[int, tuple[int, float]] = {}
    for fts_query in build_fts_queries(query):
        try:
            rows = connection.execute(
                """
                SELECT rag_chunks.faiss_vector_id AS faiss_vector_id,
                       bm25(rag_chunks_fts) AS lexical_score
                FROM rag_chunks_fts
                INNER JOIN rag_chunks
                  ON rag_chunks.chunk_id = rag_chunks_fts.chunk_id
                WHERE rag_chunks_fts MATCH ?
                ORDER BY lexical_score ASC
                LIMIT ?
                """,
                (fts_query, candidate_limit),
            ).fetchall()
        except sqlite3.OperationalError:
            continue

        for rank, row in enumerate(rows, start=1):
            vector_id = int(row["faiss_vector_id"])
            lexical_score = float(row["lexical_score"])
            current = best_by_vector_id.get(vector_id)
            if current is None or rank < current[0]:
                best_by_vector_id[vector_id] = (rank, lexical_score)

    return [
        (vector_id, lexical_score)
        for vector_id, (_, lexical_score) in sorted(
            best_by_vector_id.items(),
            key=lambda item: (item[1][0], item[1][1]),
        )
    ][:candidate_limit]


def rrf_score(rank: int | None, weight: float) -> float:
    if rank is None:
        return 0.0
    return weight / (DEFAULT_RRF_K + rank)


def search_documents(input_data: dict[str, Any]) -> list[dict[str, Any]]:
    storage_root = get_storage_root(input_data)
    query = input_data.get("query")
    if not isinstance(query, str) or not query.strip():
        raise WorkerError("invalid_input", "query is required.")

    workspace_ids = validate_workspace_ids({"workspace_ids": input_data.get("workspace_ids", [])})
    include_global = input_data.get("include_global") is not False
    top_k = input_data.get("top_k")
    top_k_value = max(1, min(20, int(top_k) if isinstance(top_k, int) else 5))
    query_security = str(input_data.get("security") or "internal")
    requested_provider = str(input_data.get("embedding_provider") or DEFAULT_EMBEDDING_PROVIDER).strip().lower()
    if query_security == "private" and requested_provider != "local":
        raise WorkerError("private_external_embedding_blocked", "Private RAG search requires local embedding.")
    similarity_threshold = get_float_config(
        input_data,
        "similarity_threshold",
        DEFAULT_SIMILARITY_THRESHOLD,
        -1.0,
        1.0,
    )
    dense_only_threshold = max(
        similarity_threshold,
        get_float_config(
            input_data,
            "dense_only_threshold",
            DEFAULT_DENSE_ONLY_THRESHOLD,
            -1.0,
            1.0,
        ),
    )
    workspace_score_bonus = get_float_config(
        input_data,
        "workspace_score_bonus",
        DEFAULT_WORKSPACE_SCORE_BONUS,
        0.0,
        0.2,
    )
    max_chunks_per_document = get_int_config(
        input_data,
        "max_chunks_per_document",
        DEFAULT_MAX_CHUNKS_PER_DOCUMENT,
        1,
        10,
    )
    configured_candidate_count = get_int_config(
        input_data,
        "search_candidate_count",
        DEFAULT_SEARCH_CANDIDATE_COUNT,
        10,
        200,
    )

    provider, model, dimension, vectors = embed_texts(input_data, [query.strip()])
    if vectors and dimension is None:
        dimension = len(vectors[0])
    with connect_database(storage_root) as connection:
        assert_index_profile(connection, provider, model, dimension or 0)

    candidate_limit = max(top_k_value * 10, configured_candidate_count)
    dense_candidates = (
        search_test_vectors(storage_root, vectors[0], candidate_limit)
        if provider == "test"
        else search_faiss_vectors(storage_root, vectors[0], candidate_limit)
    )
    dense_by_vector_id = {
        vector_id: {"rank": rank, "score": score}
        for rank, (vector_id, score) in enumerate(dense_candidates, start=1)
    }
    with connect_database(storage_root) as connection:
        lexical_candidates = search_lexical_vectors(connection, query.strip(), candidate_limit)
    lexical_by_vector_id = {
        vector_id: {"rank": rank, "score": score}
        for rank, (vector_id, score) in enumerate(lexical_candidates, start=1)
    }
    candidate_vector_ids = set(dense_by_vector_id).union(lexical_by_vector_id)

    scored_results: list[dict[str, Any]] = []
    seen_chunks: set[str] = set()
    with connect_database(storage_root) as connection:
        for vector_id in candidate_vector_ids:
            row = connection.execute(
                """
                SELECT rag_chunks.*, rag_documents.original_filename, rag_documents.security
                FROM rag_chunks
                INNER JOIN rag_documents
                  ON rag_documents.rag_document_id = rag_chunks.rag_document_id
                WHERE rag_chunks.faiss_vector_id = ?
                  AND rag_documents.status = 'indexed'
                """,
                (vector_id,),
            ).fetchone()
            if not row or row["chunk_id"] in seen_chunks:
                continue
            document_workspace_ids = workspace_ids_for_document(connection, row["rag_document_id"])
            scope = get_document_scope(document_workspace_ids, workspace_ids, include_global)
            if scope is None:
                continue
            if not document_matches_security(str(row["security"]), query_security):
                continue
            dense_candidate = dense_by_vector_id.get(vector_id)
            lexical_candidate = lexical_by_vector_id.get(vector_id)
            dense_rank = int(dense_candidate["rank"]) if dense_candidate else None
            dense_score = float(dense_candidate["score"]) if dense_candidate else None
            lexical_rank = int(lexical_candidate["rank"]) if lexical_candidate else None
            lexical_score = float(lexical_candidate["score"]) if lexical_candidate else None

            if lexical_rank is None and (dense_score is None or dense_score < dense_only_threshold):
                continue
            hybrid_score = rrf_score(dense_rank, DEFAULT_DENSE_RRF_WEIGHT) + rrf_score(
                lexical_rank,
                DEFAULT_LEXICAL_RRF_WEIGHT,
            )
            adjusted_score = hybrid_score + (workspace_score_bonus if scope == "workspace" else 0.0)
            seen_chunks.add(row["chunk_id"])
            scored_results.append(
                chunk_result_from_row(
                    connection,
                    row,
                    dense_score,
                    dense_rank,
                    lexical_score,
                    lexical_rank,
                    hybrid_score,
                    adjusted_score,
                    scope,
                )
            )

    final_results: list[dict[str, Any]] = []
    document_counts: dict[str, int] = {}
    sorted_results = sorted(scored_results, key=lambda item: item["adjustedScore"], reverse=True)
    for hybrid_rank, result in enumerate(sorted_results, start=1):
        result["hybridRank"] = hybrid_rank
        rag_document_id = str(result["ragDocumentId"])
        if document_counts.get(rag_document_id, 0) >= max_chunks_per_document:
            continue
        document_counts[rag_document_id] = document_counts.get(rag_document_id, 0) + 1
        final_results.append(result)
        if len(final_results) >= top_k_value:
            break
    return final_results


def runtime_check(_: dict[str, Any]) -> dict[str, Any]:
    return {"available": True, "executable": sys.executable, "version": sys.version.split()[0]}


def check_embedding_status(input_data: dict[str, Any]) -> dict[str, Any]:
    provider = create_embedding_provider(input_data)

    if provider.provider_name == "local" and isinstance(provider, LocalEmbeddingProvider):
        try:
            tags = get_json(f"{provider.ollama_base_url}/api/tags")
        except urllib.error.URLError as error:
            raise WorkerError("ollama_unavailable", "Ollama is not reachable.") from error
        except Exception as error:
            raise WorkerError("ollama_unavailable", "Ollama is not reachable.") from error

        models = tags.get("models")
        model_names = {
            model.get("name")
            for model in models
            if isinstance(model, dict) and isinstance(model.get("name"), str)
        } if isinstance(models, list) else set()
        accepted_model_names = {provider.model_name}
        if ":" not in provider.model_name:
            accepted_model_names.add(f"{provider.model_name}:latest")

        if model_names.isdisjoint(accepted_model_names):
            raise WorkerError(
                "embedding_model_unavailable",
                "Local embedding model is not available.",
            )

        vector = provider.embed_query("mimora embedding check")
        return {
            "available": True,
            "provider": "local",
            "model": provider.model_name,
            "endpoint": provider.ollama_base_url,
            "dimension": len(vector),
            "message": "Local embedding model is available.",
        }

    if provider.provider_name == "openai":
        vector = provider.embed_query("mimora embedding check")
        return {
            "available": True,
            "provider": "openai",
            "model": provider.model_name,
            "dimension": len(vector),
            "message": "OpenAI embedding model is available.",
        }

    vector = provider.embed_query("mimora embedding check")
    return {
        "available": True,
        "provider": provider.provider_name,
        "model": provider.model_name,
        "dimension": len(vector),
        "message": "Embedding provider is available.",
    }


def schedule_source_path(input_data: dict[str, Any]) -> Path:
    source_path = input_data.get("source_path")
    if not isinstance(source_path, str) or not source_path.strip():
        raise WorkerError("schedule_source_not_found", "Schedule source path is required.")

    path_value = Path(source_path).resolve()
    if path_value.suffix.lower() not in SUPPORTED_SCHEDULE_EXTENSIONS:
        raise WorkerError("unsupported_schedule_file", "Schedule source must be .xlsx or .xlsm.")
    if not path_value.exists() or not path_value.is_file():
        raise WorkerError("schedule_source_not_found", "Schedule source file was not found.")
    return path_value


def normalize_schedule_header(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("_x000D_", " ").replace("_x000d_", " ")
    return re.sub(r"[^0-9A-Za-z가-힣]+", "", text.strip().lower())


SCHEDULE_COLUMN_ALIASES = {
    "wbs": ["wbs", "wbsid", "작업코드", "작업id"],
    "level": ["level", "wbslevel", "레벨", "수준"],
    "name": ["taskname", "task", "name", "작업명", "작업", "태스크", "일정명"],
    "planned_start": ["plannedstart", "planstart", "start", "계획시작", "시작일", "시작예정", "착수예정"],
    "planned_finish": ["plannedfinish", "planfinish", "finish", "계획종료", "완료일", "완료예정", "종료예정"],
    "actual_start": ["actualstart", "실제시작", "실제시작일", "실착수"],
    "actual_finish": ["actualfinish", "실제종료", "실제완료일", "실제완료", "실완료"],
    "planned_workload": ["plannedworkload", "planworkload", "계획공수", "계획작업량", "일일계획작업량"],
    "actual_workload": ["actualworkload", "실적공수", "실제공수", "실적작업량", "실제총작업량", "실제작업량"],
    "planned_duration": ["plannedduration", "계획기간", "기간"],
    "actual_duration": ["actualduration", "실제기간", "실적기간", "실제총기간"],
    "resource": ["resource", "resources", "담당자", "담당", "작업자", "리소스"],
    "deliverable": ["deliverable", "output", "산출물", "결과물"],
    "planned_progress": ["plannedprogress", "planprogress", "계획진척", "계획진도", "계획율", "계획", "계획작업량진척률"],
    "actual_progress": ["actualprogress", "progress", "실적진척", "실제진척", "실적", "진척율", "진도율", "실적기성진척률"],
    "calendar": ["calendar", "캘린더", "달력"],
}


def cell_to_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def normalize_wbs(value: Any) -> str:
    text = cell_to_text(value)
    if not text:
        return ""
    text = re.sub(r"\s+", "", text)
    parts = text.split(".")
    if all(re.fullmatch(r"\d+", part or "") for part in parts):
        return ".".join(str(int(part)) for part in parts)
    return text


def parse_schedule_date(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if hasattr(value, "date") and hasattr(value, "isoformat"):
        return value.date().isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if math.isnan(float(value)):
            return None
        serial = float(value)
        if 1 <= serial <= 60000:
            return (datetime(1899, 12, 30) + timedelta(days=serial)).date().isoformat()
    text = cell_to_text(value)
    if not text:
        return None
    for pattern in ("%Y-%m-%d", "%Y.%m.%d", "%Y/%m/%d", "%Y%m%d"):
        try:
            return datetime.strptime(text[:10] if pattern != "%Y%m%d" else text[:8], pattern).date().isoformat()
        except ValueError:
            continue
    return None


def parse_schedule_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        if math.isnan(float(value)):
            return None
        return float(value)
    text = cell_to_text(value).replace(",", "").replace("%", "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_schedule_progress(value: Any) -> float | None:
    number = parse_schedule_number(value)
    if number is None:
        return None
    return number / 100 if number > 1 else number


def parse_resource_assignments(value: Any) -> list[dict[str, Any]]:
    text = cell_to_text(value)
    if not text:
        return []
    assignments: list[dict[str, Any]] = []
    for part in re.split(r"[,;/\n]+", text):
        item = part.strip()
        if not item:
            continue
        match = re.match(r"^(.*?)\s*\[\s*([0-9]+(?:\.[0-9]+)?)\s*%\s*\]\s*$", item)
        if match:
            assignments.append({"name": match.group(1).strip(), "allocation": float(match.group(2)) / 100})
        else:
            assignments.append({"name": item, "allocation": 1.0})
    return assignments


def schedule_header_matches(normalized: str, aliases: set[str]) -> bool:
    if normalized in aliases:
        return True
    return any(alias and len(alias) >= 6 and alias in normalized for alias in aliases)


def detect_header_mapping(rows: list[tuple[Any, ...]], aliases: dict[str, list[str]], required: set[str]) -> tuple[int, dict[str, int]]:
    normalized_aliases = {
        field: {normalize_schedule_header(alias) for alias in values}
        for field, values in aliases.items()
    }
    best_row = -1
    best_mapping: dict[str, int] = {}
    best_score = -1
    for row_index, row in enumerate(rows[:30]):
        mapping: dict[str, int] = {}
        normalized_cells = [normalize_schedule_header(value) for value in row]
        for cell_index, normalized in enumerate(normalized_cells):
            if not normalized:
                continue
            for field, field_aliases in normalized_aliases.items():
                if field in mapping:
                    continue
                if schedule_header_matches(normalized, field_aliases):
                    mapping[field] = cell_index
        score = len(mapping)
        if score > best_score:
            best_score = score
            best_row = row_index
            best_mapping = mapping
    if not required.issubset(best_mapping.keys()):
        raise WorkerError("schedule_column_mapping_failed", "Schedule column mapping failed.")
    return best_row, best_mapping


def row_value(row: tuple[Any, ...], mapping: dict[str, int], field: str) -> Any:
    index = mapping.get(field)
    if index is None or index >= len(row):
        return None
    return row[index]


def cell_merge_span(sheet: Any, row_number: int, column_number: int) -> tuple[int, int] | None:
    merged_ranges = getattr(getattr(sheet, "merged_cells", None), "ranges", [])
    for merged_range in merged_ranges:
        if (
            merged_range.min_row <= row_number <= merged_range.max_row and
            merged_range.min_col <= column_number <= merged_range.max_col
        ):
            return merged_range.min_col - 1, merged_range.max_col - 1
    return None


def detect_task_name_columns(sheet: Any, header_row: int, mapping: dict[str, int]) -> list[int]:
    name_index = mapping.get("name")
    if name_index is None:
        return []

    merged_span = cell_merge_span(sheet, header_row + 1, name_index + 1)
    if merged_span:
        return list(range(merged_span[0], merged_span[1] + 1))

    later_mapped_indices = [
        index
        for field, index in mapping.items()
        if field != "name" and index > name_index
    ]
    if later_mapped_indices:
        return list(range(name_index, min(later_mapped_indices)))
    return [name_index]


def first_text_in_columns(row: tuple[Any, ...], column_indices: list[int]) -> str:
    for index in column_indices:
        if index < len(row):
            text = cell_to_text(row[index])
            if text:
                return text
    return ""


def infer_wbs_level(wbs: str, explicit_level: Any) -> int:
    explicit = parse_schedule_number(explicit_level)
    if explicit is not None and explicit >= 0:
        return int(explicit)
    if not wbs:
        return 0
    return len([part for part in re.split(r"[.\-_/]+", wbs) if part])


def infer_parent_wbs(wbs: str) -> str | None:
    if "." in wbs:
        parent = ".".join(wbs.split(".")[:-1]).strip()
        return parent or None
    return None


def parse_schedule_sheet(workbook: Any, workspace_id: str, source_path: Path) -> tuple[list[dict[str, Any]], dict[str, str]]:
    if "Schedule" not in workbook.sheetnames:
        raise WorkerError("schedule_sheet_missing", "Schedule sheet is missing.")
    sheet = workbook["Schedule"]
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        raise WorkerError("schedule_parse_failed", "Schedule sheet is empty.")
    header_row, mapping = detect_header_mapping(rows, SCHEDULE_COLUMN_ALIASES, {"wbs", "name"})
    name_columns = detect_task_name_columns(sheet, header_row, mapping)
    tasks: list[dict[str, Any]] = []
    for row_number, row in enumerate(rows[header_row + 1 :], start=header_row + 2):
        wbs = normalize_wbs(row_value(row, mapping, "wbs"))
        name = first_text_in_columns(row, name_columns)
        if not wbs and not name:
            continue
        if not name or name.lower() in {"summary", "total", "합계"}:
            continue
        task = {
            "taskId": f"{workspace_id}:{wbs or row_number}",
            "wbs": wbs or str(row_number),
            "level": infer_wbs_level(wbs, row_value(row, mapping, "level")),
            "name": name,
            "parentWbs": infer_parent_wbs(wbs),
            "isLeaf": True,
            "plannedStart": parse_schedule_date(row_value(row, mapping, "planned_start")),
            "plannedFinish": parse_schedule_date(row_value(row, mapping, "planned_finish")),
            "actualStart": parse_schedule_date(row_value(row, mapping, "actual_start")),
            "actualFinish": parse_schedule_date(row_value(row, mapping, "actual_finish")),
            "plannedWorkload": parse_schedule_number(row_value(row, mapping, "planned_workload")),
            "actualWorkload": parse_schedule_number(row_value(row, mapping, "actual_workload")),
            "plannedDuration": parse_schedule_number(row_value(row, mapping, "planned_duration")),
            "actualDuration": parse_schedule_number(row_value(row, mapping, "actual_duration")),
            "plannedProgress": parse_schedule_progress(row_value(row, mapping, "planned_progress")),
            "actualProgress": parse_schedule_progress(row_value(row, mapping, "actual_progress")),
            "resource": parse_resource_assignments(row_value(row, mapping, "resource")),
            "deliverable": cell_to_text(row_value(row, mapping, "deliverable")) or None,
            "calendar": cell_to_text(row_value(row, mapping, "calendar")) or None,
        }
        tasks.append(task)
    parent_wbs_values = {task["parentWbs"] for task in tasks if task["parentWbs"]}
    for task in tasks:
        task["isLeaf"] = task["wbs"] not in parent_wbs_values
    column_mapping = {field: cell_to_text(rows[header_row][index]) for field, index in mapping.items()}
    if name_columns:
        column_mapping["nameColumns"] = ",".join(str(index + 1) for index in name_columns)
    return tasks, column_mapping


def parse_calendar_sheet(workbook: Any) -> list[dict[str, Any]]:
    if "Calendar" not in workbook.sheetnames:
        return []
    rows = list(workbook["Calendar"].iter_rows(values_only=True))
    if not rows:
        return []
    try:
        header_row, mapping = detect_header_mapping(
            rows,
            {
                "date": ["date", "일자", "날짜"],
                "type": ["type", "구분", "근무구분", "휴일구분"],
                "calendar": ["calendar", "캘린더", "달력"],
                "name": ["name", "명칭", "휴일명", "비고"],
            },
            {"date"},
        )
    except WorkerError:
        return []
    result: list[dict[str, Any]] = []
    for row in rows[header_row + 1 :]:
        date = parse_schedule_date(row_value(row, mapping, "date"))
        if not date:
            continue
        type_text = cell_to_text(row_value(row, mapping, "type")).lower()
        day_type = "working"
        if "holiday" in type_text or "휴" in type_text:
            day_type = "holiday"
        elif "non" in type_text or "비" in type_text:
            day_type = "non-working"
        result.append({
            "date": date,
            "type": day_type,
            "calendar": cell_to_text(row_value(row, mapping, "calendar")) or None,
            "name": cell_to_text(row_value(row, mapping, "name")) or None,
        })
    return result


def parse_progress_sheet(workbook: Any) -> list[dict[str, Any]]:
    sheet_name = "Progress_Data" if "Progress_Data" in workbook.sheetnames else "Progress"
    if sheet_name not in workbook.sheetnames:
        return []
    rows = list(workbook[sheet_name].iter_rows(values_only=True))
    if not rows:
        return []
    try:
        header_row, mapping = detect_header_mapping(
            rows,
            {
                "date": ["date", "일자", "날짜"],
                "planned_workload": ["plannedworkload", "계획공수", "일일계획작업량"],
                "cumulative_planned_workload": ["cumulativeplannedworkload", "누적계획공수", "계획작업량누적"],
                "planned_progress": ["plannedprogress", "계획진척", "계획진도", "계획작업량진척률"],
                "earned_value": ["earnedvalue", "ev", "획득가치", "실적기성"],
                "cumulative_earned_value": ["cumulativeearnedvalue", "누적획득가치", "실적기성누적"],
                "actual_progress": ["actualprogress", "실적진척", "실제진척", "실적기성진척률"],
                "actual_workload": ["actualworkload", "실적공수", "일일실제투입작업량"],
                "cumulative_actual_workload": ["cumulativeactualworkload", "누적실적공수", "실제투입작업량누적"],
            },
            {"date"},
        )
    except WorkerError:
        return []
    points: list[dict[str, Any]] = []
    for row in rows[header_row + 1 :]:
        date = parse_schedule_date(row_value(row, mapping, "date"))
        if not date:
            continue
        points.append({
            "date": date,
            "plannedWorkload": parse_schedule_number(row_value(row, mapping, "planned_workload")),
            "cumulativePlannedWorkload": parse_schedule_number(row_value(row, mapping, "cumulative_planned_workload")),
            "plannedProgress": parse_schedule_progress(row_value(row, mapping, "planned_progress")),
            "earnedValue": parse_schedule_number(row_value(row, mapping, "earned_value")),
            "cumulativeEarnedValue": parse_schedule_number(row_value(row, mapping, "cumulative_earned_value")),
            "actualProgress": parse_schedule_progress(row_value(row, mapping, "actual_progress")),
            "actualWorkload": parse_schedule_number(row_value(row, mapping, "actual_workload")),
            "cumulativeActualWorkload": parse_schedule_number(row_value(row, mapping, "cumulative_actual_workload")),
        })
    return points


def parse_settings_sheet(workbook: Any) -> dict[str, Any]:
    if "Settings" not in workbook.sheetnames:
        return {}
    settings: dict[str, Any] = {}
    for row_index, row in enumerate(workbook["Settings"].iter_rows(values_only=True)):
        if not row or len(row) < 2:
            continue
        if row_index == 0 and normalize_schedule_header(row[1] if len(row) > 1 else None) == "item":
            continue
        key_index = 1 if len(row) > 2 and cell_to_text(row[1]) else 0
        value_index = 2 if key_index == 1 and len(row) > 2 else 1
        key = cell_to_text(row[key_index])
        if not key:
            continue
        value = row[value_index] if value_index < len(row) else None
        if hasattr(value, "isoformat"):
            settings[key] = parse_schedule_date(value)
        elif isinstance(value, (str, int, float, bool)) or value is None:
            settings[key] = value
        else:
            settings[key] = cell_to_text(value)
    return settings


def average_progress(tasks: list[dict[str, Any]], field: str) -> float | None:
    values = [task[field] for task in tasks if isinstance(task.get(field), (int, float))]
    if not values:
        return None
    return sum(float(value) for value in values) / len(values)


def is_active_task(task: dict[str, Any], as_of_date: str) -> bool:
    planned_start = task.get("plannedStart")
    planned_finish = task.get("plannedFinish")
    actual_finish = task.get("actualFinish")
    if actual_finish:
        return False
    if planned_start and planned_start <= as_of_date and (not planned_finish or planned_finish >= as_of_date):
        return True
    progress = task.get("actualProgress")
    return isinstance(progress, (int, float)) and 0 < float(progress) < 1


def is_delayed_task(task: dict[str, Any], as_of_date: str) -> bool:
    planned_finish = task.get("plannedFinish")
    actual_finish = task.get("actualFinish")
    actual_progress = task.get("actualProgress")
    if not planned_finish or planned_finish >= as_of_date:
        return False
    completed = bool(actual_finish) or (
        isinstance(actual_progress, (int, float)) and float(actual_progress) >= 1
    )
    return not completed


def schedule_summary(schedule: dict[str, Any], source: dict[str, Any], as_of_date: str | None = None) -> dict[str, Any]:
    now_date = as_of_date or datetime.now().date().isoformat()
    tasks = schedule.get("tasks", [])
    leaf_tasks = [task for task in tasks if task.get("isLeaf")]
    active_tasks = [task for task in tasks if is_active_task(task, now_date)]
    active_leaf_tasks = [task for task in leaf_tasks if is_active_task(task, now_date)]
    delayed_wbs_nodes = [task for task in tasks if is_delayed_task(task, now_date)]
    delayed_leaf_tasks = [task for task in leaf_tasks if is_delayed_task(task, now_date)]
    progress_series = schedule.get("progressSeries", [])
    last_progress = progress_series[-1] if progress_series else {}
    return {
        "workspaceId": schedule["workspaceId"],
        "filename": schedule["filename"],
        "modifiedAt": source["modifiedAt"],
        "lastParsedAt": source.get("lastParsedAt") or now_iso(),
        "parseStatus": source.get("parseStatus", "parsed"),
        "taskCount": len(tasks),
        "leafTaskCount": len(leaf_tasks),
        "activeTaskCount": len(active_leaf_tasks),
        "activeWbsNodeCount": len(active_tasks),
        "activeLeafTaskCount": len(active_leaf_tasks),
        "delayedTaskCount": len(delayed_leaf_tasks),
        "delayedWbsNodeCount": len(delayed_wbs_nodes),
        "plannedProgress": last_progress.get("plannedProgress") if last_progress else average_progress(tasks, "plannedProgress"),
        "actualProgress": last_progress.get("actualProgress") if last_progress else average_progress(tasks, "actualProgress"),
        "progressAsOfDate": now_date,
        "projectStart": schedule.get("projectStart"),
        "projectFinish": schedule.get("projectFinish"),
        "parsedSheets": schedule.get("parsedSheets", []),
        "source": source,
    }


def parse_schedule(input_data: dict[str, Any]) -> dict[str, Any]:
    workspace_id = input_data.get("workspace_id")
    if not isinstance(workspace_id, str) or not workspace_id.strip():
        raise WorkerError("invalid_input", "workspace_id is required.")
    source_path = schedule_source_path(input_data)
    try:
        from openpyxl import load_workbook  # type: ignore
    except ImportError as error:
        raise WorkerError("schedule_parse_failed", "openpyxl is required to parse Schedule Excel files.") from error
    try:
        workbook = load_workbook(source_path, read_only=False, data_only=True, keep_vba=False)
        sheet_names = list(workbook.sheetnames)
        tasks, column_mapping = parse_schedule_sheet(workbook, workspace_id, source_path)
        calendars = parse_calendar_sheet(workbook)
        progress_series = parse_progress_sheet(workbook)
        settings = parse_settings_sheet(workbook)
    except WorkerError:
        raise
    except Exception as error:
        raise WorkerError("schedule_parse_failed", "Schedule workbook parsing failed.") from error
    finally:
        try:
            workbook.close()
        except Exception:
            pass

    planned_starts = [task["plannedStart"] for task in tasks if task.get("plannedStart")]
    planned_finishes = [task["plannedFinish"] for task in tasks if task.get("plannedFinish")]
    project_start = parse_schedule_date(settings.get("project start") or settings.get("project_start")) or (min(planned_starts) if planned_starts else None)
    project_finish = parse_schedule_date(settings.get("project finish") or settings.get("project_finish")) or (max(planned_finishes) if planned_finishes else None)
    parsed_sheets = [
        sheet_name
        for sheet_name in ["Schedule", "Calendar", "Progress", "Progress_Data", "Settings"]
        if sheet_name in sheet_names
    ]
    source = {
        "workspaceId": workspace_id,
        "sourcePath": str(source_path),
        "filename": source_path.name,
        "fileSize": source_path.stat().st_size,
        "modifiedAt": datetime.fromtimestamp(source_path.stat().st_mtime, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "lastParsedAt": now_iso(),
        "parseStatus": "parsed",
    }
    schedule = {
        "workspaceId": workspace_id,
        "sourceFile": str(source_path),
        "filename": source_path.name,
        "projectStart": project_start,
        "projectFinish": project_finish,
        "tasks": tasks,
        "calendars": calendars,
        "progressSeries": progress_series,
        "settings": settings,
        "parsedSheets": parsed_sheets,
        "columnMapping": column_mapping,
    }
    return {
        "source": source,
        "schedule": schedule,
        "summary": schedule_summary(schedule, source),
        "fromCache": False,
    }


def schedule_register(input_data: dict[str, Any]) -> dict[str, Any]:
    workspace_id = input_data.get("workspace_id")
    if not isinstance(workspace_id, str) or not workspace_id.strip():
        raise WorkerError("invalid_input", "workspace_id is required.")
    source_path = schedule_source_path(input_data)
    stats = source_path.stat()
    return {
        "workspaceId": workspace_id,
        "sourcePath": str(source_path),
        "filename": source_path.name,
        "fileSize": stats.st_size,
        "modifiedAt": datetime.fromtimestamp(stats.st_mtime, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "lastParsedAt": None,
        "parseStatus": "registered",
    }


def compact_task(task: dict[str, Any]) -> str:
    resources = ", ".join(item.get("name", "") for item in task.get("resource", []) if item.get("name"))
    parts = [
        f"WBS: {task.get('wbs')}",
        f"Task: {task.get('name')}",
        f"Planned Finish: {task.get('plannedFinish') or '-'}",
        f"Actual Finish: {task.get('actualFinish') or '-'}",
        f"Planned Progress: {format_percent(task.get('plannedProgress'))}",
        f"Actual Progress: {format_percent(task.get('actualProgress'))}",
    ]
    if resources:
        parts.append(f"Resource: {resources}")
    return " | ".join(parts)


def format_percent(value: Any) -> str:
    if not isinstance(value, (int, float)):
        return "-"
    return f"{round(float(value) * 100, 1)}%"


def schedule_context_text(kind: str, summary: dict[str, Any], tasks: list[dict[str, Any]]) -> str:
    lines = [
        "[SCHEDULE CONTEXT]",
        f"Source: {summary['filename']}",
        f"Last Parsed: {summary['lastParsedAt']}",
        f"Project Start: {summary.get('projectStart') or '-'}",
        f"Project Finish: {summary.get('projectFinish') or '-'}",
        "Project Progress",
        f"Planned: {format_percent(summary.get('plannedProgress'))}",
        f"Actual: {format_percent(summary.get('actualProgress'))}",
        f"Tasks: {summary['taskCount']}",
        f"Active Tasks: {summary['activeTaskCount']}",
        f"Delayed Tasks: {summary['delayedTaskCount']}",
        f"Query Result: {kind}",
    ]
    if tasks:
        lines.append("Tasks")
        for index, task in enumerate(tasks[:20], start=1):
            lines.append(f"{index}. {compact_task(task)}")
    else:
        lines.append("Tasks: No matching schedule tasks.")
    lines.append("[/SCHEDULE CONTEXT]")
    return "\n".join(lines)


def normalize_schedule_lookup_text(value: Any) -> str:
    return re.sub(r"\s+", "", cell_to_text(value)).lower()


def strip_query_noise(query: str) -> str:
    text = re.sub(r"[?？!！.。]+", " ", cell_to_text(query))
    for token in [
        "알려줘",
        "알려 주세요",
        "보여줘",
        "보여 주세요",
        "무엇인가",
        "무엇이야",
        "어떻게 되어 있어",
        "어떻게 돼",
    ]:
        text = text.replace(token, " ")
    return re.sub(r"\s+", " ", text).strip()


def extract_resource_lookup_target(query: str) -> str | None:
    text = strip_query_noise(query)
    match = re.search(
        r"(.+?)\s*(?:담당\s*작업|담당자|담당|resource|리소스)",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    target = match.group(1).strip()
    return target or None


def resource_matches_target(task: dict[str, Any], target: str) -> bool:
    normalized_target = normalize_schedule_lookup_text(target)
    if not normalized_target:
        return False
    return any(
        normalize_schedule_lookup_text(resource.get("name")) == normalized_target
        for resource in task.get("resource", [])
        if isinstance(resource, dict)
    )


def collect_schedule_resource_names(tasks: list[dict[str, Any]]) -> list[str]:
    names: dict[str, str] = {}
    for task in tasks:
        for resource in task.get("resource", []):
            if not isinstance(resource, dict):
                continue
            name = cell_to_text(resource.get("name"))
            normalized = normalize_schedule_lookup_text(name)
            if normalized and normalized not in names:
                names[normalized] = name
    return sorted(names.values(), key=len, reverse=True)


def find_resource_entity(query: str, tasks: list[dict[str, Any]]) -> str | None:
    normalized_query = normalize_schedule_lookup_text(query)
    for name in collect_schedule_resource_names(tasks):
        if normalize_schedule_lookup_text(name) in normalized_query:
            return name
    return None


def extract_task_lookup_target(query: str) -> str | None:
    text = strip_query_noise(query)
    text = re.sub(r"\b(?:schedule|task|wbs)\b", " ", text, flags=re.IGNORECASE)
    for token in [
        "일정은",
        "일정",
        "작업은",
        "작업",
        "진척은",
        "진척",
        "진도는",
        "진도",
        "계획은",
        "계획",
        "상태는",
        "상태",
    ]:
        text = text.replace(token, " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def find_task_entity(query: str, tasks: list[dict[str, Any]]) -> tuple[str, str] | tuple[None, None]:
    normalized_query = normalize_schedule_lookup_text(query)
    task_entities: list[tuple[str, str]] = []
    for task in tasks:
        wbs = cell_to_text(task.get("wbs"))
        name = cell_to_text(task.get("name"))
        if wbs:
            task_entities.append(("wbs", wbs))
        if name:
            task_entities.append(("task", name))
    task_entities.sort(key=lambda item: len(item[1]), reverse=True)
    for entity_type, value in task_entities:
        normalized_value = normalize_schedule_lookup_text(value)
        if normalized_value and normalized_value in normalized_query:
            return entity_type, value
    return None, None


def lookup_tasks_by_name_or_wbs(tasks: list[dict[str, Any]], target: str) -> list[dict[str, Any]]:
    normalized_target = normalize_schedule_lookup_text(target)
    if not normalized_target:
        return []
    exact = [
        task
        for task in tasks
        if normalize_schedule_lookup_text(task.get("wbs")) == normalized_target
        or normalize_schedule_lookup_text(task.get("name")) == normalized_target
    ]
    if exact:
        return exact
    return [
        task
        for task in tasks
        if normalized_target in normalize_schedule_lookup_text(task.get("wbs"))
        or normalized_target in normalize_schedule_lookup_text(task.get("name"))
    ]


def is_completed_task(task: dict[str, Any]) -> bool:
    actual_progress = task.get("actualProgress")
    return bool(task.get("actualFinish")) or (
        isinstance(actual_progress, (int, float)) and float(actual_progress) >= 1
    )


def is_not_started_task(task: dict[str, Any]) -> bool:
    actual_progress = task.get("actualProgress")
    has_progress = isinstance(actual_progress, (int, float)) and float(actual_progress) > 0
    return not task.get("actualStart") and not has_progress and not task.get("actualFinish")


def schedule_task_status(task: dict[str, Any], as_of_date: str) -> str:
    if is_completed_task(task):
        return "completed"
    if is_delayed_task(task, as_of_date):
        return "delayed"
    if is_active_task(task, as_of_date):
        return "active"
    if is_not_started_task(task):
        return "not_started"
    return "in_progress"


def matching_resource_allocation(task: dict[str, Any], target: str | None) -> float | None:
    if not target:
        return None
    normalized_target = normalize_schedule_lookup_text(target)
    for resource in task.get("resource", []):
        if not isinstance(resource, dict):
            continue
        if normalize_schedule_lookup_text(resource.get("name")) == normalized_target:
            allocation = resource.get("allocation")
            return float(allocation) if isinstance(allocation, (int, float)) else None
    return None


def analyze_schedule_tasks(
    tasks: list[dict[str, Any]],
    as_of_date: str,
    resource_target: str | None = None,
) -> list[dict[str, Any]]:
    analyses: list[dict[str, Any]] = []
    for task in tasks:
        is_completed = is_completed_task(task)
        is_delayed = bool(task.get("isLeaf")) and is_delayed_task(task, as_of_date)
        is_active = is_active_task(task, as_of_date)
        analyses.append({
            "taskId": task.get("taskId"),
            "wbs": task.get("wbs"),
            "name": task.get("name"),
            "allocation": matching_resource_allocation(task, resource_target),
            "plannedStart": task.get("plannedStart"),
            "plannedFinish": task.get("plannedFinish"),
            "actualStart": task.get("actualStart"),
            "actualFinish": task.get("actualFinish"),
            "actualProgress": task.get("actualProgress"),
            "isActive": is_active,
            "isDelayed": is_delayed,
            "isCompleted": is_completed,
            "status": schedule_task_status(task, as_of_date),
        })
    return analyses


def summarize_task_analyses(analyses: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "totalTasks": len(analyses),
        "completedTasks": sum(1 for item in analyses if item.get("status") == "completed"),
        "activeTasks": sum(1 for item in analyses if item.get("status") in {"active", "in_progress"}),
        "delayedTasks": sum(1 for item in analyses if item.get("status") == "delayed"),
        "notStartedTasks": sum(1 for item in analyses if item.get("status") == "not_started"),
    }


def query_requests_status(query: str) -> bool:
    query_text = query.lower()
    return any(
        token in query_text
        for token in [
            "진행",
            "진척",
            "진도",
            "상태",
            "지연",
            "지체",
            "잘",
            "status",
            "progress",
            "delay",
            "delayed",
            "active",
        ]
    )


def schedule_query(input_data: dict[str, Any]) -> dict[str, Any]:
    schedule = input_data.get("schedule")
    source = input_data.get("source")
    query = input_data.get("query")
    as_of_date = input_data.get("as_of_date") or datetime.now().date().isoformat()
    if not isinstance(schedule, dict) or not isinstance(source, dict) or not isinstance(query, str):
        raise WorkerError("invalid_input", "schedule, source, and query are required.")

    query_text = query.lower()
    tasks = schedule.get("tasks", [])
    selected = tasks
    kind = "summary"
    target = None
    detected_entity_type = None
    detected_entity = None
    task_analyses: list[dict[str, Any]] = []
    resource_status_summary = None

    resource_entity = find_resource_entity(query, tasks)
    task_entity_type, task_entity = find_task_entity(query, tasks)

    if resource_entity:
        target = resource_entity
        detected_entity_type = "resource"
        detected_entity = resource_entity
        selected = [task for task in tasks if resource_matches_target(task, resource_entity)]
        if query_requests_status(query):
            kind = "resource_status"
            task_analyses = analyze_schedule_tasks(selected, as_of_date, resource_entity)
            resource_status_summary = summarize_task_analyses(task_analyses)
        else:
            kind = "resource_lookup"
    elif task_entity:
        target = task_entity
        detected_entity_type = task_entity_type
        detected_entity = task_entity
        selected = lookup_tasks_by_name_or_wbs(tasks, task_entity)
        kind = "task_status" if query_requests_status(query) else "task_lookup"
        if kind == "task_status":
            task_analyses = analyze_schedule_tasks(selected, as_of_date)
    elif any(token in query_text for token in ["지연", "지체", "delay", "delayed"]):
        selected = [
            task
            for task in tasks
            if task.get("isLeaf") and is_delayed_task(task, as_of_date)
        ]
        kind = "delayed_tasks"
    elif any(token in query_text for token in ["진행", "active", "현재", "착수 중"]):
        selected = [task for task in tasks if is_active_task(task, as_of_date)]
        kind = "active_tasks"
    elif any(token in query_text for token in ["완료", "finish", "finishing", "종료"]):
        selected = [
            task
            for task in tasks
            if task.get("plannedFinish") and task["plannedFinish"] >= as_of_date
        ]
        selected = sorted(selected, key=lambda task: task.get("plannedFinish") or "")[:20]
        kind = "finishing_between"
    elif any(token in query_text for token in ["착수", "start", "starting"]):
        selected = [
            task
            for task in tasks
            if task.get("plannedStart") and task["plannedStart"] >= as_of_date
        ]
        selected = sorted(selected, key=lambda task: task.get("plannedStart") or "")[:20]
        kind = "starting_between"
    elif any(token in query_text for token in ["담당", "resource", "리소스"]):
        target = extract_resource_lookup_target(query)
        selected = (
            [task for task in tasks if resource_matches_target(task, target)]
            if target
            else [task for task in tasks if task.get("resource")]
        )
        kind = "resource_lookup"
    elif "wbs" in query_text or "작업" in query_text or "일정" in query_text:
        target = extract_task_lookup_target(query)
        selected = lookup_tasks_by_name_or_wbs(tasks, target) if target else []
        kind = "task_lookup"

    summary = schedule_summary(schedule, source, as_of_date)
    if not task_analyses and kind in {"resource_lookup", "task_lookup"}:
        task_analyses = analyze_schedule_tasks(
            selected[:20],
            as_of_date,
            target if kind == "resource_lookup" else None,
        )
    return {
        "kind": kind,
        "target": target,
        "detectedEntityType": detected_entity_type,
        "detectedEntity": detected_entity,
        "detectedIntent": kind,
        "resourceStatusSummary": resource_status_summary,
        "taskAnalyses": task_analyses[:20],
        "workspaceId": schedule["workspaceId"],
        "filename": schedule["filename"],
        "lastParsedAt": summary["lastParsedAt"],
        "asOfDate": as_of_date,
        "summary": summary,
        "tasks": selected[:20],
        "contextText": schedule_context_text(kind, summary, selected),
    }


def schedule_summary_command(input_data: dict[str, Any]) -> dict[str, Any]:
    schedule = input_data.get("schedule")
    source = input_data.get("source")
    if not isinstance(schedule, dict) or not isinstance(source, dict):
        raise WorkerError("invalid_input", "schedule and source are required.")
    return schedule_summary(schedule, source, input_data.get("as_of_date"))


COMMANDS = {
    "runtime-check": runtime_check,
    "embedding-check": check_embedding_status,
    "rag-import": import_document,
    "rag-list": list_documents,
    "rag-delete": delete_document,
    "rag-replace": replace_document,
    "rag-index": index_document,
    "rag-search": search_documents,
    "schedule-register": schedule_register,
    "schedule-parse": parse_schedule,
    "schedule-summary": schedule_summary_command,
    "schedule-query": schedule_query,
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Mimora local worker")
    parser.add_argument("command", choices=COMMANDS.keys())
    args = parser.parse_args()
    try:
        input_data = read_input()
        write_success(COMMANDS[args.command](input_data))
    except WorkerError as error:
        write_error(error)
    except Exception as error:
        print(f"Unhandled worker error: {error}", file=sys.stderr)
        write_error(WorkerError("worker_failed", "Python worker failed."))


if __name__ == "__main__":
    main()
