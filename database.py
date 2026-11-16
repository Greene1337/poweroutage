from sqlalchemy import create_engine, Column, Integer, Float, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
import datetime

# Allow overriding the DB path via env var. If not set, use local file.
# Example for an absolute path on the server: /home/greene/powerOutage/electmonitor.db
db_path = os.getenv("ELECTMONITOR_DB_PATH", "./electmonitor.db")
SQLALCHEMY_DATABASE_URL = f"sqlite:///{db_path}"

# Используем WAL режим для лучшей надёжности и производительности
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args={"check_same_thread": False},
    # WAL режим делает SQLite более устойчивым к сбоям
    pool_pre_ping=True
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class Heartbeat(Base):
    __tablename__ = "heartbeats"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, nullable=False, index=True)

class Outage(Base):
    __tablename__ = "outages"

    id = Column(Integer, primary_key=True, index=True)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    duration = Column(Float, nullable=False) # Duration in seconds

def init_db():
    Base.metadata.create_all(bind=engine)
    # Включаем WAL режим для SQLite (если ещё не включен)
    # WAL режим делает SQLite более устойчивым к сбоям питания
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("PRAGMA journal_mode=WAL"))
            conn.commit()
    except Exception as e:
        # Игнорируем ошибки, если WAL не поддерживается (например, на некоторых сетевых ФС)
        pass
