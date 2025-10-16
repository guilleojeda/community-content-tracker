/**
 * AddContentForm Component
 * Form for creating new content using React Hook Form
 */

'use client';

import React, { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { ContentType, Visibility, CreateContentRequest } from '../../../shared/types';

interface AddContentFormProps {
  onSubmit: (data: CreateContentRequest) => Promise<void>;
  onCancel: () => void;
}

interface FormData {
  title: string;
  description?: string;
  contentType: ContentType;
  visibility?: Visibility;
  urls: { value: string }[];
  tags: string;
  publishDate?: string;
}

export default function AddContentForm({ onSubmit, onCancel }: AddContentFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      urls: [{ value: '' }],
      visibility: Visibility.PUBLIC,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'urls',
  });

  const onFormSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const urls = data.urls.map((u) => u.value).filter((u) => u.trim() !== '');
      const tags = data.tags
        ? data.tags.split(',').map((t) => t.trim()).filter((t) => t !== '')
        : undefined;

      await onSubmit({
        title: data.title,
        description: data.description,
        contentType: data.contentType,
        visibility: data.visibility,
        urls,
        tags,
        publishDate: data.publishDate,
        isClaimed: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create content');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
          Title *
        </label>
        <input
          id="title"
          type="text"
          {...register('title', { required: 'Title is required' })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
        />
        {errors.title && (
          <p className="mt-1 text-sm text-red-600">{errors.title.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
          Description
        </label>
        <textarea
          id="description"
          {...register('description')}
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      <div>
        <label htmlFor="contentType" className="block text-sm font-medium text-gray-700 mb-1">
          Content Type *
        </label>
        <select
          id="contentType"
          {...register('contentType', { required: 'Content type is required' })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">Select type...</option>
          {Object.values(ContentType).map((type) => (
            <option key={type} value={type}>
              {type.replace('_', ' ')}
            </option>
          ))}
        </select>
        {errors.contentType && (
          <p className="mt-1 text-sm text-red-600">{errors.contentType.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="visibility" className="block text-sm font-medium text-gray-700 mb-1">
          Visibility
        </label>
        <select
          id="visibility"
          {...register('visibility')}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
        >
          {Object.values(Visibility).map((vis) => (
            <option key={vis} value={vis}>
              {vis.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">URLs *</label>
        {fields.map((field, index) => (
          <div key={field.id} className="flex gap-2 mb-2">
            <input
              type="url"
              {...register(`urls.${index}.value`, {
                required: index === 0 ? 'At least one URL is required' : false,
                pattern: {
                  value: /^https?:\/\/.+/,
                  message: 'Please enter a valid URL',
                },
              })}
              placeholder="https://example.com"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              aria-label="URL"
            />
            {fields.length > 1 && (
              <button
                type="button"
                onClick={() => remove(index)}
                className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-md"
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {errors.urls?.[0]?.value && (
          <p className="mt-1 text-sm text-red-600">{errors.urls[0].value.message}</p>
        )}
        <button
          type="button"
          onClick={() => append({ value: '' })}
          className="mt-2 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-md"
        >
          Add another URL
        </button>
      </div>

      <div>
        <label htmlFor="tags" className="block text-sm font-medium text-gray-700 mb-1">
          Tags (comma-separated)
        </label>
        <input
          id="tags"
          type="text"
          {...register('tags')}
          placeholder="aws, serverless, lambda"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      <div>
        <label htmlFor="publishDate" className="block text-sm font-medium text-gray-700 mb-1">
          Publish Date
        </label>
        <input
          id="publishDate"
          type="date"
          {...register('publishDate')}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      <div className="flex gap-3 justify-end pt-4 border-t">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Creating...' : 'Create'}
        </button>
      </div>
    </form>
  );
}
