import { downloadBlob } from '@/utils/download';

describe('downloadBlob', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = jest.fn(() => 'blob://download-link');
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    document.body.innerHTML = '';
  });

  it('creates a temporary anchor and triggers download', () => {
    const blob = new Blob(['test'], { type: 'text/plain' });
    const anchor = document.createElement('a');
    const clickSpy = jest.spyOn(anchor, 'click').mockImplementation(() => {});
    const appendSpy = jest.spyOn(document.body, 'appendChild');
    const removeSpy = jest.spyOn(document.body, 'removeChild');
    jest.spyOn(document, 'createElement').mockReturnValue(anchor);

    downloadBlob(blob, 'report.csv');

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.download).toBe('report.csv');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledWith(anchor);
    expect(removeSpy).toHaveBeenCalledWith(anchor);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob://download-link');
  });

  it('falls back to timestamped filename when none provided', () => {
    const blob = new Blob(['fallback'], { type: 'text/plain' });
    const anchor = document.createElement('a');
    jest.spyOn(anchor, 'click').mockImplementation(() => {});
    jest.spyOn(document, 'createElement').mockReturnValue(anchor);

    downloadBlob(blob, null);

    expect(anchor.download.startsWith('download-')).toBe(true);
  });
});

