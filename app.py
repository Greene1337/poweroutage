import datetime
import asyncio
import logging
import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from database import SessionLocal, init_db, Outage, Heartbeat
from pydantic import BaseModel
from typing import List, Optional
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

HEARTBEAT_INTERVAL = 60 # seconds
OUTAGE_THRESHOLD = 180 # seconds (3 minutes). If gap > this, consider it an outage.
MAX_HEARTBEAT_RECORDS = 100  # Храним последние 100 записей heartbeat для истории

# Network time fallback disabled (no external API calls)
USE_NETWORK_TIME_FALLBACK = False
NETWORK_TIME_URL = "http://worldtimeapi.org/api/ip"
NETWORK_TIME_MAX_DIFF = 300  # seconds; if system time differs more than this, prefer network time

# Configure basic logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("electmonitor")

# Dependencies
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class OutageSchema(BaseModel):
    id: int
    start_time: datetime.datetime
    end_time: datetime.datetime
    duration: float

    class Config:
        from_attributes = True

class PeriodStats(BaseModel):
    count: int
    duration: float

class Stats(BaseModel):
    is_online: bool
    last_outage: Optional[datetime.datetime]
    today: PeriodStats
    week: PeriodStats
    month: PeriodStats
    total: PeriodStats

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    check_for_outage()
    loop_task = asyncio.create_task(heartbeat_loop())
    yield
    # Shutdown
    loop_task.cancel()

app = FastAPI(lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def check_and_record_outage(db: Session, last_heartbeat: datetime.datetime, current_time: datetime.datetime) -> bool:
    """
    Проверяет разрыв между последним heartbeat и текущим временем.
    Если разрыв > OUTAGE_THRESHOLD, создаёт запись об отключении в БД (если такой ещё нет).
    Возвращает True если outage был записан, False если нет.
    """
    last_seen = last_heartbeat.replace(microsecond=0)
    now = current_time.replace(microsecond=0)

    # Защита от кривого времени: если last_seen в будущем, не пишем outage
    if last_seen > now:
        logger.warning("Heartbeat timestamp is in the future (%s > %s). Skipping outage check.", last_seen, now)
        return False

    duration = (now - last_seen).total_seconds()
    
    if duration > OUTAGE_THRESHOLD:
        logger.info("Detected outage (duration %.1fs > threshold %ss). Checking if already recorded...", duration, OUTAGE_THRESHOLD)
        
        try:
            # Проверяем, нет ли уже записи об этом отключении (защита от дубликатов)
            # Считаем, что это тот же outage, если start_time совпадает с точностью до минуты
            start_clean = last_seen.replace(second=0)
            existing = db.query(Outage).filter(
                Outage.start_time >= start_clean - datetime.timedelta(seconds=60),
                Outage.start_time <= start_clean + datetime.timedelta(seconds=60)
            ).first()

            if existing:
                logger.info("Outage already recorded (id=%s, start=%s). Skipping duplicate.", existing.id, existing.start_time)
                return False

            # Создаём новую запись об отключении
            end_clean = now.replace(second=0)
            outage = Outage(start_time=start_clean, end_time=end_clean, duration=duration)
            db.add(outage)
            db.commit()
            logger.info("Outage saved: start=%s, end=%s, duration=%.1fs, id=%s", 
                       start_clean, end_clean, duration, getattr(outage, 'id', None))
            return True
        except Exception as e:
            logger.error("Error saving outage: %s", e)
            logger.debug(traceback.format_exc())
            db.rollback()
            return False
    else:
        logger.debug("No outage detected (duration %.1fs <= threshold %ss).", duration, OUTAGE_THRESHOLD)
        return False

def check_for_outage():
    """
    Проверяет последний heartbeat в БД на наличие отключения.
    Вызывается при старте приложения.
    """
    db = SessionLocal()
    try:
        # Получаем последний heartbeat из БД
        last_heartbeat = db.query(Heartbeat).order_by(Heartbeat.timestamp.desc()).first()
        
        if not last_heartbeat:
            logger.info("No heartbeat records found in DB - starting fresh")
            return

        now = datetime.datetime.now()
        check_and_record_outage(db, last_heartbeat.timestamp, now)
    except Exception as e:
        logger.error("Error checking outage: %s", e)
        logger.debug(traceback.format_exc())
    finally:
        db.close()

async def heartbeat_loop():
    """
    Фоновая задача: каждые HEARTBEAT_INTERVAL секунд записывает текущее время в БД (таблица heartbeats).
    После каждой записи проверяет разрыв с предыдущим heartbeat и при необходимости создаёт запись об отключении.
    Также удаляет старые heartbeat записи, оставляя только последние MAX_HEARTBEAT_RECORDS.
    """
    while True:
        db = SessionLocal()
        try:
            now = datetime.datetime.now().replace(microsecond=0)
            
            # Получаем предыдущий heartbeat для проверки разрыва
            last_heartbeat = db.query(Heartbeat).order_by(Heartbeat.timestamp.desc()).first()
            
            # Записываем новый heartbeat
            heartbeat = Heartbeat(timestamp=now)
            db.add(heartbeat)
            db.commit()
            
            logger.debug("Heartbeat written to DB: %s", now)
            
            # Если есть предыдущий heartbeat, проверяем разрыв
            if last_heartbeat:
                check_and_record_outage(db, last_heartbeat.timestamp, now)
            
            # Удаляем старые heartbeat записи, оставляя только последние MAX_HEARTBEAT_RECORDS
            try:
                # Получаем ID записи, которая будет N-й с конца
                oldest_to_keep = db.query(Heartbeat.id).order_by(Heartbeat.timestamp.desc()).offset(MAX_HEARTBEAT_RECORDS).first()
                if oldest_to_keep:
                    # Удаляем все записи старше этой
                    db.query(Heartbeat).filter(Heartbeat.id < oldest_to_keep.id).delete()
                    db.commit()
                    logger.debug("Cleaned up old heartbeat records, keeping last %d", MAX_HEARTBEAT_RECORDS)
            except Exception as e:
                logger.debug("Error cleaning up old heartbeats: %s", e)
                db.rollback()
                
        except Exception as e:
            logger.error("Error in heartbeat loop: %s", e)
            logger.debug(traceback.format_exc())
            db.rollback()
        finally:
            db.close()
        
        await asyncio.sleep(HEARTBEAT_INTERVAL)

@app.get("/api/outages", response_model=List[OutageSchema])
def read_outages(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    outages = db.query(Outage).order_by(Outage.start_time.desc()).offset(skip).limit(limit).all()
    return outages

def calculate_stats(outages: List[Outage], start_date: datetime.datetime) -> PeriodStats:
    filtered = [o for o in outages if o.start_time >= start_date]
    count = len(filtered)
    duration = sum(o.duration for o in filtered)
    return PeriodStats(count=count, duration=duration)

@app.get("/api/stats", response_model=Stats)
def read_stats(db: Session = Depends(get_db)):
    outages = db.query(Outage).all()
    
    now = datetime.datetime.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = now - datetime.timedelta(days=7)
    month_start = now - datetime.timedelta(days=30)
    
    last_outage_time = None
    if outages:
        latest = max(outages, key=lambda x: x.end_time)
        last_outage_time = latest.end_time

    return Stats(
        is_online=True, # If this API is reachable, it's online
        last_outage=last_outage_time,
        today=calculate_stats(outages, today_start),
        week=calculate_stats(outages, week_start),
        month=calculate_stats(outages, month_start),
        total=PeriodStats(
            count=len(outages),
            duration=sum(o.duration for o in outages)
        )
    )

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_index():
    from fastapi.responses import FileResponse
    return FileResponse('static/index.html')

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
