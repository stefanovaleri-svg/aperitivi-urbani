interface D1Meta {
  changes?: number;
  [key: string]: unknown;
}

interface D1Result<T = unknown> {
  results?: T[];
  success?: boolean;
  meta?: D1Meta;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface R2HTTPMetadata {
  contentType?: string;
  cacheControl?: string;
}

interface R2PutOptions {
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

interface R2Object {
  key: string;
  httpEtag: string;
}

interface R2ObjectBody extends R2Object {
  body: ReadableStream<Uint8Array>;
  writeHttpMetadata(headers: Headers): void;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
  put(
    key: string,
    value: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
    options?: R2PutOptions,
  ): Promise<R2Object>;
}

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
