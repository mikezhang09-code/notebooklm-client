import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

export interface SearchContextValue {
  query: string;
  setQuery: (q: string) => void;
  clearQuery: () => void;
}

const SearchContext = createContext<SearchContextValue>({
  query: '',
  setQuery: () => {},
  clearQuery: () => {},
});

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState('');
  const clearQuery = useCallback(() => setQuery(''), []);

  const value = useMemo(
    () => ({
      query,
      setQuery,
      clearQuery,
    }),
    [query, clearQuery],
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchContextValue {
  return useContext(SearchContext);
}
