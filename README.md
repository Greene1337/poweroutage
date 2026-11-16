# PowerOutage

A lightweight, self-hosted electricity interruption tracker for a Linux host. It records heartbeat timestamps in SQLite, infers interruptions from gaps, and displays the history in a minimal dark web dashboard.

> **Measurement limitation:** a gap in application heartbeats is evidence that the monitored host or process was unavailable, **not independent proof of a mains power outage**. Reboots, maintenance, clock changes, and software failures can also create gaps.

## Features

- FastAPI backend and a responsive HTML/JavaScript dashboard.
- SQLite storage with WAL mode.
- Heartbeats recorded approximately every **60 seconds**.
- A detected incident when a heartbeat gap exceeds **180 seconds**.
- Overview statistics for today, the last 7 days, the last 30 days, and all recorded events.
- Recent-incident history; no cloud account or external monitoring service required.
- Reverse-chronological recent-days timeline (today first).
- Interactive 12-month activity calendar, showing daily downtime intensity and unknown dates.
- Time-of-day incident start distribution, median incident duration, quiet intervals and overnight downtime share.

## How it works

```text
Linux host + FastAPI
        |
        +-- heartbeat every ~60s --> SQLite (heartbeats)
        |
        +-- service/host unavailable: no heartbeats
        |
        +-- startup or next heartbeat checks the gap
                      |
            gap > 180s? --> save outage
                      |
          /api/stats, /api/outages
                      |
                 Web dashboard
```

Incident start and end times are estimates based on the last successful heartbeat and the time monitoring resumes.

## Requirements

- A Linux host or Raspberry Pi with Python 3.
- A writable application directory for SQLite data.
- Packages listed in [requirements.txt](requirements.txt).

## Quick start

```bash
git clone https://github.com/Greene1337/poweroutage.git
cd poweroutage
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

Open `http://localhost:8000/` on the same host. The entry point in `app.py` currently binds port **8000** to `0.0.0.0`. Restrict network access or put the application behind appropriate authentication before exposing it outside a trusted network.

The default database is `./electmonitor.db`, resolved relative to the process working directory. To use a persistent path elsewhere:

```bash
ELECTMONITOR_DB_PATH=/absolute/path/to/electmonitor.db python app.py
```

The application creates its database tables on startup if they do not already exist.

## Endpoints

| Endpoint | Description |
| --- | --- |
| `/` | Web dashboard |
| `/api/stats` | Availability flag, latest incident, and period summaries |
| `/api/outages?skip=0&limit=100` | Incident records, newest first |

The `is_online` field currently indicates that the API is responding; it does **not** measure the electrical grid independently.

## Running on boot (systemd)

An [example systemd unit](electmonitor.service) is included. **It is tailored to the original deployment**: it assumes user `greene`, working directory `/home/greene/powerOutage`, and system Python at `/usr/bin/python3`.

If creating a new installation, edit `User`, `WorkingDirectory`, and `ExecStart` to match your host and Python environment before installing the unit. Keep the working directory persistent, because the database path defaults to a relative filename.

If a service is already running successfully, no service or application-code change is needed for this documentation update.

## Project structure

```text
app.py                 FastAPI routes, heartbeat task and outage detection
database.py            SQLAlchemy models and SQLite setup
requirements.txt       Python dependencies
electmonitor.service   Sample systemd service (host-specific paths)
static/index.html      Dashboard markup and styling
static/script.js       Dashboard data loading and display
electmonitor.db        Runtime database (ignored by Git)
```

## Data retention and backups

SQLite data, its `-wal`/`-shm` sidecars, Python caches, and generated heartbeat/log files are excluded by [.gitignore](.gitignore). They should never be committed as source files.

**Back up the live database outside your Git checkout.** For an online, consistent SQLite snapshot (including committed WAL transactions), you can use the `sqlite3` command-line tool if it is installed:

```bash
mkdir -p "$HOME/poweroutage-backups"
sqlite3 "/absolute/path/to/electmonitor.db" \
  ".backup '$HOME/poweroutage-backups/electmonitor-$(date +%Y%m%d-%H%M%S).db'"
```

Set the database path to the path your service actually uses. Verify that the backup can be opened and contains your existing `outages` records. Copying just `.db` during active WAL writes may omit transactions.

### Important: upgrading an existing Git checkout

Earlier revisions of this repository tracked `electmonitor.db`, `electmonitor.db-wal`, and `electmonitor.db-shm`. **Merging a commit that deletes tracked files may cause a subsequent `git pull` on the monitored host to delete its local database.**

Before deploying this cleanup to a running installation:

1. Identify the **actual** database path and make a verified, consistent backup **outside the repository**.
2. Plan a maintenance window and stop the service before the Git update if needed.
3. Update the checkout; restore the database from the backup to the configured location **if it was removed**.
4. Start the service and verify that historical events and counts remain intact.

Removing files from the current branch does **not** erase them from earlier public Git commits. Purging sensitive historical data requires a separate, coordinated history rewrite.

## Limitations

- Outages are inferred from heartbeat gaps; the app cannot tell whether the cause was electricity, the host, or the process.
- Timestamps depend on the host's local clock and the heartbeat interval.
- When the monitored host is offline, its local dashboard is unavailable.
- The current UI's uptime calculation and grouping should not be treated as independently verified power-meter statistics.

## Frontend validation

The historical-insights helpers can be checked with Node.js (no extra packages needed):

```bash
node --test tests/insights.test.cjs
```

The new visualizations derive their values from the same existing `/api/outages` history; no backend or database migration is required.

## License

No license has been specified. Add a `LICENSE` file if you want to grant others permission to reuse or redistribute the source.
