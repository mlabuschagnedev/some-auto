from __future__ import annotations

from datetime import datetime
import io
import os
from pathlib import Path
import sqlite3
import sys
from zipfile import ZIP_DEFLATED, ZipFile


EXCLUDED_DIR_NAMES = {
    ".git",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    "backups",
}
EXCLUDED_FILE_NAMES = {
    "backup.exe",
}
EXCLUDED_SUFFIXES = {
    ".pyc",
    ".pyo",
}


def project_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def backup_output_dir(root: Path) -> Path:
    target = root / "backups"
    target.mkdir(parents=True, exist_ok=True)
    return target


def timestamp_label() -> str:
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S")


def should_skip(path: Path, root: Path) -> bool:
    try:
        relative_parts = path.resolve().relative_to(root.resolve()).parts
    except Exception:
        return True

    if any(part in EXCLUDED_DIR_NAMES for part in relative_parts[:-1]):
        return True
    if path.name in EXCLUDED_FILE_NAMES:
        return True
    if path.suffix.lower() in EXCLUDED_SUFFIXES:
        return True
    return False


def iter_project_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if should_skip(path, root):
            continue
        files.append(path)
    return sorted(files)


def read_sqlite_backup_bytes(db_path: Path) -> bytes:
    temp_db = sqlite3.connect(":memory:")
    source_db = sqlite3.connect(str(db_path))
    try:
        source_db.backup(temp_db)
        buffer = io.BytesIO()
        for line in temp_db.iterdump():
            buffer.write(f"{line}\n".encode("utf-8"))
        return buffer.getvalue()
    finally:
        source_db.close()
        temp_db.close()


def add_sqlite_snapshot(zip_file: ZipFile, root: Path, db_path: Path) -> None:
    relative = db_path.relative_to(root).as_posix()
    snapshot_sql = read_sqlite_backup_bytes(db_path)
    sql_name = relative.removesuffix(".db") + "_sqlite_backup.sql"
    zip_file.writestr(sql_name, snapshot_sql)
    zip_file.write(db_path, relative)


def build_manifest(root: Path, archived_files: list[str]) -> str:
    lines = [
        "SoMe-Auto backup manifest",
        f"created_at={datetime.now().isoformat()}",
        f"project_root={root}",
        f"file_count={len(archived_files)}",
        "",
        "files:",
    ]
    lines.extend(archived_files)
    return "\n".join(lines)


def create_backup() -> Path:
    root = project_root()
    output_dir = backup_output_dir(root)
    archive_path = output_dir / f"SoMe-Auto-backup_{timestamp_label()}.zip"

    files = iter_project_files(root)
    archived_files: list[str] = []
    db_relative = "social-media-manager/instance/social_media_manager.db"
    db_path = root / db_relative

    with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as zip_file:
        for file_path in files:
            relative = file_path.relative_to(root).as_posix()
            if relative == db_relative and db_path.exists():
                add_sqlite_snapshot(zip_file, root, db_path)
                archived_files.append(relative)
                archived_files.append(relative.removesuffix(".db") + "_sqlite_backup.sql")
                continue
            zip_file.write(file_path, relative)
            archived_files.append(relative)

        zip_file.writestr("backup_manifest.txt", build_manifest(root, archived_files))

    return archive_path


def main() -> int:
    try:
        archive_path = create_backup()
    except Exception as error:
        print(f"Backup failed: {error}", file=sys.stderr)
        return 1

    print(f"Backup created: {archive_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
