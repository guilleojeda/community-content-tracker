-- 011_update_gdpr_export.sql
-- Migration: Enhance GDPR export payload with channels, bookmarks, follows, consent records, and content URLs
-- Sprint: 8
-- Date: 2025-01-10

CREATE OR REPLACE FUNCTION export_user_data(user_uuid UUID)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'user', to_json(u.*),
        'content', COALESCE(content_array.content, '[]'::json),
        'badges', COALESCE(badges_array.badges, '[]'::json),
        'channels', COALESCE(channels_array.channels, '[]'::json),
        'bookmarks', COALESCE(bookmarks_array.bookmarks, '[]'::json),
        'follows', json_build_object(
            'following', COALESCE(following_array.following, '[]'::json),
            'followers', COALESCE(followers_array.followers, '[]'::json)
        ),
        'consents', COALESCE(consents_array.consents, '[]'::json),
        'export_date', NOW()
    ) INTO result
    FROM users u
    LEFT JOIN (
        SELECT
            c.user_id,
            json_agg(
                json_build_object(
                    'id', c.id,
                    'user_id', c.user_id,
                    'title', c.title,
                    'description', c.description,
                    'content_type', c.content_type,
                    'visibility', c.visibility,
                    'publish_date', c.publish_date,
                    'capture_date', c.capture_date,
                    'metrics', c.metrics,
                    'tags', c.tags,
                    'embedding', c.embedding,
                    'is_claimed', c.is_claimed,
                    'original_author', c.original_author,
                    'created_at', c.created_at,
                    'updated_at', c.updated_at,
                    'urls', COALESCE(
                        (
                            SELECT json_agg(json_build_object('id', cu.id, 'url', cu.url) ORDER BY cu.created_at ASC)
                            FROM content_urls cu
                            WHERE cu.content_id = c.id
                        ),
                        '[]'::json
                    )
                ) ORDER BY c.created_at DESC
            ) AS content
        FROM content c
        WHERE c.user_id = user_uuid
        GROUP BY c.user_id
    ) content_array ON u.id = content_array.user_id
    LEFT JOIN (
        SELECT
            ub.user_id,
            json_agg(
                json_build_object(
                    'id', ub.id,
                    'user_id', ub.user_id,
                    'badge_type', ub.badge_type,
                    'awarded_at', ub.awarded_at,
                    'awarded_by', ub.awarded_by,
                    'awarded_reason', ub.awarded_reason,
                    'metadata', ub.metadata,
                    'is_active', ub.is_active,
                    'revoked_at', ub.revoked_at,
                    'revoked_by', ub.revoked_by,
                    'revoke_reason', ub.revoke_reason,
                    'created_at', ub.created_at,
                    'updated_at', ub.updated_at
                ) ORDER BY ub.awarded_at DESC
            ) AS badges
        FROM user_badges ub
        WHERE ub.user_id = user_uuid
          AND ub.is_active = true
        GROUP BY ub.user_id
    ) badges_array ON u.id = badges_array.user_id
    LEFT JOIN (
        SELECT
            ch.user_id,
            json_agg(
                json_build_object(
                    'id', ch.id,
                    'user_id', ch.user_id,
                    'channel_type', ch.channel_type,
                    'url', ch.url,
                    'name', ch.name,
                    'enabled', ch.enabled,
                    'last_sync_at', ch.last_sync_at,
                    'last_sync_status', ch.last_sync_status,
                    'last_sync_error', ch.last_sync_error,
                    'sync_frequency', ch.sync_frequency,
                    'metadata', ch.metadata,
                    'created_at', ch.created_at,
                    'updated_at', ch.updated_at
                ) ORDER BY ch.created_at DESC
            ) AS channels
        FROM channels ch
        WHERE ch.user_id = user_uuid
        GROUP BY ch.user_id
    ) channels_array ON u.id = channels_array.user_id
    LEFT JOIN (
        SELECT
            cb.user_id,
            json_agg(
                json_build_object(
                    'id', cb.id,
                    'user_id', cb.user_id,
                    'content_id', cb.content_id,
                    'created_at', cb.created_at
                ) ORDER BY cb.created_at DESC
            ) AS bookmarks
        FROM content_bookmarks cb
        WHERE cb.user_id = user_uuid
        GROUP BY cb.user_id
    ) bookmarks_array ON u.id = bookmarks_array.user_id
    LEFT JOIN (
        SELECT
            uf.follower_id AS user_id,
            json_agg(
                json_build_object(
                    'follower_id', uf.follower_id,
                    'following_id', uf.following_id,
                    'created_at', uf.created_at
                ) ORDER BY uf.created_at DESC
            ) AS following
        FROM user_follows uf
        WHERE uf.follower_id = user_uuid
        GROUP BY uf.follower_id
    ) following_array ON u.id = following_array.user_id
    LEFT JOIN (
        SELECT
            uf.following_id AS user_id,
            json_agg(
                json_build_object(
                    'follower_id', uf.follower_id,
                    'following_id', uf.following_id,
                    'created_at', uf.created_at
                ) ORDER BY uf.created_at DESC
            ) AS followers
        FROM user_follows uf
        WHERE uf.following_id = user_uuid
        GROUP BY uf.following_id
    ) followers_array ON u.id = followers_array.user_id
    LEFT JOIN (
        SELECT
            uc.user_id,
            json_agg(
                json_build_object(
                    'id', uc.id,
                    'consent_type', uc.consent_type,
                    'granted', uc.granted,
                    'consent_version', uc.consent_version,
                    'granted_at', uc.granted_at,
                    'revoked_at', uc.revoked_at,
                    'ip_address', uc.ip_address,
                    'user_agent', uc.user_agent,
                    'created_at', uc.created_at,
                    'updated_at', uc.updated_at
                ) ORDER BY uc.consent_type
            ) AS consents
        FROM user_consent uc
        WHERE uc.user_id = user_uuid
        GROUP BY uc.user_id
    ) consents_array ON u.id = consents_array.user_id
    WHERE u.id = user_uuid;

    RETURN result;
END;
$$ LANGUAGE plpgsql;
