type Listener = (event: Record<string, unknown>) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribe(workspaceId: string, listener: Listener): () => void {
  const set = listeners.get(workspaceId) ?? new Set<Listener>();
  set.add(listener); listeners.set(workspaceId, set);
  return () => { set.delete(listener); if (set.size === 0) listeners.delete(workspaceId); };
}

export function publish(workspaceId: string, event: Record<string, unknown>): void {
  for (const listener of listeners.get(workspaceId) ?? []) listener(event);
}