from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from uuid import uuid4


SUPPORTED_CONTENT_TYPES = {
    "text/plain": ".txt",
    "text/markdown": ".md",
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
}

SUPPORTED_SUFFIXES = {".txt", ".md", ".pdf", ".docx"}


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
        if suffix not in SUPPORTED_SUFFIXES or normalized_content_type not in SUPPORTED_CONTENT_TYPES:
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
        return ""
