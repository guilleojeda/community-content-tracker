'use client';

import React, { createContext, useContext } from 'react';
import type { User } from '@shared/types';

export interface AdminContextValue {
  currentUser: User | null;
}

const AdminContext = createContext<AdminContextValue | undefined>(undefined);

export function AdminContextProvider({
  value,
  children,
}: {
  value: AdminContextValue;
  children: React.ReactNode;
}): JSX.Element {
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdminContext(): AdminContextValue {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error('useAdminContext must be used within an AdminContextProvider');
  }
  return context;
}

