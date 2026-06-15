use crate::types::{Meeting, MeetingFilter, SearchResult, TranscriptionStatus, WhisperModel};
use rusqlite::{params, Connection};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    /// Open (or create) the SQLite database at `Application Support/com.memosa.app/memosa.db`
    /// and run the schema migrations.
    pub fn new() -> Result<Self, String> {
        let db_path = crate::paths::app_data_dir().join("memosa.db");

        std::fs::create_dir_all(db_path.parent().unwrap())
            .map_err(|e| format!("Failed to create .memosa dir: {}", e))?;

        let conn =
            Connection::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

        // Enable WAL mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.initialize()?;
        Ok(db)
    }

    fn initialize(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS meetings (
                id                    TEXT PRIMARY KEY,
                title                 TEXT NOT NULL,
                date                  TEXT NOT NULL,
                start_time            TEXT NOT NULL,
                duration_seconds      INTEGER NOT NULL DEFAULT 0,
                audio_path            TEXT NOT NULL,
                transcript_path       TEXT,
                transcription_status  TEXT NOT NULL DEFAULT 'not_started',
                calendar_event_id     TEXT,
                attendees             TEXT NOT NULL DEFAULT '[]',
                whisper_model         TEXT,
                profile_id            TEXT,
                summary               TEXT,
                tags                  TEXT NOT NULL DEFAULT '[]',
                people                TEXT NOT NULL DEFAULT '[]',
                themes                TEXT NOT NULL DEFAULT '[]',
                keywords              TEXT NOT NULL DEFAULT '[]',
                folder_path           TEXT NOT NULL,
                created_at            TEXT NOT NULL
            );

            -- FTS5 virtual table for transcript full-text search
            CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
                meeting_id UNINDEXED,
                title,
                content,
                tokenize='porter ascii'
            );

            CREATE INDEX IF NOT EXISTS idx_meetings_date
                ON meetings(date);
            CREATE INDEX IF NOT EXISTS idx_meetings_transcription
                ON meetings(transcription_status);

            CREATE TABLE IF NOT EXISTS folders (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                parent_id  TEXT,
                color      TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS meeting_folder_assignments (
                meeting_id TEXT NOT NULL,
                folder_id  TEXT NOT NULL,
                PRIMARY KEY (meeting_id, folder_id)
            );

            -- Local semantic-search index: one row per transcript chunk, with its
            -- embedding vector stored as little-endian f32 bytes.
            CREATE TABLE IF NOT EXISTS embeddings (
                meeting_id TEXT NOT NULL,
                chunk_idx  INTEGER NOT NULL,
                text       TEXT NOT NULL,
                dim        INTEGER NOT NULL,
                vec        BLOB NOT NULL,
                PRIMARY KEY (meeting_id, chunk_idx)
            );

            -- Speaker diarization: who-said-what segments per meeting.
            CREATE TABLE IF NOT EXISTS speaker_segments (
                meeting_id TEXT NOT NULL,
                idx        INTEGER NOT NULL,
                start_ms   INTEGER NOT NULL,
                end_ms     INTEGER NOT NULL,
                speaker    TEXT NOT NULL,
                text       TEXT NOT NULL,
                PRIMARY KEY (meeting_id, idx)
            );
            ",
        )
        .map_err(|e| format!("Failed to initialize database schema: {}", e))?;

        let has_profile_id = conn
            .prepare("PRAGMA table_info(meetings)")
            .and_then(|mut stmt| {
                let mut rows = stmt.query([])?;
                let mut found = false;
                while let Some(row) = rows.next()? {
                    let name: String = row.get(1)?;
                    if name == "profile_id" {
                        found = true;
                        break;
                    }
                }
                Ok(found)
            })
            .map_err(|e| format!("Failed to inspect meetings schema: {}", e))?;

        if !has_profile_id {
            conn.execute("ALTER TABLE meetings ADD COLUMN profile_id TEXT", [])
                .map_err(|e| format!("Failed to add profile_id column: {}", e))?;
        }

        let has_source_app = conn
            .prepare("PRAGMA table_info(meetings)")
            .and_then(|mut stmt| {
                let mut rows = stmt.query([])?;
                let mut found = false;
                while let Some(row) = rows.next()? {
                    let name: String = row.get(1)?;
                    if name == "source_app" {
                        found = true;
                        break;
                    }
                }
                Ok(found)
            })
            .map_err(|e| format!("Failed to inspect meetings schema: {}", e))?;

        if !has_source_app {
            conn.execute("ALTER TABLE meetings ADD COLUMN source_app TEXT", [])
                .map_err(|e| format!("Failed to add source_app column: {}", e))?;
        }

        let has_summary = conn
            .prepare("PRAGMA table_info(meetings)")
            .and_then(|mut stmt| {
                let mut rows = stmt.query([])?;
                let mut found = false;
                while let Some(row) = rows.next()? {
                    let name: String = row.get(1)?;
                    if name == "summary" {
                        found = true;
                        break;
                    }
                }
                Ok(found)
            })
            .map_err(|e| format!("Failed to inspect meetings schema: {}", e))?;

        if !has_summary {
            conn.execute("ALTER TABLE meetings ADD COLUMN summary TEXT", [])
                .map_err(|e| format!("Failed to add summary column: {}", e))?;
        }

        let has_tags = conn
            .prepare("PRAGMA table_info(meetings)")
            .and_then(|mut stmt| {
                let mut rows = stmt.query([])?;
                let mut found = false;
                while let Some(row) = rows.next()? {
                    let name: String = row.get(1)?;
                    if name == "tags" {
                        found = true;
                        break;
                    }
                }
                Ok(found)
            })
            .map_err(|e| format!("Failed to inspect meetings schema: {}", e))?;

        if !has_tags {
            conn.execute("ALTER TABLE meetings ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'", [])
                .map_err(|e| format!("Failed to add tags column: {}", e))?;
        }

        for (column, sql) in [
            ("people", "ALTER TABLE meetings ADD COLUMN people TEXT NOT NULL DEFAULT '[]'"),
            ("themes", "ALTER TABLE meetings ADD COLUMN themes TEXT NOT NULL DEFAULT '[]'"),
            ("keywords", "ALTER TABLE meetings ADD COLUMN keywords TEXT NOT NULL DEFAULT '[]'"),
            ("is_favorite", "ALTER TABLE meetings ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0"),
            ("action_items", "ALTER TABLE meetings ADD COLUMN action_items TEXT NOT NULL DEFAULT '[]'"),
            ("decisions", "ALTER TABLE meetings ADD COLUMN decisions TEXT NOT NULL DEFAULT '[]'"),
        ] {
            let has_column = conn
                .prepare("PRAGMA table_info(meetings)")
                .and_then(|mut stmt| {
                    let mut rows = stmt.query([])?;
                    let mut found = false;
                    while let Some(row) = rows.next()? {
                        let name: String = row.get(1)?;
                        if name == column {
                            found = true;
                            break;
                        }
                    }
                    Ok(found)
                })
                .map_err(|e| format!("Failed to inspect meetings schema: {}", e))?;

            if !has_column {
                conn.execute(sql, [])
                    .map_err(|e| format!("Failed to add {column} column: {}", e))?;
            }
        }

        Ok(())
    }

    // ─── Write operations ────────────────────────────────────────────────────

    /// Insert or replace a meeting row.
    pub fn insert_meeting(&self, meeting: &Meeting, folder_path: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let attendees_json =
            serde_json::to_string(&meeting.attendees).unwrap_or_else(|_| "[]".to_string());
        let tags_json = serde_json::to_string(&meeting.tags).unwrap_or_else(|_| "[]".to_string());
        let people_json =
            serde_json::to_string(&meeting.people).unwrap_or_else(|_| "[]".to_string());
        let themes_json =
            serde_json::to_string(&meeting.themes).unwrap_or_else(|_| "[]".to_string());
        let keywords_json =
            serde_json::to_string(&meeting.keywords).unwrap_or_else(|_| "[]".to_string());
        let action_items_json =
            serde_json::to_string(&meeting.action_items).unwrap_or_else(|_| "[]".to_string());
        let decisions_json =
            serde_json::to_string(&meeting.decisions).unwrap_or_else(|_| "[]".to_string());
        let status_str = transcription_status_to_str(&meeting.transcription_status);
        let model_str = meeting.whisper_model.as_ref().map(whisper_model_to_str);

        conn.execute(
            "INSERT OR REPLACE INTO meetings
              (id, title, date, start_time, duration_seconds, audio_path, transcript_path,
              transcription_status, calendar_event_id, attendees, whisper_model, profile_id,
              source_app, summary, tags, people, themes, keywords, is_favorite,
              action_items, decisions, folder_path, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
            params![
                meeting.id,
                meeting.title,
                meeting.date,
                meeting.start_time,
                meeting.duration_seconds as i64,
                meeting.audio_path,
                meeting.transcript_path,
                status_str,
                meeting.calendar_event_id,
                attendees_json,
                model_str,
                meeting.profile_id,
                meeting.source_app,
                meeting.summary,
                tags_json,
                people_json,
                themes_json,
                keywords_json,
                meeting.is_favorite as i32,
                action_items_json,
                decisions_json,
                folder_path,
                chrono::Utc::now().to_rfc3339(),
            ],
        )
        .map_err(|e| format!("Failed to insert meeting: {}", e))?;
        Ok(())
    }

    /// Update the transcription_status (and optionally transcript_path) for a meeting.
    #[allow(dead_code)]
    pub fn update_transcription_status(
        &self,
        meeting_id: &str,
        status: &str,
        transcript_path: Option<&str>,
    ) -> Result<(), String> {
        self.update_transcription_state(meeting_id, status, transcript_path, None)
    }

    pub fn update_transcription_state(
        &self,
        meeting_id: &str,
        status: &str,
        transcript_path: Option<&str>,
        whisper_model: Option<&WhisperModel>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let whisper_model = whisper_model.map(whisper_model_to_str);
        conn.execute(
            "UPDATE meetings
             SET transcription_status=?1,
                 transcript_path=?2,
                 whisper_model=COALESCE(?3, whisper_model)
             WHERE id=?4",
            params![status, transcript_path, whisper_model, meeting_id],
        )
        .map_err(|e| format!("Failed to update transcription status: {}", e))?;
        Ok(())
    }

    /// Rename a meeting (update title in DB only).
    pub fn rename_meeting(&self, id: &str, title: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE meetings SET title=?1 WHERE id=?2",
            params![title, id],
        )
        .map_err(|e| format!("Failed to rename meeting: {}", e))?;
        Ok(())
    }

    pub fn update_meeting_profile(
        &self,
        id: &str,
        profile_id: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE meetings SET profile_id=?1 WHERE id=?2",
            params![profile_id, id],
        )
        .map_err(|e| format!("Failed to update meeting profile: {}", e))?;
        Ok(())
    }

    /// Update both duration_seconds and audio_path for a meeting (called after recording stops).
    pub fn update_audio_path(&self, meeting_id: &str, audio_path: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE meetings SET audio_path=?1 WHERE id=?2",
            params![audio_path, meeting_id],
        )
        .map_err(|e| format!("Failed to update audio_path: {}", e))?;
        Ok(())
    }

    /// Update the duration_seconds for a meeting.
    pub fn update_duration(&self, meeting_id: &str, duration_seconds: u64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE meetings SET duration_seconds=?1 WHERE id=?2",
            params![duration_seconds as i64, meeting_id],
        )
        .map_err(|e| format!("Failed to update duration: {}", e))?;
        Ok(())
    }

    pub fn update_meeting_paths(
        &self,
        meeting_id: &str,
        folder_path: &str,
        audio_path: &str,
        transcript_path: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE meetings SET folder_path=?1, audio_path=?2, transcript_path=?3 WHERE id=?4",
            params![folder_path, audio_path, transcript_path, meeting_id],
        )
        .map_err(|e| format!("Failed to update meeting paths: {}", e))?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_meeting_insights(
        &self,
        meeting_id: &str,
        summary: &str,
        tags: &[String],
        people: &[String],
        themes: &[String],
        keywords: &[String],
        action_items: &[String],
        decisions: &[String],
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let tags_json = serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_string());
        let people_json = serde_json::to_string(people).unwrap_or_else(|_| "[]".to_string());
        let themes_json = serde_json::to_string(themes).unwrap_or_else(|_| "[]".to_string());
        let keywords_json = serde_json::to_string(keywords).unwrap_or_else(|_| "[]".to_string());
        let action_items_json = serde_json::to_string(action_items).unwrap_or_else(|_| "[]".to_string());
        let decisions_json = serde_json::to_string(decisions).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "UPDATE meetings SET summary=?1, tags=?2, people=?3, themes=?4, keywords=?5, action_items=?6, decisions=?7 WHERE id=?8",
            params![summary, tags_json, people_json, themes_json, keywords_json, action_items_json, decisions_json, meeting_id],
        )
        .map_err(|e| format!("Failed to update meeting insights: {}", e))?;
        Ok(())
    }

    /// Toggle the is_favorite flag for a meeting.
    pub fn set_meeting_favorite(&self, id: &str, is_favorite: bool) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE meetings SET is_favorite=?1 WHERE id=?2",
            params![is_favorite as i32, id],
        )
        .map_err(|e| format!("Failed to update is_favorite: {}", e))?;
        Ok(())
    }

    /// Delete a meeting row and its FTS entry. Returns the folder_path so the
    /// caller can also remove the files from disk.
    pub fn delete_meeting(&self, id: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().unwrap();

        // Retrieve folder path before deletion
        let folder_path: Option<String> = conn
            .query_row(
                "SELECT folder_path FROM meetings WHERE id=?1",
                params![id],
                |row| row.get(0),
            )
            .ok();

        conn.execute("DELETE FROM meetings WHERE id=?1", params![id])
            .map_err(|e| format!("Failed to delete meeting: {}", e))?;
        conn.execute(
            "DELETE FROM transcripts_fts WHERE meeting_id=?1",
            params![id],
        )
        .map_err(|e| format!("Failed to delete FTS entry: {}", e))?;

        Ok(folder_path)
    }

    // ─── FTS ────────────────────────────────────────────────────────────────

    /// Insert (or replace) the transcript content into the FTS5 table.
    pub fn index_transcript(
        &self,
        meeting_id: &str,
        title: &str,
        content: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();

        // Remove any stale entry first
        conn.execute(
            "DELETE FROM transcripts_fts WHERE meeting_id=?1",
            params![meeting_id],
        )
        .map_err(|e| format!("Failed to clear FTS entry: {}", e))?;

        conn.execute(
            "INSERT INTO transcripts_fts (meeting_id, title, content) VALUES (?1, ?2, ?3)",
            params![meeting_id, title, content],
        )
        .map_err(|e| format!("Failed to index transcript: {}", e))?;

        Ok(())
    }

    // ─── Read operations ─────────────────────────────────────────────────────

    /// Return a single meeting by ID, or None if it does not exist.
    pub fn get_meeting(&self, id: &str) -> Result<Option<Meeting>, String> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, title, date, start_time, duration_seconds, audio_path,
                    transcript_path, transcription_status, calendar_event_id,
                    attendees, whisper_model, profile_id, source_app, summary, tags, people, themes, keywords,
                    is_favorite, action_items, decisions
             FROM meetings WHERE id=?1",
            params![id],
            row_to_meeting,
        );

        match result {
            Ok(m) => Ok(Some(m)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Failed to get meeting: {}", e)),
        }
    }

    /// Return all meetings matching the optional filter criteria,
    /// ordered newest first.
    pub fn get_meetings(&self, filter: &MeetingFilter) -> Result<Vec<Meeting>, String> {
        let conn = self.conn.lock().unwrap();

        // Build a dynamic WHERE clause
        let mut conditions: Vec<String> = Vec::new();
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(ref from) = filter.from_date {
            conditions.push(format!("date >= ?{}", param_values.len() + 1));
            param_values.push(Box::new(from.clone()));
        }
        if let Some(ref to) = filter.to_date {
            conditions.push(format!("date <= ?{}", param_values.len() + 1));
            param_values.push(Box::new(to.clone()));
        }
        if let Some(ref status) = filter.transcription_status {
            conditions.push(format!(
                "transcription_status = ?{}",
                param_values.len() + 1
            ));
            param_values.push(Box::new(transcription_status_to_str(status).to_string()));
        }
        if let Some(ref profile_id) = filter.profile_id {
            conditions.push(format!("profile_id = ?{}", param_values.len() + 1));
            param_values.push(Box::new(profile_id.clone()));
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        let sql = format!(
            "SELECT id, title, date, start_time, duration_seconds, audio_path,
                    transcript_path, transcription_status, calendar_event_id,
                    attendees, whisper_model, profile_id, source_app, summary, tags, people, themes, keywords,
                    is_favorite, action_items, decisions
             FROM meetings
             {}
             ORDER BY date DESC, start_time DESC",
            where_clause
        );

        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare meetings query: {}", e))?;

        let rows = stmt
            .query_map(params_refs.as_slice(), row_to_meeting)
            .map_err(|e| format!("Failed to query meetings: {}", e))?;

        let mut meetings = Vec::new();
        for row in rows {
            meetings.push(row.map_err(|e| format!("Failed to read meeting row: {}", e))?);
        }
        Ok(meetings)
    }

    /// Full-text search across meeting titles and transcript content.
    /// Returns up to 50 results with FTS5 snippets, ordered by rank (best match first).
    pub fn search_meetings(&self, query: &str) -> Result<Vec<SearchResult>, String> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn
            .prepare(
                "SELECT m.id, m.title, m.date, m.start_time, m.duration_seconds,
                        m.audio_path, m.transcript_path, m.transcription_status,
                        m.calendar_event_id, m.attendees, m.whisper_model, m.profile_id,
                        m.source_app, m.summary, m.tags, m.people, m.themes, m.keywords,
                        m.is_favorite, m.action_items, m.decisions,
                        snippet(transcripts_fts, 2, '<b>', '</b>', '...', 20) AS snippet
                 FROM transcripts_fts
                 JOIN meetings m ON m.id = transcripts_fts.meeting_id
                 WHERE transcripts_fts MATCH ?1
                 ORDER BY rank
                 LIMIT 50",
            )
            .map_err(|e| format!("Failed to prepare search query: {}", e))?;

        let rows = stmt
            .query_map(params![query], |row| {
                let meeting = row_to_meeting_indexed(row, 0)?;
                let snippet: String = row.get(21)?;
                Ok((meeting, snippet))
            })
            .map_err(|e| format!("Failed to run search: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            let (meeting, snippet) =
                row.map_err(|e| format!("Failed to read search row: {}", e))?;
            results.push(SearchResult {
                meeting,
                snippet,
                timestamp: None,
            });
        }
        Ok(results)
    }

    // ─── Folder operations ───────────────────────────────────────────────────

    pub fn upsert_folder(&self, id: &str, name: &str, parent_id: Option<&str>, color: Option<&str>) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO folders (id, name, parent_id, color, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, parent_id=excluded.parent_id, color=excluded.color",
            params![id, name, parent_id, color, now],
        ).map_err(|e| format!("Failed to upsert folder: {}", e))?;
        Ok(())
    }

    pub fn delete_folder(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM meeting_folder_assignments WHERE folder_id=?1", params![id])
            .map_err(|e| format!("Failed to delete folder assignments: {}", e))?;
        conn.execute("DELETE FROM folders WHERE id=?1", params![id])
            .map_err(|e| format!("Failed to delete folder: {}", e))?;
        Ok(())
    }

    pub fn get_all_folders(&self) -> Result<Vec<(String, String, Option<String>, Option<String>)>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, parent_id, color FROM folders ORDER BY created_at")
            .map_err(|e| format!("Failed to prepare get_all_folders: {}", e))?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, Option<String>>(3)?))
        }).map_err(|e| format!("Failed to query folders: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to collect folders: {}", e))
    }

    pub fn assign_meeting_to_folder(&self, meeting_id: &str, folder_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO meeting_folder_assignments (meeting_id, folder_id) VALUES (?1, ?2)",
            params![meeting_id, folder_id],
        ).map_err(|e| format!("Failed to assign meeting to folder: {}", e))?;
        Ok(())
    }

    pub fn remove_meeting_from_folder(&self, meeting_id: &str, folder_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM meeting_folder_assignments WHERE meeting_id=?1 AND folder_id=?2",
            params![meeting_id, folder_id],
        ).map_err(|e| format!("Failed to remove meeting from folder: {}", e))?;
        Ok(())
    }

    pub fn get_all_assignments(&self) -> Result<Vec<(String, String)>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT meeting_id, folder_id FROM meeting_folder_assignments")
            .map_err(|e| format!("Failed to prepare get_all_assignments: {}", e))?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| format!("Failed to query assignments: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to collect assignments: {}", e))
    }

    /// Return the folder_path for a meeting, or None if the meeting does not exist.
    pub fn get_folder_path(&self, meeting_id: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().unwrap();
        let result: rusqlite::Result<String> = conn.query_row(
            "SELECT folder_path FROM meetings WHERE id=?1",
            params![meeting_id],
            |row| row.get(0),
        );
        match result {
            Ok(p) => Ok(Some(p)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Failed to get folder path: {}", e)),
        }
    }
}

// ─── Row mapping helpers ─────────────────────────────────────────────────────

/// Map a rusqlite Row to a Meeting. Columns must be in the canonical order:
/// 0:id 1:title 2:date 3:start_time 4:duration_seconds 5:audio_path
/// 6:transcript_path 7:transcription_status 8:calendar_event_id
/// 9:attendees 10:whisper_model 11:profile_id 12:source_app 13:summary 14:tags 15:people 16:themes 17:keywords 18:is_favorite
fn row_to_meeting(row: &rusqlite::Row<'_>) -> rusqlite::Result<Meeting> {
    row_to_meeting_indexed(row, 0)
}

/// Same as row_to_meeting but with a configurable starting column index,
/// needed for the search query that has additional columns before the meeting fields.
fn row_to_meeting_indexed(row: &rusqlite::Row<'_>, offset: usize) -> rusqlite::Result<Meeting> {
    let id: String = row.get(offset)?;
    let title: String = row.get(offset + 1)?;
    let date: String = row.get(offset + 2)?;
    let start_time: String = row.get(offset + 3)?;
    let duration_seconds: i64 = row.get(offset + 4)?;
    let audio_path: String = row.get(offset + 5)?;
    let transcript_path: Option<String> = row.get(offset + 6)?;
    let transcription_status_str: String = row.get(offset + 7)?;
    let calendar_event_id: Option<String> = row.get(offset + 8)?;
    let attendees_json: String = row.get(offset + 9)?;
    let whisper_model_str: Option<String> = row.get(offset + 10)?;
    let profile_id: Option<String> = row.get(offset + 11)?;
    let source_app: Option<String> = row.get(offset + 12)?;
    let summary: Option<String> = row.get(offset + 13)?;
    let tags_json: String = row.get(offset + 14)?;
    let people_json: String = row.get(offset + 15)?;
    let themes_json: String = row.get(offset + 16)?;
    let keywords_json: String = row.get(offset + 17)?;
    let is_favorite: i32 = row.get(offset + 18).unwrap_or(0);
    let action_items_json: String = row.get(offset + 19).unwrap_or_else(|_| "[]".to_string());
    let decisions_json: String = row.get(offset + 20).unwrap_or_else(|_| "[]".to_string());

    let attendees: Vec<String> = serde_json::from_str(&attendees_json).unwrap_or_default();
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    let people: Vec<String> = serde_json::from_str(&people_json).unwrap_or_default();
    let themes: Vec<String> = serde_json::from_str(&themes_json).unwrap_or_default();
    let keywords: Vec<String> = serde_json::from_str(&keywords_json).unwrap_or_default();
    let action_items: Vec<String> = serde_json::from_str(&action_items_json).unwrap_or_default();
    let decisions: Vec<String> = serde_json::from_str(&decisions_json).unwrap_or_default();

    let transcription_status = parse_transcription_status(&transcription_status_str);
    let whisper_model = whisper_model_str.as_deref().and_then(parse_whisper_model);

    Ok(Meeting {
        id,
        title,
        date,
        start_time,
        duration_seconds: duration_seconds as u64,
        audio_path,
        transcript_path,
        transcription_status,
        calendar_event_id,
        attendees,
        whisper_model,
        profile_id,
        source_app,
        summary,
        tags,
        people,
        themes,
        keywords,
        is_favorite: is_favorite != 0,
        action_items,
        decisions,
    })
}

// ─── Enum ↔ string conversions ───────────────────────────────────────────────

fn transcription_status_to_str(s: &TranscriptionStatus) -> &'static str {
    match s {
        TranscriptionStatus::NotStarted => "not_started",
        TranscriptionStatus::Processing => "processing",
        TranscriptionStatus::Complete => "complete",
        TranscriptionStatus::Failed => "failed",
    }
}

fn parse_transcription_status(s: &str) -> TranscriptionStatus {
    match s {
        "processing" => TranscriptionStatus::Processing,
        "complete" => TranscriptionStatus::Complete,
        "failed" => TranscriptionStatus::Failed,
        _ => TranscriptionStatus::NotStarted,
    }
}

fn whisper_model_to_str(m: &WhisperModel) -> &'static str {
    match m {
        WhisperModel::Tiny => "tiny",
        WhisperModel::Base => "base",
        WhisperModel::Small => "small",
        WhisperModel::Medium => "medium",
    }
}

fn parse_whisper_model(s: &str) -> Option<WhisperModel> {
    match s {
        "tiny" => Some(WhisperModel::Tiny),
        "base" => Some(WhisperModel::Base),
        "small" => Some(WhisperModel::Small),
        "medium" => Some(WhisperModel::Medium),
        _ => None,
    }
}

// ─── Embeddings (local semantic search) ──────────────────────────────────────

impl Database {
    /// Remove all stored chunk embeddings for a meeting (before re-indexing it).
    pub fn clear_meeting_embeddings(&self, meeting_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM embeddings WHERE meeting_id = ?1", params![meeting_id])
            .map_err(|e| format!("Failed to clear embeddings: {e}"))?;
        Ok(())
    }

    /// Store one transcript-chunk embedding (vector as little-endian f32 bytes).
    pub fn store_embedding(
        &self,
        meeting_id: &str,
        chunk_idx: i64,
        text: &str,
        vec: &[f32],
    ) -> Result<(), String> {
        let bytes: Vec<u8> = vec.iter().flat_map(|f| f.to_le_bytes()).collect();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO embeddings (meeting_id, chunk_idx, text, dim, vec)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![meeting_id, chunk_idx, text, vec.len() as i64, bytes],
        )
        .map_err(|e| format!("Failed to store embedding: {e}"))?;
        Ok(())
    }

    /// Load every chunk embedding as (meeting_id, chunk_text, vector).
    pub fn load_all_embeddings(&self) -> Result<Vec<(String, String, Vec<f32>)>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT meeting_id, text, vec FROM embeddings")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                let mid: String = r.get(0)?;
                let text: String = r.get(1)?;
                let bytes: Vec<u8> = r.get(2)?;
                let vec: Vec<f32> = bytes
                    .chunks_exact(4)
                    .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                    .collect();
                Ok((mid, text, vec))
            })
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// How many chunk embeddings are indexed (for the Settings status line).
    pub fn embedding_count(&self) -> Result<i64, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM embeddings", [], |r| r.get(0))
            .map_err(|e| e.to_string())
    }
}

impl Database {
    /// (id, transcript_path) for every meeting that has a transcript on disk.
    pub fn meetings_with_transcripts(&self) -> Result<Vec<(String, String)>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, transcript_path FROM meetings
                 WHERE transcript_path IS NOT NULL AND transcript_path <> ''",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }
}

// ─── Speaker segments (diarization) ──────────────────────────────────────────

impl Database {
    /// Replace a meeting's speaker segments with the given set.
    pub fn store_speaker_segments(
        &self,
        meeting_id: &str,
        segs: &[crate::diarize::SpeakerSegment],
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM speaker_segments WHERE meeting_id = ?1", params![meeting_id])
            .map_err(|e| format!("Failed to clear speaker segments: {e}"))?;
        for (idx, s) in segs.iter().enumerate() {
            conn.execute(
                "INSERT INTO speaker_segments (meeting_id, idx, start_ms, end_ms, speaker, text)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![meeting_id, idx as i64, s.start_ms, s.end_ms, s.speaker, s.text],
            )
            .map_err(|e| format!("Failed to store speaker segment: {e}"))?;
        }
        Ok(())
    }

    /// Load a meeting's speaker segments in order.
    pub fn get_speaker_segments(
        &self,
        meeting_id: &str,
    ) -> Result<Vec<crate::diarize::SpeakerSegment>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT start_ms, end_ms, speaker, text FROM speaker_segments
                 WHERE meeting_id = ?1 ORDER BY idx",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![meeting_id], |r| {
                Ok(crate::diarize::SpeakerSegment {
                    start_ms: r.get(0)?,
                    end_ms: r.get(1)?,
                    speaker: r.get(2)?,
                    text: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }
}
