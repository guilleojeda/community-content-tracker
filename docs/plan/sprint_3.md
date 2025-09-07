Sprint 3: Content Management Core
Goal: Implement basic content CRUD operationsTask 3.1: Content Management API - Create
Epic: E4
Story Points: 5
Dependencies: Tasks 2.3, 2.4User Story: As a user, I want to manually add content so that I can track my contributions.Acceptance Criteria:

 POST /content endpoint implemented
 Visibility defaults to user's preference
 Content type validation (including conference_talk and podcast)
 URL deduplication check
 Tags properly stored as array
 Owner verification via JWT
 Support for unclaimed content (is_claimed = false, original_author field)
 Response includes created content with ID
Test Case:
typescripttest('should create unclaimed content for later claiming', async () => {
  const adminToken = await getAdminAuthToken();
  
  const response = await api.post('/content')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      title: 'AWS re:Invent Keynote',
      contentType: 'conference_talk',
      urls: ['https://youtube.com/watch?v=keynote'],
      originalAuthor: 'Werner Vogels',
      isClaimed: false
    });
  
  expect(response.body.isClaimed).toBe(false);
  expect(response.body.originalAuthor).toBe('Werner Vogels');
});Task 3.2: Content Management API - Read
Epic: E4
Story Points: 3
Dependencies: Task 3.1User Story: As a user, I want to view my content so that I can manage my portfolio.Acceptance Criteria:

 GET /content endpoint (list user's content)
 GET /content/:id endpoint (single content)
 GET /content/unclaimed endpoint (list unclaimed content for claiming)
 Pagination support (limit/offset)
 Sorting by date, title
 Visibility filtering respected
 Include all URLs for each content
 404 for non-existent content
Task 3.3: Content Management API - Update
Epic: E4
Story Points: 3
Dependencies: Task 3.1User Story: As a user, I want to update my content so that I can keep information current.Acceptance Criteria:

 PUT /content/:id endpoint
 Only owner can update (or admin)
 Visibility can be changed
 Tags can be modified
 Updated timestamp tracked
 Optimistic locking for concurrent updates
 403 for non-owner attempts
Task 3.4: Content Management API - Delete
Epic: E4
Story Points: 2
Dependencies: Task 3.1User Story: As a user, I want to delete my content so that I can remove outdated items.Acceptance Criteria:

 DELETE /content/:id endpoint
 Only owner can delete (or admin)
 Cascade delete for content_urls
 Soft delete option for audit trail
 204 No Content on success
 403 for non-owner attempts
Task 3.5: Content Claiming API
Epic: E4
Story Points: 5
Dependencies: Tasks 3.1, 3.2User Story: As a user, I want to claim my unclaimed content so that it appears in my portfolio.Acceptance Criteria:

 POST /content/:id/claim endpoint
 Verify user identity matches original_author (flexible matching)
 Update is_claimed flag and set user_id
 Admin override capability
 Bulk claim endpoint for multiple items
 Notification to admin for review (optional)
Test Case:
typescripttest('should allow user to claim matching content', async () => {
  const unclaimedContent = await createUnclaimedContent({
    originalAuthor: 'John Doe'
  });
  
  const user = await createUser({ username: 'johndoe' });
  const token = await getAuthToken(user);
  
  await api.post(`/content/${unclaimedContent.id}/claim`)
    .set('Authorization', `Bearer ${token}`);
  
  const claimed = await contentRepo.findById(unclaimedContent.id);
  expect(claimed.userId).toBe(user.id);
  expect(claimed.isClaimed).toBe(true);
});Task 3.6: Badge Management API
Epic: E2
Story Points: 5
Dependencies: Task 2.3User Story: As an admin, I want to manage user badges and AWS employee status so that users are properly identified.Acceptance Criteria:

 POST /admin/badges endpoint (grant badge)
 DELETE /admin/badges endpoint (revoke badge)
 PUT /admin/users/:id/aws-employee endpoint (mark as AWS employee)
 GET /users/:id/badges endpoint (public)
 Badge history tracking
 Bulk operations support
 Admin authentication required
Badge Grant Test:
typescripttest('should mark user as AWS employee', async () => {
  const admin = await createAdminUser();
  const user = await createTestUser();
  
  await api.put(`/admin/users/${user.id}/aws-employee`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ isAwsEmployee: true });
  
  const updated = await userRepo.findById(user.id);
  expect(updated.isAwsEmployee).toBe(true);
});Task 3.7: Content Merge API
Epic: E4
Story Points: 5
Dependencies: Tasks 3.1, 3.2User Story: As a user, I want to merge duplicate content so that my portfolio is clean.Acceptance Criteria:

 POST /content/merge endpoint
 Merge two or more content items
 Combine URLs from all items
 Preserve earliest publish date
 Keep best metadata (most complete)
 Audit trail of merge operations
 Undo capability within 30 days
Merge Test:
typescripttest('should merge duplicate content items', async () => {
  const content1 = await createContent({ 
    title: 'AWS Lambda Tutorial',
    urls: ['https://blog1.com/lambda']
  });
  const content2 = await createContent({ 
    title: 'AWS Lambda Tutorial',
    urls: ['https://medium.com/@user/lambda']
  });
  
  const merged = await api.post('/content/merge')
    .send({ contentIds: [content1.id, content2.id], primaryId: content1.id });
  
  expect(merged.body.urls).toHaveLength(2);
});