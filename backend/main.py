import os
from typing import Any
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select, insert, update, and_, or_, cast, String, func
from sqlalchemy.exc import SQLAlchemyError

from database import engine, get_inspector, get_table

app = FastAPI(title="MySQL Admin API", version="1.0.0")

origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RowPayload(BaseModel):
    values: dict[str, Any]


class UpdatePayload(BaseModel):
    pk: dict[str, Any]
    values: dict[str, Any]


class FilterItem(BaseModel):
    column: str
    operator: str = "contains"
    value: Any


class QueryPayload(BaseModel):
    page: int = 1
    page_size: int = 50
    sort_column: str | None = None
    sort_direction: str = "asc"
    search: str | None = None
    filters: list[FilterItem] = []


def serialize_row(row):
    result = {}
    for key, value in row._mapping.items():
        if hasattr(value, "isoformat"):
            result[key] = value.isoformat()
        elif isinstance(value, (bytes, bytearray)):
            result[key] = value.hex()
        else:
            result[key] = value
    return result


def get_pk_columns(table):
    return [col.name for col in table.primary_key.columns]


def build_pk_condition(table, pk_values: dict[str, Any]):
    pk_cols = get_pk_columns(table)
    if not pk_cols:
        raise HTTPException(400, "This table has no primary key; update is disabled for safety.")
    missing = [c for c in pk_cols if c not in pk_values]
    if missing:
        raise HTTPException(400, f"Missing primary key values: {', '.join(missing)}")
    return and_(*[table.c[c] == pk_values[c] for c in pk_cols])


@app.get("/api/health")
def health():
    try:
        with engine.connect() as conn:
            conn.execute(select(1))
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@app.get("/api/tables")
def list_tables():
    try:
        return {"tables": get_inspector().get_table_names()}
    except SQLAlchemyError as exc:
        raise HTTPException(500, str(exc))


@app.get("/api/tables/{table_name}/schema")
def table_schema(table_name: str):
    try:
        table = get_table(table_name)
        pk = set(get_pk_columns(table))
        columns = []
        for col in table.columns:
            columns.append({
                "name": col.name,
                "type": str(col.type),
                "nullable": col.nullable,
                "primary_key": col.name in pk,
                "autoincrement": bool(col.autoincrement is True or str(col.autoincrement).lower() == "auto"),
                "default": str(col.default.arg) if col.default is not None else None,
            })
        return {"table": table_name, "columns": columns, "primary_key": list(pk)}
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@app.post("/api/tables/{table_name}/query")
def query_table(table_name: str, payload: QueryPayload):
    try:
        table = get_table(table_name)
    except ValueError as exc:
        raise HTTPException(404, str(exc))

    page = max(1, payload.page)
    page_size = min(max(1, payload.page_size), 200)
    conditions = []

    if payload.search:
        search_conditions = [cast(col, String).like(f"%{payload.search}%") for col in table.columns]
        if search_conditions:
            conditions.append(or_(*search_conditions))

    for f in payload.filters:
        if f.column not in table.c:
            raise HTTPException(400, f"Unknown column: {f.column}")
        col = table.c[f.column]
        op = f.operator.lower()
        if op == "equals":
            conditions.append(col == f.value)
        elif op == "not_equals":
            conditions.append(col != f.value)
        elif op == "starts_with":
            conditions.append(cast(col, String).like(f"{f.value}%"))
        elif op == "ends_with":
            conditions.append(cast(col, String).like(f"%{f.value}"))
        elif op == "gt":
            conditions.append(col > f.value)
        elif op == "gte":
            conditions.append(col >= f.value)
        elif op == "lt":
            conditions.append(col < f.value)
        elif op == "lte":
            conditions.append(col <= f.value)
        else:
            conditions.append(cast(col, String).like(f"%{f.value}%"))

    stmt = select(table)
    count_stmt = select(func.count()).select_from(table)
    if conditions:
        stmt = stmt.where(and_(*conditions))
        count_stmt = count_stmt.where(and_(*conditions))

    if payload.sort_column and payload.sort_column in table.c:
        sort_col = table.c[payload.sort_column]
        stmt = stmt.order_by(sort_col.desc() if payload.sort_direction.lower() == "desc" else sort_col.asc())

    stmt = stmt.limit(page_size).offset((page - 1) * page_size)

    try:
        with engine.connect() as conn:
            rows = [serialize_row(r) for r in conn.execute(stmt)]
            total = conn.execute(count_stmt).scalar_one()
        return {"rows": rows, "total": total, "page": page, "page_size": page_size}
    except SQLAlchemyError as exc:
        raise HTTPException(500, str(exc))


@app.post("/api/tables/{table_name}")
def create_row(table_name: str, payload: RowPayload):
    try:
        table = get_table(table_name)
        allowed = {c.name for c in table.columns}
        values = {k: v for k, v in payload.values.items() if k in allowed and v != ""}
        with engine.begin() as conn:
            result = conn.execute(insert(table).values(**values))
        return {"message": "Record inserted successfully", "inserted_primary_key": list(result.inserted_primary_key)}
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except SQLAlchemyError as exc:
        raise HTTPException(400, str(exc.__cause__ or exc))


@app.put("/api/tables/{table_name}")
def update_row(table_name: str, payload: UpdatePayload):
    try:
        table = get_table(table_name)
        condition = build_pk_condition(table, payload.pk)
        allowed = {c.name for c in table.columns}
        pk_cols = set(get_pk_columns(table))
        values = {k: v for k, v in payload.values.items() if k in allowed and k not in pk_cols}
        if not values:
            raise HTTPException(400, "No editable values were supplied.")
        with engine.begin() as conn:
            result = conn.execute(update(table).where(condition).values(**values))
        return {"message": "Record updated successfully", "affected_rows": result.rowcount}
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except SQLAlchemyError as exc:
        raise HTTPException(400, str(exc.__cause__ or exc))


# Serve the compiled React app from the same FastAPI container.
# Keep this mount after all /api routes so API requests are matched first.
static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
if os.path.isdir(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
