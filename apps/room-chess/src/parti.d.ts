// Minimal global type declaration for the `parti` runtime injected by
// the Parti HostRuntime into the room iframe. Only the methods exercised
// by this room's UI are declared; everything else is implicit `any`.

declare global {
  const parti: {
    playerId: string | null;
    getState(): unknown;
    onState(handler: (state: unknown) => void): () => void;
    onEvent(event: string, handler: (payload: unknown) => void): () => void;
    onMessage?(handler: (msg: unknown) => void): () => void;
    action(name: string, payload?: unknown): Promise<{ ok: true }>;
    ready(): void;
    leave(): void;
    log(...args: unknown[]): void;
  };
}

export {};