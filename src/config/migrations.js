const ensureUsersTableMigrations = async (pool) => {
  const [tableRows] = await pool.query("SHOW TABLES LIKE 'users'");
  if (!tableRows.length) {
    console.warn("Skipping user migrations: 'users' table not found.");
    return;
  }

  const hasColumn = async (columnName) => {
    const [rows] = await pool.query('SHOW COLUMNS FROM users LIKE ?', [columnName]);
    return rows.length > 0;
  };

  const hasIndex = async (indexName) => {
    const [rows] = await pool.query('SHOW INDEX FROM users WHERE Key_name = ?', [indexName]);
    return rows.length > 0;
  };

  if (!(await hasColumn('public_id'))) {
    await pool.query('ALTER TABLE users ADD COLUMN public_id VARCHAR(24) NULL AFTER avatar');
  }

  const [usersToBackfill] = await pool.query(
    'SELECT id FROM users WHERE public_id IS NULL OR public_id = "" ORDER BY id ASC'
  );

  for (const row of usersToBackfill) {
    const publicId = `CHAT-${String(row.id).padStart(6, '0')}`;
    await pool.query('UPDATE users SET public_id = ? WHERE id = ?', [publicId, row.id]);
  }

  if (!(await hasIndex('idx_users_public_id'))) {
    await pool.query('CREATE UNIQUE INDEX idx_users_public_id ON users (public_id)');
  }
};

const ensureMessagesTableMigrations = async (pool) => {
  const [tableRows] = await pool.query("SHOW TABLES LIKE 'messages'");
  if (!tableRows.length) {
    console.warn("Skipping message migrations: 'messages' table not found.");
    return;
  }

  const hasColumn = async (columnName) => {
    const [rows] = await pool.query('SHOW COLUMNS FROM messages LIKE ?', [columnName]);
    return rows.length > 0;
  };

  const hasIndex = async (indexName) => {
    const [rows] = await pool.query('SHOW INDEX FROM messages WHERE Key_name = ?', [indexName]);
    return rows.length > 0;
  };

  if (!(await hasColumn('client_message_id'))) {
    await pool.query('ALTER TABLE messages ADD COLUMN client_message_id VARCHAR(64) NULL AFTER message_type');
  }

  if (!(await hasColumn('delivery_status'))) {
    await pool.query(
      "ALTER TABLE messages ADD COLUMN delivery_status ENUM('sent','delivered','seen') NOT NULL DEFAULT 'sent' AFTER client_message_id"
    );
  }

  if (!(await hasColumn('delivered_at'))) {
    await pool.query('ALTER TABLE messages ADD COLUMN delivered_at TIMESTAMP NULL DEFAULT NULL AFTER delivery_status');
  }

  if (!(await hasColumn('seen_at'))) {
    await pool.query('ALTER TABLE messages ADD COLUMN seen_at TIMESTAMP NULL DEFAULT NULL AFTER delivered_at');
  }

  if (!(await hasIndex('idx_messages_client_message_id'))) {
    await pool.query('CREATE UNIQUE INDEX idx_messages_client_message_id ON messages (client_message_id)');
  }
};

const runMigrations = async (pool) => {
  await ensureUsersTableMigrations(pool);
  await ensureMessagesTableMigrations(pool);
  // call logs
  await ensureCallLogsMigrations(pool);
  await ensureCallAttachmentsMigrations(pool);
};

module.exports = { runMigrations };

async function ensureCallLogsMigrations(pool) {
  const [rows] = await pool.query("SHOW TABLES LIKE 'call_logs'");
  if (rows.length) return;

  await pool.query(
    `CREATE TABLE IF NOT EXISTS call_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      caller_id BIGINT UNSIGNED NOT NULL,
      callee_id BIGINT UNSIGNED NOT NULL,
      call_type ENUM('audio','video') NOT NULL DEFAULT 'audio',
      status ENUM('missed','completed','rejected','failed') NOT NULL DEFAULT 'completed',
      started_at DATETIME NOT NULL,
      ended_at DATETIME DEFAULT NULL,
      duration_seconds INT UNSIGNED DEFAULT NULL,
      recording_url VARCHAR(1024) DEFAULT NULL,
      metadata JSON DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_caller (caller_id),
      INDEX idx_callee (callee_id),
      INDEX idx_started_at (started_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );
}

async function ensureCallAttachmentsMigrations(pool) {
  const [rows] = await pool.query("SHOW TABLES LIKE 'call_attachments'");
  if (rows.length) return;

  await pool.query(
    `CREATE TABLE IF NOT EXISTS call_attachments (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      call_log_id BIGINT UNSIGNED NULL,
      message_id BIGINT UNSIGNED NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      type ENUM('image','voice','recording','other') NOT NULL,
      url VARCHAR(1024) NOT NULL,
      mime_type VARCHAR(255) DEFAULT NULL,
      size_bytes BIGINT UNSIGNED DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_call_log (call_log_id),
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );
}
