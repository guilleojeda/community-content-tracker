-- Test users
INSERT INTO users (email, username, profile_slug, default_visibility, is_admin) VALUES
('admin@test.com', 'admin', 'admin', 'public', true),
('cb@test.com', 'cbuser', 'cbuser', 'aws_community', false),
('hero@test.com', 'herouser', 'herouser', 'public', false);

-- Test content
INSERT INTO content (user_id, title, description, content_type, visibility) VALUES
((SELECT id FROM users WHERE email = 'cb@test.com'), 
 'Getting Started with AWS Lambda', 
 'A comprehensive guide to serverless', 
 'blog', 
 'public');

-- Test badges
INSERT INTO user_badges (user_id, badge_type) VALUES
((SELECT id FROM users WHERE email = 'cb@test.com'), 'community_builder'),
((SELECT id FROM users WHERE email = 'hero@test.com'), 'hero');