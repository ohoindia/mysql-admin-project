import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, MetaData, Table
from sqlalchemy.engine import URL

load_dotenv()

url = URL.create(
    drivername="mysql+pymysql",
    username=os.getenv("DB_USER", "root"),
    password=os.getenv("DB_PASSWORD", ""),
    host=os.getenv("DB_HOST", "localhost"),
    port=int(os.getenv("DB_PORT", "3306")),
    database=os.getenv("DB_NAME"),
)

engine = create_engine(url, pool_pre_ping=True, pool_recycle=3600)
metadata = MetaData()


def get_inspector():
    return inspect(engine)


def get_table(table_name: str) -> Table:
    inspector = get_inspector()
    if table_name not in inspector.get_table_names():
        raise ValueError(f"Table '{table_name}' does not exist")
    return Table(table_name, metadata, autoload_with=engine, extend_existing=True)
