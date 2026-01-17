import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateStaticParams } from '@/app/profile/[username]/page';

describe('profile static params', () => {
  const originalEnv = { ...process.env };
  const createdFiles: string[] = [];

  const writeFile = (contents: string, filePath: string) => {
    fs.writeFileSync(filePath, contents, 'utf8');
    createdFiles.push(filePath);
  };

  afterEach(() => {
    process.env = { ...originalEnv };
    createdFiles.forEach((file) => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
    createdFiles.length = 0;
    jest.restoreAllMocks();
  });

  it('reads static usernames from a JSON array file', () => {
    const filePath = path.join(os.tmpdir(), `profile-usernames-${Date.now()}.json`);
    writeFile(JSON.stringify(['alice', 'bob']), filePath);
    process.env.NEXT_PUBLIC_STATIC_PROFILE_USERNAMES_FILE = filePath;

    const params = generateStaticParams();

    expect(params).toEqual([{ username: 'alice' }, { username: 'bob' }]);
  });

  it('reads static usernames from a JSON object file using a relative path', () => {
    const fileName = `profile-usernames-${Date.now()}.json`;
    const filePath = path.join(process.cwd(), fileName);
    writeFile(JSON.stringify({ usernames: ['casey', '', 'lee'] }), filePath);
    process.env.NEXT_PUBLIC_STATIC_PROFILE_USERNAMES_FILE = fileName;

    const params = generateStaticParams();

    expect(params).toEqual([{ username: 'casey' }, { username: 'lee' }]);
  });

  it('falls back to delimiter parsing when file contents are not JSON', () => {
    const filePath = path.join(os.tmpdir(), `profile-usernames-${Date.now()}-invalid.txt`);
    writeFile('alpha\nbeta\n', filePath);
    process.env.STATIC_PROFILE_USERNAMES_FILE = filePath;

    const params = generateStaticParams();

    expect(params).toEqual([{ username: 'alpha' }, { username: 'beta' }]);
  });

  it('combines env and local API usernames', () => {
    process.env.NEXT_PUBLIC_STATIC_PROFILE_USERNAMES = 'env-one, env-two';
    process.env.LOCAL_API_PROJECTS = 'Project One, AWS Builders';

    const params = generateStaticParams();
    const usernames = params.map((entry) => entry.username);

    expect(usernames).toEqual(
      expect.arrayContaining([
        'env-one',
        'env-two',
        'creator-project-one',
        'builder-project-one',
        'admin-project-one',
        'creator-aws-builders',
        'builder-aws-builders',
        'admin-aws-builders',
      ])
    );
  });

  it('skips empty profile files and falls back to env usernames', () => {
    const filePath = path.join(os.tmpdir(), `profile-usernames-${Date.now()}-empty.json`);
    writeFile('   ', filePath);
    process.env.NEXT_PUBLIC_STATIC_PROFILE_USERNAMES_FILE = filePath;
    process.env.NEXT_PUBLIC_STATIC_PROFILE_USERNAMES = 'env-user';
    jest.spyOn(fs, 'existsSync').mockImplementation((candidate) => candidate === filePath);

    const params = generateStaticParams();

    expect(params).toEqual([{ username: 'env-user' }]);
  });

  it('ignores local API projects that normalize to empty slugs', () => {
    process.env.NEXT_PUBLIC_STATIC_PROFILE_USERNAMES = 'env-user';
    process.env.LOCAL_API_PROJECTS = '!!!';
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);

    const params = generateStaticParams();

    expect(params).toEqual([{ username: 'env-user' }]);
  });

  it('logs when static profile file cannot be read', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const filePath = path.join(os.tmpdir(), `profile-usernames-${Date.now()}-error.json`);
    writeFile(JSON.stringify(['env-user']), filePath);
    process.env.NEXT_PUBLIC_STATIC_PROFILE_USERNAMES_FILE = filePath;
    delete process.env.NEXT_PUBLIC_STATIC_PROFILE_USERNAMES;
    delete process.env.STATIC_PROFILE_USERNAMES;
    delete process.env.LOCAL_API_PROJECTS;
    jest.spyOn(fs, 'existsSync').mockImplementation((candidate) => candidate === filePath);
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('read failed');
    });

    const params = generateStaticParams();

    expect(params).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to read static profile usernames file:',
      expect.any(Error)
    );
  });

  it('warns when no static profile usernames are configured', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    delete process.env.NEXT_PUBLIC_STATIC_PROFILE_USERNAMES;
    delete process.env.STATIC_PROFILE_USERNAMES;
    delete process.env.LOCAL_API_PROJECTS;

    const params = generateStaticParams();

    expect(params).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      'No static profile usernames configured; profile pages will not be pre-rendered.'
    );
  });
});
