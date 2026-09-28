/**
 * Registry of in-flight AI streams so the renderer can cancel one by its
 * streamId (e.g. a "Stop" button, or navigating to another PR).
 */
const controllers = new Map<string, AbortController>();

export function registerStream(streamId: string): AbortController {
  cancelStream(streamId);
  const ac = new AbortController();
  controllers.set(streamId, ac);
  return ac;
}

export function finishStream(streamId: string): void {
  controllers.delete(streamId);
}

export function cancelStream(streamId: string): boolean {
  const ac = controllers.get(streamId);
  if (!ac) return false;
  controllers.delete(streamId);
  ac.abort();
  return true;
}

export function cancelAllStreams(): void {
  for (const ac of controllers.values()) ac.abort();
  controllers.clear();
}
