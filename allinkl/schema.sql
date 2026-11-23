-- Futter v2 auf all-inkl: MySQL/MariaDB-Schema, 1:1 aus den SQLite-Tabellen (v2_*.py, Stand Build b1-92).
-- Kennungen und Hashes binär verglichen (utf8mb4_bin), wie SQLite. Fremdschlüssel mit ON DELETE CASCADE wie dort
-- (SQLite läuft mit PRAGMA foreign_keys = ON). Zeiten bleiben im selben Format (ISO-Text bzw. Unix-Sekunden).
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS e2e_spaces (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  read_hash CHAR(64) NOT NULL,
  write_hash CHAR(64) NOT NULL,
  epoch INT NOT NULL DEFAULT 1,
  consent_version VARCHAR(32) NOT NULL,
  consent_at VARCHAR(40) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  owner_email_hmac CHAR(64) NULL, owner_email_enc TEXT NULL,
  beitritt_hmac CHAR(64) NULL, beitritt_enc TEXT NULL,
  KEY e2e_spaces_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS e2e_fotos (
  space_id VARCHAR(64) NOT NULL,
  id VARCHAR(64) NOT NULL,
  bytes INT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (space_id, id),
  CONSTRAINT e2e_fotos_space FOREIGN KEY (space_id) REFERENCES e2e_spaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS e2e_records (
  space_id VARCHAR(64) NOT NULL,
  id VARCHAR(64) NOT NULL,
  analyse MEDIUMTEXT NOT NULL,
  privat MEDIUMTEXT NULL,
  client_updated_at VARCHAR(40) NULL,
  updated_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (space_id, id),
  CONSTRAINT e2e_records_space FOREIGN KEY (space_id) REFERENCES e2e_spaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS email_codes (
  zweck VARCHAR(80) NOT NULL,
  email_hmac CHAR(64) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at DOUBLE NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  PRIMARY KEY (zweck, email_hmac)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS kursleitende (
  email_hmac CHAR(64) NOT NULL PRIMARY KEY,
  email_enc TEXT NOT NULL,
  name_enc TEXT NULL, org_enc TEXT NULL, text_enc TEXT NULL,
  status VARCHAR(16) NOT NULL,
  via VARCHAR(16) NOT NULL,
  created_at VARCHAR(40) NOT NULL, decided_at VARCHAR(40) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS einladungen (
  code_hash CHAR(64) NOT NULL PRIMARY KEY,
  hinweis VARCHAR(16) NOT NULL,
  notiz TEXT NULL,
  max_uses INT NOT NULL, uses INT NOT NULL DEFAULT 0,
  expires_at DOUBLE NOT NULL, revoked INT NOT NULL DEFAULT 0,
  created_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS kurse (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  join_hash CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  pending_email_hmac CHAR(64) NULL, pending_einladung VARCHAR(64) NULL,
  meta_analyse MEDIUMTEXT NULL, meta_privat MEDIUMTEXT NULL,
  consent_version VARCHAR(32) NOT NULL,
  naechste_nr INT NOT NULL DEFAULT 1,
  created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL,
  link_enc TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS kurs_teilnehmende (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  kurs_id VARCHAR(64) NOT NULL,
  email_hmac CHAR(64) NULL, email_enc TEXT NULL,
  name_privat TEXT NULL,
  rolle VARCHAR(16) NOT NULL,
  consent_version VARCHAR(32) NOT NULL, consent_at VARCHAR(40) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  UNIQUE KEY kurs_teilnehmende_email (kurs_id, email_hmac),
  CONSTRAINT kurs_teilnehmende_kurs FOREIGN KEY (kurs_id) REFERENCES kurse (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS kurs_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  teilnehmer_id VARCHAR(64) NOT NULL,
  kurs_id VARCHAR(64) NOT NULL,
  expires_at DOUBLE NOT NULL,
  CONSTRAINT kurs_sessions_tn FOREIGN KEY (teilnehmer_id) REFERENCES kurs_teilnehmende (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS kurs_proben (
  kurs_id VARCHAR(64) NOT NULL,
  id VARCHAR(64) NOT NULL, nr INT NOT NULL, sort INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL,
  owner_id VARCHAR(64) NULL,
  analyse MEDIUMTEXT NULL, privat MEDIUMTEXT NULL,
  labor MEDIUMTEXT NULL,
  updated_at VARCHAR(40) NOT NULL,
  pool_id VARCHAR(64) NULL,
  PRIMARY KEY (kurs_id, id),
  CONSTRAINT kurs_proben_kurs FOREIGN KEY (kurs_id) REFERENCES kurse (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS kurs_beurteilungen (
  kurs_id VARCHAR(64) NOT NULL,
  probe_id VARCHAR(64) NOT NULL,
  teilnehmer_id VARCHAR(64) NOT NULL,
  analyse MEDIUMTEXT NOT NULL, privat MEDIUMTEXT NULL,
  abgegeben_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (kurs_id, probe_id, teilnehmer_id),
  CONSTRAINT kurs_beurteilungen_kurs FOREIGN KEY (kurs_id) REFERENCES kurse (id) ON DELETE CASCADE,
  CONSTRAINT kurs_beurteilungen_tn FOREIGN KEY (teilnehmer_id) REFERENCES kurs_teilnehmende (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS kurs_fotos (
  kurs_id VARCHAR(64) NOT NULL,
  id VARCHAR(64) NOT NULL,
  teilnehmer_id VARCHAR(64) NOT NULL,
  probe_id VARCHAR(64) NOT NULL, art VARCHAR(16) NOT NULL,
  bytes INT NOT NULL, created_at VARCHAR(40) NOT NULL,
  zweck VARCHAR(16) NOT NULL DEFAULT 'probe',
  PRIMARY KEY (kurs_id, id),
  CONSTRAINT kurs_fotos_kurs FOREIGN KEY (kurs_id) REFERENCES kurse (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS pool_proben (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  creator_hmac CHAR(64) NOT NULL,
  typ VARCHAR(16) NOT NULL,
  daten_enc MEDIUMTEXT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  sammlung VARCHAR(80) NULL, oeffentlich INT NOT NULL DEFAULT 0, quelle_kurs VARCHAR(64) NULL, quelle_probe VARCHAR(64) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS pool_fotos (
  pool_id VARCHAR(64) NOT NULL,
  id VARCHAR(64) NOT NULL, bytes INT NOT NULL,
  PRIMARY KEY (pool_id, id),
  CONSTRAINT pool_fotos_pool FOREIGN KEY (pool_id) REFERENCES pool_proben (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS beitraege (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  typ VARCHAR(16) NOT NULL, plz VARCHAR(8) NOT NULL, region VARCHAR(4) NOT NULL,
  jahr INT NULL, aufwuchs VARCHAR(16) NULL,
  daten MEDIUMTEXT NOT NULL,
  consent_version VARCHAR(32) NOT NULL,
  created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL,
  KEY beitraege_vergleich (typ, region)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS konten (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  email_hmac CHAR(64) NOT NULL UNIQUE,
  email_enc TEXT NOT NULL,
  cloud_futter INT NOT NULL DEFAULT 0,
  cloud_wiese INT NOT NULL DEFAULT 0,
  consent_version VARCHAR(32) NULL, consent_at VARCHAR(40) NULL,
  created_at VARCHAR(40) NOT NULL, last_seen VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS konto_links (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  email_hmac CHAR(64) NOT NULL,
  email_enc TEXT NOT NULL,
  secret_hash CHAR(64) NOT NULL,
  created_at VARCHAR(40) NOT NULL, expires_at DOUBLE NOT NULL,
  used_at VARCHAR(40) NULL, revoked INT NOT NULL DEFAULT 0,
  KEY konto_links_email (email_hmac)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS konto_sessions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  konto_id VARCHAR(64) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  via VARCHAR(16) NOT NULL,
  geraet VARCHAR(200) NULL,
  created_at VARCHAR(40) NOT NULL, last_used VARCHAR(40) NOT NULL, expires_at DOUBLE NOT NULL,
  CONSTRAINT konto_sessions_konto FOREIGN KEY (konto_id) REFERENCES konten (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS konto_daten (
  konto_id VARCHAR(64) NOT NULL,
  app VARCHAR(16) NOT NULL, id VARCHAR(64) NOT NULL,
  data MEDIUMTEXT NULL,
  bytes INT NOT NULL DEFAULT 0,
  client_updated_at VARCHAR(40) NULL, updated_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (konto_id, app, id),
  KEY konto_daten_seit (konto_id, app, updated_at),
  CONSTRAINT konto_daten_konto FOREIGN KEY (konto_id) REFERENCES konten (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS konto_fotos (
  konto_id VARCHAR(64) NOT NULL,
  id VARCHAR(64) NOT NULL, app VARCHAR(16) NOT NULL, bytes INT NOT NULL, created_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (konto_id, id),
  CONSTRAINT konto_fotos_konto FOREIGN KEY (konto_id) REFERENCES konten (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS foto_quota (
  email_hmac CHAR(64) NOT NULL PRIMARY KEY,
  mb INT NOT NULL,
  decided_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS quota_antraege (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  email_hmac CHAR(64) NOT NULL,
  email_enc TEXT NOT NULL,
  bereich VARCHAR(16) NOT NULL,
  wunsch_mb INT NOT NULL,
  text_enc TEXT NULL,
  status VARCHAR(16) NOT NULL,
  created_at VARCHAR(40) NOT NULL, decided_at VARCHAR(40) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS rueckmeldungen (
  nr BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,   -- ersetzt SQLite rowid (Reihenfolge)
  id VARCHAR(32) NOT NULL UNIQUE,
  datum CHAR(10) NOT NULL,
  app VARCHAR(16) NOT NULL,
  daumen VARCHAR(8) NOT NULL,
  text_enc TEXT NULL,
  build VARCHAR(16) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS zentral_sitzungen (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  sub VARCHAR(120) NULL, name VARCHAR(120) NULL, methode VARCHAR(60) NULL,
  created_at BIGINT NULL, expires_at BIGINT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS zentral_ausweise (
  jti VARCHAR(200) NOT NULL PRIMARY KEY,
  expires_at BIGINT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Neu (statt Arbeitsspeicher in Flask): Ratenbegrenzung, Schlüssel = Hash aus Zweck und gehashter IP
CREATE TABLE IF NOT EXISTS rate_treffer (
  nr BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  schluessel CHAR(32) NOT NULL,
  zeit DOUBLE NOT NULL,
  KEY rate_treffer_k (schluessel, zeit)
) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin;
