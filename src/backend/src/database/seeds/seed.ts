/* istanbul ignore file */

import { db } from '../config/database';
import { Visibility, ContentType, BadgeType } from '@aws-community-hub/shared';

/**
 * Development seed data script
 * Creates test data including admin user for local development
 */

export interface SeedUser {
  cognitoSub: string;
  email: string;
  username: string;
  profileSlug: string;
  defaultVisibility: Visibility;
  isAdmin: boolean;
  isAwsEmployee: boolean;
}

export interface SeedContent {
  title: string;
  description: string;
  contentType: ContentType;
  visibility: Visibility;
  urls: string[];
  tags: string[];
  publishDate?: Date;
  isClaimed: boolean;
  originalAuthor?: string;
}

export interface SeedBadge {
  badgeType: BadgeType;
  awardedDate: Date;
  metadata: Record<string, any>;
}

const seedUsers: SeedUser[] = [
  {
    cognitoSub: 'admin-cognito-sub-12345',
    email: 'admin@aws-community.dev',
    username: 'admin',
    profileSlug: 'admin',
    defaultVisibility: Visibility.PUBLIC,
    isAdmin: true,
    isAwsEmployee: true,
  },
  {
    cognitoSub: 'john-doe-cognito-sub-67890',
    email: 'john.doe@example.com',
    username: 'johndoe',
    profileSlug: 'john-doe',
    defaultVisibility: Visibility.AWS_COMMUNITY,
    isAdmin: false,
    isAwsEmployee: false,
  },
  {
    cognitoSub: 'jane-smith-cognito-sub-11111',
    email: 'jane.smith@aws.com',
    username: 'janesmith',
    profileSlug: 'jane-smith',
    defaultVisibility: Visibility.PUBLIC,
    isAdmin: false,
    isAwsEmployee: true,
  },
  {
    cognitoSub: 'community-hero-cognito-sub-22222',
    email: 'hero@community.org',
    username: 'communityhero',
    profileSlug: 'community-hero',
    defaultVisibility: Visibility.PUBLIC,
    isAdmin: false,
    isAwsEmployee: false,
  },
];

const seedContentByUser: Record<string, SeedContent[]> = {
  'johndoe': [
    {
      title: 'Building Serverless Applications with AWS Lambda',
      description: 'A comprehensive guide to creating scalable serverless applications using AWS Lambda, API Gateway, and DynamoDB.',
      contentType: ContentType.BLOG,
      visibility: Visibility.PUBLIC,
      urls: ['https://example.com/serverless-guide'],
      tags: ['aws', 'lambda', 'serverless', 'api-gateway'],
      publishDate: new Date('2024-01-15'),
      isClaimed: true,
    },
    {
      title: 'AWS CDK Best Practices - Conference Talk',
      description: 'Presentation on Infrastructure as Code best practices using AWS CDK.',
      contentType: ContentType.CONFERENCE_TALK,
      visibility: Visibility.AWS_COMMUNITY,
      urls: ['https://youtube.com/watch?v=cdk-best-practices'],
      tags: ['aws', 'cdk', 'infrastructure', 'iac'],
      publishDate: new Date('2024-02-01'),
      isClaimed: true,
    },
  ],
  'janesmith': [
    {
      title: 'AWS Security Best Practices',
      description: 'Essential security practices for AWS workloads and services.',
      contentType: ContentType.YOUTUBE,
      visibility: Visibility.PUBLIC,
      urls: ['https://youtube.com/watch?v=security-best-practices'],
      tags: ['aws', 'security', 'iam', 'vpc'],
      publishDate: new Date('2024-01-20'),
      isClaimed: true,
    },
    {
      title: 'Open Source Monitoring Tools',
      description: 'Collection of open source monitoring and observability tools.',
      contentType: ContentType.GITHUB,
      visibility: Visibility.PUBLIC,
      urls: ['https://github.com/janesmith/monitoring-tools'],
      tags: ['monitoring', 'observability', 'opensource'],
      publishDate: new Date('2024-02-10'),
      isClaimed: true,
    },
  ],
  'communityhero': [
    {
      title: 'Cloud Architecture Patterns Podcast',
      description: 'Weekly podcast discussing cloud architecture patterns and best practices.',
      contentType: ContentType.PODCAST,
      visibility: Visibility.PUBLIC,
      urls: ['https://podcast.example.com/cloud-patterns'],
      tags: ['cloud', 'architecture', 'patterns', 'aws'],
      publishDate: new Date('2024-02-05'),
      isClaimed: true,
    },
  ],
};

const seedBadgesByUser: Record<string, SeedBadge[]> = {
  'janesmith': [
    {
      badgeType: BadgeType.AMBASSADOR,
      awardedDate: new Date('2024-01-01'),
      metadata: { region: 'us-east-1', program: 'technical' },
    },
  ],
  'communityhero': [
    {
      badgeType: BadgeType.COMMUNITY_BUILDER,
      awardedDate: new Date('2024-01-15'),
      metadata: { contributions: 25, events_organized: 5 },
    },
    {
      badgeType: BadgeType.HERO,
      awardedDate: new Date('2024-02-01'),
      metadata: { nomination_source: 'community', votes: 150 },
    },
  ],
  'johndoe': [
    {
      badgeType: BadgeType.USER_GROUP_LEADER,
      awardedDate: new Date('2024-01-20'),
      metadata: { group_name: 'AWS Serverless Developers', members: 500 },
    },
  ],
};

async function clearExistingData(): Promise<void> {
  console.log('Clearing existing seed data...');

  // Delete in correct order due to foreign key constraints
  await db.query('DELETE FROM content_bookmarks');
  await db.query('DELETE FROM user_follows');
  await db.query('DELETE FROM content_analytics');
  await db.query('DELETE FROM content_urls');
  await db.query('DELETE FROM user_badges');
  await db.query('DELETE FROM content');
  await db.query('DELETE FROM users WHERE cognito_sub LIKE \'%-cognito-sub-%\'');

  console.log('Existing seed data cleared.');
}

async function seedUsersData(): Promise<Map<string, string>> {
  console.log('Seeding users...');
  const userIdMap = new Map<string, string>();

  for (const userData of seedUsers) {
    const result = await db.query(`
      INSERT INTO users (cognito_sub, email, username, profile_slug, default_visibility, is_admin, is_aws_employee)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      userData.cognitoSub,
      userData.email,
      userData.username,
      userData.profileSlug,
      userData.defaultVisibility,
      userData.isAdmin,
      userData.isAwsEmployee,
    ]);

    userIdMap.set(userData.username, result.rows[0].id);
    console.log(`Created user: ${userData.username} (${userData.email})`);
  }

  return userIdMap;
}

async function seedContentData(userIdMap: Map<string, string>): Promise<Map<string, string>> {
  console.log('Seeding content...');
  const contentIdMap = new Map<string, string>();

  for (const [username, contentList] of Object.entries(seedContentByUser)) {
    const userId = userIdMap.get(username);
    if (!userId) {
      console.warn(`User ${username} not found, skipping content`);
      continue;
    }

    for (const contentData of contentList) {
      // Insert content
      const contentResult = await db.query(`
        INSERT INTO content (user_id, title, description, content_type, visibility, publish_date, is_claimed, original_author, tags)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [
        userId,
        contentData.title,
        contentData.description,
        contentData.contentType,
        contentData.visibility,
        contentData.publishDate,
        contentData.isClaimed,
        contentData.originalAuthor,
        contentData.tags,
      ]);

      const contentId = contentResult.rows[0].id;
      contentIdMap.set(contentData.title, contentId);

      // Insert content URLs
      for (const url of contentData.urls) {
        await db.query(`
          INSERT INTO content_urls (content_id, url)
          VALUES ($1, $2)
        `, [contentId, url]);
      }

      // Insert analytics record
      await db.query(`
        INSERT INTO content_analytics (content_id, views_count, likes_count, shares_count, comments_count, engagement_score)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        contentId,
        Math.floor(Math.random() * 1000) + 50, // Random views
        Math.floor(Math.random() * 100) + 5,   // Random likes
        Math.floor(Math.random() * 50) + 1,    // Random shares
        Math.floor(Math.random() * 25) + 1,    // Random comments
        Math.random() * 10,                     // Random engagement score
      ]);

      console.log(`Created content: ${contentData.title} for ${username}`);
    }
  }

  return contentIdMap;
}

async function seedBadgesData(userIdMap: Map<string, string>): Promise<void> {
  console.log('Seeding badges...');

  const adminUserId = userIdMap.get('admin');

  for (const [username, badgesList] of Object.entries(seedBadgesByUser)) {
    const userId = userIdMap.get(username);
    if (!userId) {
      console.warn(`User ${username} not found, skipping badges`);
      continue;
    }

    for (const badgeData of badgesList) {
      await db.query(`
        INSERT INTO user_badges (user_id, badge_type, awarded_at, awarded_by, metadata)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        userId,
        badgeData.badgeType,
        badgeData.awardedDate,
        adminUserId, // Admin awarded the badge
        JSON.stringify(badgeData.metadata),
      ]);

      console.log(`Awarded badge ${badgeData.badgeType} to ${username}`);
    }
  }
}

async function seedSocialData(userIdMap: Map<string, string>, contentIdMap: Map<string, string>): Promise<void> {
  console.log('Seeding social data (follows, bookmarks)...');

  const userIds = Array.from(userIdMap.values());
  const contentIds = Array.from(contentIdMap.values());

  // Create some follow relationships
  const johnId = userIdMap.get('johndoe');
  const janeId = userIdMap.get('janesmith');
  const heroId = userIdMap.get('communityhero');

  if (johnId && janeId) {
    await db.query('INSERT INTO user_follows (follower_id, following_id) VALUES ($1, $2)', [johnId, janeId]);
  }
  if (johnId && heroId) {
    await db.query('INSERT INTO user_follows (follower_id, following_id) VALUES ($1, $2)', [johnId, heroId]);
  }
  if (janeId && heroId) {
    await db.query('INSERT INTO user_follows (follower_id, following_id) VALUES ($1, $2)', [janeId, heroId]);
  }

  // Create some bookmarks
  for (let i = 0; i < Math.min(userIds.length, contentIds.length); i++) {
    const randomUserId = userIds[i];
    const randomContentId = contentIds[Math.floor(Math.random() * contentIds.length)];

    try {
      await db.query('INSERT INTO content_bookmarks (user_id, content_id) VALUES ($1, $2)', [randomUserId, randomContentId]);
    } catch (error) {
      // Ignore duplicate bookmarks
    }
  }

  console.log('Social data seeded.');
}

export async function seedDatabase(): Promise<void> {
  try {
    console.log('Starting database seeding...');

    await clearExistingData();
    const userIdMap = await seedUsersData();
    const contentIdMap = await seedContentData(userIdMap);
    await seedBadgesData(userIdMap);
    await seedSocialData(userIdMap, contentIdMap);

    console.log('Database seeding completed successfully!');
    console.log('\\n=== Seed Data Summary ===');
    console.log(`Users created: ${userIdMap.size}`);
    console.log(`Content items created: ${contentIdMap.size}`);
    console.log('\\nTest admin user:');
    console.log('  Email: admin@aws-community.dev');
    console.log('  Username: admin');
    console.log('  Cognito Sub: admin-cognito-sub-12345');
    console.log('\\nOther test users: johndoe, janesmith, communityhero');
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
}

// Allow running this script directly
if (require.main === module) {
  seedDatabase()
    .then(() => {
      console.log('Seed script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seed script failed:', error);
      process.exit(1);
    });
}
