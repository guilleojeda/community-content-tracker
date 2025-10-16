import * as core from '@actions/core';

export interface PipelineResult {
  success: boolean;
  error?: string;
}

export function handlePipelineResult<T extends PipelineResult>(result: T): T {
  if (!result.success) {
    const message = result.error ?? 'Pipeline step failed';
    core.setFailed(message);
  }

  return result;
}

export async function handleAsyncPipelineResult<T extends PipelineResult>(
  task: () => Promise<T>
): Promise<T> {
  try {
    const result = await task();
    return handlePipelineResult(result);
  } catch (error: any) {
    const message = error?.message ?? 'Pipeline step threw an unexpected error';
    core.setFailed(message);
    throw error;
  }
}
