-- Down migration for 011_update_gdpr_export.sql
-- Restores the previous version of export_user_data without extended associations

CREATE OR REPLACE FUNCTION export_user_data(user_uuid UUID)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'user', to_json(u.*),
        'content', COALESCE(content_array.content, '[]'::json),
        'badges', COALESCE(badges_array.badges, '[]'::json),
        'bookmarks', COALESCE(bookmarks_array.bookmarks, '[]'::json),
        'follows', json_build_object(
          'following', COALESCE(following_array.following, '[]'::json),
          'followers', COALESCE(followers_array.followers, '[]'::json)
        ),
        'export_date', NOW()
    ) INTO result
    FROM users u
    LEFT JOIN (
        SELECT user_id, json_agg(to_json(c.*)) AS content
        FROM content c
        WHERE c.user_id = user_uuid
        GROUP BY user_id
    ) content_array ON u.id = content_array.user_id
    LEFT JOIN (
        SELECT user_id, json_agg(to_json(ub.*)) AS badges
        FROM user_badges ub
        WHERE ub.user_id = user_uuid
          AND ub.is_active = true
        GROUP BY user_id
    ) badges_array ON u.id = badges_array.user_id
    LEFT JOIN (
        SELECT user_id, json_agg(to_json(cb.*)) AS bookmarks
        FROM content_bookmarks cb
        WHERE cb.user_id = user_uuid
        GROUP BY user_id
    ) bookmarks_array ON u.id = bookmarks_array.user_id
    LEFT JOIN (
        SELECT follower_id AS user_id, json_agg(to_json(uf.*)) AS following
        FROM user_follows uf
        WHERE uf.follower_id = user_uuid
        GROUP BY follower_id
    ) following_array ON u.id = following_array.user_id
    LEFT JOIN (
        SELECT following_id AS user_id, json_agg(to_json(uf.*)) AS followers
        FROM user_follows uf
        WHERE uf.following_id = user_uuid
        GROUP BY following_id
    ) followers_array ON u.id = followers_array.user_id
    WHERE u.id = user_uuid;

    RETURN result;
END;
$$ LANGUAGE plpgsql;
