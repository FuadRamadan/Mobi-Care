# MobiCare Database Documentation

Generated from the development PostgreSQL database schema. This package contains **structure only** and no database records.

## Contents

- `schema-only.sql` — complete PostgreSQL DDL, without ownership, privileges, or row data.
- `diagrams/er-diagram.svg` — downloadable visual ER diagram.
- `diagrams/er-diagram.mmd` — editable Mermaid ER diagram source.
- `data-dictionary.md` — human-readable table and column reference.
- `database-reference.html` — self-contained browsable database reference.
- `metadata/*.csv` — columns, constraints, foreign keys, indexes, triggers, views, and enums.
- `migrations/*.sql` — project migration history.
- `model-sources/` — Drizzle ORM schema source and configuration.

## Summary

- Tables: 28
- Columns: 293
- Foreign keys: 28
- Indexes: 45
- Triggers: 3
- Views: 0
- Enum values: 75

## Safety

No `INSERT`, `COPY ... FROM`, table row data, database credentials, ownership statements, or grants are included. The SQL file is a schema-only export.
