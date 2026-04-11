import { useState, useCallback, useMemo } from 'react';

export function useSelection<T extends string>(allIds: T[]) {
  const [selected, setSelected] = useState<Set<T>>(new Set());

  const toggle = useCallback((id: T) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected(prev =>
      prev.size === allIds.length ? new Set() : new Set(allIds)
    );
  }, [allIds]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const isAllSelected = useMemo(
    () => allIds.length > 0 && selected.size === allIds.length,
    [allIds.length, selected.size]
  );

  const isSomeSelected = useMemo(
    () => selected.size > 0 && selected.size < allIds.length,
    [allIds.length, selected.size]
  );

  return { selected, toggle, toggleAll, clear, isAllSelected, isSomeSelected, count: selected.size };
}
