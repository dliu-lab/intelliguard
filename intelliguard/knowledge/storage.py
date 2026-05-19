from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from uuid import uuid4


CODE_SUFFIXES = {
    ".c",
    ".cpp",
    ".cs",
    ".go",
    ".h",
    ".hpp",
    ".java",
    ".js",
    ".jsx",
    ".php",
    ".py",
    ".rb",
    ".rs",
    ".sql",
    ".ts",
    ".tsx",
}
VECTOR_INDEXABLE_SUFFIXES = {
    ".txt",
    ".md",
    ".pdf",
    ".docx",
    ".json",
    ".html",
    ".htm",
    ".yaml",
    ".yml",
} | CODE_SUFFIXES
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

DOCUMENT_CONTENT_TYPES = {
    "text/plain": ".txt",
    "text/markdown": ".md",
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/json": ".json",
    "text/html": ".html",
    "application/xhtml+xml": ".html",
    "application/x-yaml": ".yaml",
    "text/yaml": ".yaml",
    "text/x-python": ".py",
    "text/javascript": ".js",
    "application/javascript": ".js",
    "text/typescript": ".ts",
    "text/x-java-source": ".java",
    "text/x-c": ".c",
    "text/x-c++": ".cpp",
    "text/x-go": ".go",
    "text/x-rust": ".rs",
    "text/x-ruby": ".rb",
    "text/x-php": ".php",
    "application/sql": ".sql",
}

IMAGE_CONTENT_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

SUPPORTED_CONTENT_TYPES = DOCUMENT_CONTENT_TYPES | IMAGE_CONTENT_TYPES
SUPPORTED_SUFFIXES = VECTOR_INDEXABLE_SUFFIXES | IMAGE_SUFFIXES


def is_image_file(file_name: str, content_type: str = "") -> bool:
    suffix = Path(file_name or "").suffix.lower()
    return suffix in IMAGE_SUFFIXES or content_type in IMAGE_CONTENT_TYPES


@dataclass(frozen=True)
class StoredKnowledgeFile:
    file_name: str
    content_type: str
    storage_uri: str
    path: str
    size_bytes: int
    checksum: str


class KnowledgeFileStorage:
    def __init__(self, upload_dir: str | Path) -> None:
        self.upload_dir = Path(upload_dir)

    def save_upload(
        self, *, kb_id: str, file_name: str, content_type: str, data: bytes
    ) -> StoredKnowledgeFile:
        if not data:
            raise ValueError("Uploaded file is empty")

        safe_name = self._safe_file_name(file_name)
        suffix = Path(safe_name).suffix.lower()
        normalized_content_type = content_type or self._content_type_for_suffix(suffix)
        if (
            suffix not in SUPPORTED_SUFFIXES
            or normalized_content_type not in SUPPORTED_CONTENT_TYPES
        ):
            raise ValueError("Unsupported file type")

        digest = sha256(data).hexdigest()
        target_dir = self.upload_dir / self._safe_path_segment(kb_id)
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{uuid4().hex}_{safe_name}"
        target.write_bytes(data)
        return StoredKnowledgeFile(
            file_name=safe_name,
            content_type=normalized_content_type,
            storage_uri=f"file://{target}",
            path=str(target),
            size_bytes=len(data),
            checksum=digest,
        )

    @staticmethod
    def _safe_file_name(file_name: str) -> str:
        normalized = (file_name or "upload.txt").replace("\\", "/")
        name = Path(normalized).name.strip()
        return name or "upload.txt"

    @staticmethod
    def _safe_path_segment(value: str) -> str:
        segment = "".join(
            character if character.isalnum() or character in {"-", "_", "."} else "_"
            for character in value.strip()
        )
        return segment or "knowledge-base"

    @staticmethod
    def _content_type_for_suffix(suffix: str) -> str:
        if suffix == ".txt":
            return "text/plain"
        if suffix == ".md":
            return "text/markdown"
        if suffix == ".pdf":
            return "application/pdf"
        if suffix == ".docx":
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if suffix == ".json":
            return "application/json"
        if suffix in {".html", ".htm"}:
            return "text/html"
        if suffix in {".yaml", ".yml"}:
            return "text/yaml"
        if suffix == ".py":
            return "text/x-python"
        if suffix in {".js", ".jsx"}:
            return "text/javascript"
        if suffix in {".ts", ".tsx"}:
            return "text/typescript"
        if suffix == ".java":
            return "text/x-java-source"
        if suffix in {".c", ".h"}:
            return "text/x-c"
        if suffix in {".cpp", ".hpp"}:
            return "text/x-c++"
        if suffix == ".go":
            return "text/x-go"
        if suffix == ".rs":
            return "text/x-rust"
        if suffix == ".rb":
            return "text/x-ruby"
        if suffix == ".php":
            return "text/x-php"
        if suffix == ".sql":
            return "application/sql"
        if suffix == ".png":
            return "image/png"
        if suffix in {".jpg", ".jpeg"}:
            return "image/jpeg"
        if suffix == ".webp":
            return "image/webp"
        if suffix == ".gif":
            return "image/gif"
        return ""
