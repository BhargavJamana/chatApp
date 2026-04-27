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
  await ensureMessagesTableMigrations(pool);
};

module.exports = { runMigrations };
