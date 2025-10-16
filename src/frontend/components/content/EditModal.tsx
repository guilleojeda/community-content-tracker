/**
 * EditModal Component
 * Modal for editing existing content
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { Content, ContentType, Visibility } from '../../../shared/types';

interface EditModalProps {
  content: Content;
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, data: Partial<Content>) => Promise<void>;
}

interface FormData {
  title: string;
  description?: string;
  contentType: ContentType;
  visibility: Visibility;
  urls: { value: string }[];
  tags: string;
  publishDate?: string;
}

export default function EditModal({ content, isOpen, onClose, onSave }: EditModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormData>();

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'urls',
  });

  useEffect(() => {
    if (isOpen && content) {
      reset({
        title: content.title,
        description: content.description || '',
        contentType: content.contentType,
        visibility: content.visibility,
        urls: content.urls.map((url) => ({ value: url.url })),
        tags: content.tags?.join(', ') || '',
        publishDate: content.publishDate
          ? new Date(content.publishDate).toISOString().split('T')[0]
          : '',
      });
    }
  }, [isOpen, content, reset]);

  const onFormSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const urls = data.urls.map((u) => u.value).filter((u) => u.trim() !== '');
      const tags = data.tags
        ? data.tags.split(',').map((t) => t.trim()).filter((t) => t !== '')
        : undefined;

      await onSave(content.id, {
        title: data.title,
        description: data.description,
        contentType: data.contentType,
        visibility: data.visibility,
        urls: urls as any,
        tags,
        publishDate: data.publishDate ? new Date(data.publishDate) : undefined,
      });

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update content');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="p-6">
          <h2 className="text-2xl font-bold mb-6">Edit Content</h2>

          <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="edit-title" className="block text-sm font-medium text-gray-700 mb-1">
                Title *
              </label>
              <input
                id="edit-title"
                type="text"
                {...register('title', { required: 'Title is required' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
              {errors.title && (
                <p className="mt-1 text-sm text-red-600">{errors.title.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="edit-description" className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                id="edit-description"
                {...register('description')}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="edit-contentType" className="block text-sm font-medium text-gray-700 mb-1">
                Content Type *
              </label>
              <select
                id="edit-contentType"
                {...register('contentType', { required: 'Content type is required' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                {Object.values(ContentType).map((type) => (
                  <option key={type} value={type}>
                    {type.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="edit-visibility" className="block text-sm font-medium text-gray-700 mb-1">
                Visibility
              </label>
              <select
                id="edit-visibility"
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
                    })}
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
              <button
                type="button"
                onClick={() => append({ value: '' })}
                className="mt-2 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-md"
              >
                Add another URL
              </button>
            </div>

            <div>
              <label htmlFor="edit-tags" className="block text-sm font-medium text-gray-700 mb-1">
                Tags (comma-separated)
              </label>
              <input
                id="edit-tags"
                type="text"
                {...register('tags')}
                placeholder="aws, serverless, lambda"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="edit-publishDate" className="block text-sm font-medium text-gray-700 mb-1">
                Publish Date
              </label>
              <input
                id="edit-publishDate"
                type="date"
                {...register('publishDate')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="flex gap-3 justify-end pt-4 border-t">
              <button
                type="button"
                onClick={onClose}
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
                {isSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
