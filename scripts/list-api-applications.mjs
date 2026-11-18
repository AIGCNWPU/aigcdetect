import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const target = process.argv[2] || path.join(process.env.VERITAS_DATA_DIR || path.join(process.cwd(), 'tmp', 'data'), 'app.db');
const db = new DatabaseSync(target, { readOnly: true });
try {
  const applications = db.prepare(`
    SELECT id, email, organization, use_case AS useCase, monthly_volume AS monthlyVolume, created_at AS createdAt
    FROM api_applications
    ORDER BY created_at DESC, id DESC
  `).all();
  process.stdout.write(JSON.stringify(applications, null, 2) + '\n');
} finally {
  db.close();
}
