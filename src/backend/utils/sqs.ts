import { SendMessageCommand, SendMessageCommandInput } from '@aws-sdk/client-sqs';

type CommandFactory<TInput, TCommand> = new (input: TInput) => TCommand;

function normalizeCommand<TInput extends Record<string, unknown>, TCommand extends Record<string, unknown>>(
  CommandCtor: CommandFactory<TInput, TCommand>,
  input: TInput
): TCommand {
  const command: any = new CommandCtor(input);

  const normalizedInput = { ...input };

  try {
    Object.defineProperty(command, 'input', {
      value: normalizedInput,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } catch {
    command.input = normalizedInput;
  }

  for (const [key, value] of Object.entries(normalizedInput)) {
    if (!(key in command)) {
      try {
        Object.defineProperty(command, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } catch {
        command[key] = value;
      }
    }
  }

  return command;
}

export function createSendMessageCommand(input: SendMessageCommandInput): SendMessageCommand {
  return normalizeCommand(SendMessageCommand, input);
}
