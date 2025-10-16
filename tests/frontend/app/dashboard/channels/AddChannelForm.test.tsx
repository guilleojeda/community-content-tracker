import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AddChannelForm from '@/app/dashboard/channels/AddChannelForm';
import { ChannelType } from '@shared/types';

describe('AddChannelForm', () => {
  const onSubmit = jest.fn<Promise<void>, any>();
  const onCancel = jest.fn();

const renderForm = (options?: { disableNativeValidation?: boolean }) => {
  const utils = render(<AddChannelForm onSubmit={onSubmit} onCancel={onCancel} />);

  if (options?.disableNativeValidation) {
    const form = utils.container.querySelector('form');
    if (form) {
      (form as HTMLFormElement).noValidate = true;
    }
  }

  return utils;
};

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires URL before submission', async () => {
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/url is required/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('validates url format', async () => {
    renderForm({ disableNativeValidation: true });

    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/invalid url format/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('enforces youtube domain when type is YouTube', async () => {
    renderForm({ disableNativeValidation: true });

    fireEvent.change(screen.getByLabelText(/channel type/i), { target: { value: ChannelType.YOUTUBE } });
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'https://example.com/video' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/invalid youtube url/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('enforces github domain when type is GitHub', async () => {
    renderForm({ disableNativeValidation: true });

    fireEvent.change(screen.getByLabelText(/channel type/i), { target: { value: ChannelType.GITHUB } });
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'https://example.com/repo' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/invalid github url/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits valid payload and shows saving indicator', async () => {
    const submitPromise = new Promise<void>((resolve) => setTimeout(resolve, 10));
    onSubmit.mockReturnValue(submitPromise);

    renderForm();

    fireEvent.change(screen.getByLabelText(/channel type/i), { target: { value: ChannelType.GITHUB } });
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'https://github.com/user/repo' } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Repo' } });
    fireEvent.change(screen.getByLabelText(/sync frequency/i), { target: { value: 'weekly' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('button', { name: /saving/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        channelType: ChannelType.GITHUB,
        url: 'https://github.com/user/repo',
        name: 'Repo',
        syncFrequency: 'weekly',
        metadata: {},
      });
    });
  });

  it('calls cancel handler on cancel button click', () => {
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
