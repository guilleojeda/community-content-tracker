import { handleAsyncPipelineResult, handlePipelineResult } from '../../../src/backend/utils/pipeline';
import * as core from '@actions/core';

jest.mock('@actions/core', () => ({
  setFailed: jest.fn(),
}));

describe('pipeline helpers', () => {
  const setFailedMock = core.setFailed as jest.Mock;

  beforeEach(() => {
    setFailedMock.mockReset();
  });

  it('returns successful results without failing the pipeline', () => {
    const result = handlePipelineResult({ success: true });

    expect(result.success).toBe(true);
    expect(setFailedMock).not.toHaveBeenCalled();
  });

  it('marks failures when success is false', () => {
    const result = handlePipelineResult({ success: false, error: 'step failed' });

    expect(result.success).toBe(false);
    expect(setFailedMock).toHaveBeenCalledWith('step failed');
  });

  it('handles async success results', async () => {
    const result = await handleAsyncPipelineResult(async () => ({ success: true }));

    expect(result.success).toBe(true);
    expect(setFailedMock).not.toHaveBeenCalled();
  });

  it('handles async failures and throws on exceptions', async () => {
    const result = await handleAsyncPipelineResult(async () => ({ success: false, error: 'oops' }));

    expect(result.success).toBe(false);
    expect(setFailedMock).toHaveBeenCalledWith('oops');

    await expect(handleAsyncPipelineResult(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(setFailedMock).toHaveBeenCalledWith('boom');
  });
});
