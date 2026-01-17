import { createSendMessageCommand } from '../../../src/backend/utils/sqs';

jest.mock('@aws-sdk/client-sqs', () => {
  class SendMessageCommand {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  return { SendMessageCommand };
});

describe('createSendMessageCommand', () => {
  it('falls back when Object.defineProperty throws', () => {
    const originalDefineProperty = Object.defineProperty;
    const defineSpy = jest.spyOn(Object, 'defineProperty');

    defineSpy
      .mockImplementationOnce(() => {
        throw new Error('fail input');
      })
      .mockImplementationOnce(() => {
        throw new Error('fail key');
      })
      .mockImplementation(originalDefineProperty);

    const command = createSendMessageCommand({
      QueueUrl: 'https://example.com/queue',
      MessageBody: 'payload',
    });

    expect(command.input).toEqual({
      QueueUrl: 'https://example.com/queue',
      MessageBody: 'payload',
    });
    expect((command as any).QueueUrl).toBe('https://example.com/queue');
    expect((command as any).MessageBody).toBe('payload');

    defineSpy.mockRestore();
  });
});
