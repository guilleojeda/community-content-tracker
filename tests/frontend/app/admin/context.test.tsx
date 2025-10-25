import React from 'react';
import { renderHook } from '@testing-library/react';
import { AdminContextProvider, useAdminContext } from '@/app/admin/context';

describe('useAdminContext', () => {
  it('returns context value when provider is present', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AdminContextProvider value={{ currentUser: null }}>{children}</AdminContextProvider>
    );

    const { result } = renderHook(() => useAdminContext(), { wrapper });
    expect(result.current).toEqual({ currentUser: null });
  });

  it('throws helpful error when accessed outside provider', () => {
    expect(() => renderHook(() => useAdminContext())).toThrow(
      'useAdminContext must be used within an AdminContextProvider'
    );
  });
});
