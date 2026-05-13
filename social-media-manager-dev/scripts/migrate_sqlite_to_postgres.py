from __future__ import annotations

import argparse
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Boolean, DateTime, create_engine, inspect, text


BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SQLITE_PATH = BASE_DIR / "instance" / "social_media_manager.db"
DEFAULT_DATABASE_URL = "postgresql+psycopg://postgres:EAVEplay!%23%25%262468@localhost:5432/some_auto"
TABLE_ORDER = [
    "user",
    "app_setting",
    "page",
    "page_setting",
    "social_account",
    "post",
    "planning_sheet",
    "planning_row",
    "social_insight",
]


def normalize_database_url(raw_url: str) -> str:
    cleaned = raw_url.strip()
    if cleaned.startswith("postgres://"):
        return "postgresql+psycopg://" + cleaned.removeprefix("postgres://")
    if cleaned.startswith("postgresql://") and "+psycopg" not in cleaned.split("://", 1)[0]:
        return "postgresql+psycopg://" + cleaned.removeprefix("postgresql://")
    if cleaned.startswith("postgresql") and "connect_timeout=" not in cleaned:
        separator = "&" if "?" in cleaned else "?"
        cleaned = f"{cleaned}{separator}connect_timeout=10"
    return cleaned


def target_database_url() -> str:
    return normalize_database_url(os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL))


def source_tables(connection: sqlite3.Connection) -> set[str]:
    rows = connection.execute(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'"
    ).fetchall()
    return {str(row[0]) for row in rows}


def source_columns(connection: sqlite3.Connection, table_name: str) -> list[str]:
    rows = connection.execute(f'pragma table_info("{table_name}")').fetchall()
    return [str(row[1]) for row in rows]


def table_count_sqlite(connection: sqlite3.Connection, table_name: str) -> int:
    return int(connection.execute(f'select count(*) from "{table_name}"').fetchone()[0])


def source_id_set(connection: sqlite3.Connection, table_name: str) -> set[Any]:
    if table_name not in source_tables(connection):
        return set()
    return {row[0] for row in connection.execute(f'select id from "{table_name}"').fetchall()}


def parse_datetime(value: Any) -> Any:
    if not isinstance(value, str) or not value.strip():
        return value
    cleaned = value.strip()
    try:
        return datetime.fromisoformat(cleaned)
    except ValueError:
        return value


def normalize_value(value: Any, column_type: Any) -> Any:
    if value is None:
        return None
    if isinstance(column_type, Boolean):
        return bool(value)
    if isinstance(column_type, DateTime):
        return parse_datetime(value)
    return value


def migrate_table(
    sqlite_connection: sqlite3.Connection,
    postgres_connection: Any,
    table_name: str,
    target_columns: dict[str, Any],
    valid_references: dict[str, set[Any]],
) -> int:
    available_source_columns = set(source_columns(sqlite_connection, table_name))
    copy_columns = [column for column in target_columns if column in available_source_columns]
    if not copy_columns:
        return 0

    select_columns = ", ".join(f'"{column}"' for column in copy_columns)
    rows = sqlite_connection.execute(f'select {select_columns} from "{table_name}"').fetchall()
    if not rows:
        return 0

    bind_columns = ", ".join(f'"{column}"' for column in copy_columns)
    bind_values = ", ".join(f":{column}" for column in copy_columns)
    insert_statement = text(f'insert into "{table_name}" ({bind_columns}) values ({bind_values})')

    payload = []
    for row in rows:
        if any(row[column] is not None and row[column] not in valid_ids for column, valid_ids in valid_references.items()):
            continue
        payload.append(
            {
                column: normalize_value(row[column], target_columns[column])
                for column in copy_columns
            }
        )
    postgres_connection.execute(insert_statement, payload)
    return len(payload)


def reset_sequence(postgres_connection: Any, table_name: str) -> None:
    sequence_name = postgres_connection.execute(
        text("select pg_get_serial_sequence(:table_name, 'id')"),
        {"table_name": f'"{table_name}"'},
    ).scalar()
    if not sequence_name:
        return
    max_id = postgres_connection.execute(text(f'select max(id) from "{table_name}"')).scalar()
    if max_id is None:
        postgres_connection.execute(text("select setval(:sequence_name, 1, false)"), {"sequence_name": sequence_name})
    else:
        postgres_connection.execute(text("select setval(:sequence_name, :value, true)"), {"sequence_name": sequence_name, "value": max_id})


def migrate(sqlite_path: Path, database_url: str, *, replace: bool) -> None:
    if not sqlite_path.is_file():
        raise SystemExit(f"SQLite source does not exist: {sqlite_path}")
    if not database_url.startswith("postgresql"):
        raise SystemExit("Target DATABASE_URL must be PostgreSQL.")

    sqlite_connection = sqlite3.connect(sqlite_path)
    sqlite_connection.row_factory = sqlite3.Row

    engine = create_engine(
        database_url,
        pool_pre_ping=True,
        future=True,
    )
    inspector = inspect(engine)
    target_tables = set(inspector.get_table_names())
    sqlite_tables = source_tables(sqlite_connection)
    tables = [table for table in TABLE_ORDER if table in sqlite_tables and table in target_tables]
    if not tables:
        raise SystemExit("No matching source/target tables found.")
    target_columns_by_table = {
        table: {
            column["name"]: column["type"]
            for column in inspector.get_columns(table)
        }
        for table in tables
    }
    valid_ids = {
        "page": source_id_set(sqlite_connection, "page"),
        "post": source_id_set(sqlite_connection, "post"),
        "planning_sheet": source_id_set(sqlite_connection, "planning_sheet"),
        "social_account": source_id_set(sqlite_connection, "social_account"),
    }
    valid_references_by_table = {
        "page_setting": {"page_id": valid_ids["page"]},
        "social_account": {"page_id": valid_ids["page"]},
        "post": {"page_id": valid_ids["page"]},
        "planning_sheet": {"page_id": valid_ids["page"]},
        "planning_row": {"sheet_id": valid_ids["planning_sheet"], "scheduled_post_id": valid_ids["post"]},
        "social_insight": {"social_account_id": valid_ids["social_account"]},
    }

    with engine.begin() as postgres_connection:
        postgres_connection.execute(text("set local lock_timeout = '10s'"))
        postgres_connection.execute(text("set local statement_timeout = '5min'"))
        if replace:
            truncate_tables = ", ".join(f'"{table}"' for table in reversed(tables))
            print(f"Replacing PostgreSQL data in {len(tables)} tables...", flush=True)
            postgres_connection.execute(text(f"truncate table {truncate_tables} restart identity cascade"))

        migrated_counts: dict[str, int] = {}
        for table in tables:
            print(f"Migrating {table}...", flush=True)
            migrated_counts[table] = migrate_table(
                sqlite_connection,
                postgres_connection,
                table,
                target_columns_by_table[table],
                valid_references_by_table.get(table, {}),
            )

        for table in tables:
            reset_sequence(postgres_connection, table)

        print("Migrated rows:")
        for table in tables:
            source_count = table_count_sqlite(sqlite_connection, table)
            target_count = postgres_connection.execute(text(f'select count(*) from "{table}"')).scalar()
            print(f"{table}: source={source_count} migrated={migrated_counts[table]} target={target_count}")

    sqlite_connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Copy MSS SoME-Auto data from SQLite to PostgreSQL.")
    parser.add_argument("--sqlite", default=str(DEFAULT_SQLITE_PATH), help="Path to the old SQLite database.")
    parser.add_argument("--database-url", default=target_database_url(), help="Target PostgreSQL SQLAlchemy URL.")
    parser.add_argument("--append", action="store_true", help="Append instead of replacing target table data.")
    args = parser.parse_args()

    migrate(Path(args.sqlite).resolve(), normalize_database_url(args.database_url), replace=not args.append)


if __name__ == "__main__":
    main()
