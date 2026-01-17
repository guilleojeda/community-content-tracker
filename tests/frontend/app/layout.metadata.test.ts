jest.mock('identity-obj-proxy', () => ({}), { virtual: true });

describe('RootLayout metadata', () => {
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://awscommunityhub.org';
    jest.resetModules();
    jest.doMock('../../../src/frontend/src/styles/globals.css', () => ({}), { virtual: true });
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  });

  it('exposes SEO metadata fields for the public site', async () => {
    const layoutModule = await import('../../../src/frontend/app/layout');
    const { metadata } = layoutModule;

    expect(metadata.title).toBe('AWS Community Content Hub');
    expect(metadata.description).toBe('Discover and track AWS community content from contributors worldwide');
    expect(metadata.keywords).toBe('AWS, community, content, developers, cloud computing');
    expect(metadata.metadataBase?.href).toBe('https://awscommunityhub.org/');
  });
});
