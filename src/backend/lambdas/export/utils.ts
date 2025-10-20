import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { anonymizeIp } from '../../utils/ip-anonymization';

export interface LogExportEventOptions {
  pool: Pool;
  userId: string;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata: Record<string, any>;
}

/**
 * Persist an export event to analytics_events for history tracking.
 */
export async function logExportEvent({
  pool,
  userId,
  sessionId,
  ipAddress,
  userAgent,
  metadata,
}: LogExportEventOptions): Promise<void> {
  const resolvedSessionId = sessionId ?? randomUUID();
  const normalizedIp = anonymizeIp(ipAddress ?? null);
  const safeMetadata = {
    exportType: metadata.exportType ?? 'program',
    ...metadata,
    generatedAt: metadata.generatedAt ?? new Date().toISOString(),
  };

  await pool.query(
    `
      INSERT INTO analytics_events (user_id, event_type, session_id, ip_address, user_agent, metadata)
      VALUES ($1, 'export', $2, $3, $4, $5::jsonb)
    `,
    [userId, resolvedSessionId, normalizedIp, userAgent ?? null, JSON.stringify(safeMetadata)]
  );
}
