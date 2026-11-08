import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { persist, type PersistStorage } from "zustand/middleware";
import { z } from "zod";

type RecordState<T> = { value: T | null };
const records = new Map<string, () => void | Promise<void>>();

/** One storage key per operation keeps writes to unrelated lots independent across tabs. */
export function persistedRecord<T>(name: string, schema: z.ZodType<T>) {
  const envelope = z.object({
    state: z.object({ value: schema.nullable() }),
    version: z.literal(1),
  });
  const storage: PersistStorage<Pick<RecordState<T>, "value">> = {
    getItem: () => {
      const raw = localStorage.getItem(name);
      if (raw === null) return { state: { value: null }, version: 1 };
      const parsed: unknown = JSON.parse(raw);
      const current = envelope.safeParse(parsed);
      if (current.success) return current.data;
      // Preserve records written before Zustand, rather than losing pending payments on upgrade.
      return { state: { value: schema.parse(parsed) }, version: 1 };
    },
    setItem: (_key, value) => localStorage.setItem(name, JSON.stringify(value)),
    removeItem: () => localStorage.removeItem(name),
  };
  const errors = createStore<{ error: string | null }>(() => ({ error: null }));
  const store = createStore<RecordState<T>>()(
    persist((): RecordState<T> => ({ value: null }), {
      name,
      version: 1,
      storage,
      partialize: ({ value }) => ({ value }),
      skipHydration: true,
      onRehydrateStorage: () => (_state, error) => {
        if (error)
          errors.setState({
            error: error instanceof Error ? error.message : String(error),
          });
        else errors.setState({ error: null });
      },
    }),
  );
  records.set(name, () => store.persist.rehydrate());
  void store.persist.rehydrate();

  const read = () => {
    void store.persist.rehydrate();
    const state = store.getState();
    const { error } = errors.getState();
    if (error) throw new Error(`Cannot recover stored operation: ${error}`);
    return state.value;
  };
  return {
    read,
    write: (value: T | null) => {
      // A storage error must stop signing; don't rely on a failed persistence middleware write.
      storage.setItem(name, { state: { value }, version: 1 });
      store.setState({ value });
    },
    useValue: () => {
      const value = useStore(store, (state) => state.value);
      const error = useStore(errors, (state) => state.error);
      if (error) throw new Error(`Cannot recover stored operation: ${error}`);
      return value;
    },
  };
}

/** Native storage events are required only for updates made by another browser tab. */
export function useRecoveryTabSync() {
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return;
      if (event.key === null)
        for (const rehydrate of records.values()) void rehydrate();
      else void records.get(event.key)?.();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
}
