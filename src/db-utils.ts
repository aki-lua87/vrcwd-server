import { drizzle } from "drizzle-orm/d1";

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000, // 1秒
  maxDelay: 10000, // 10秒
  backoffMultiplier: 2
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isNetworkError(error: any): boolean {
  if (!error) return false;
  
  const errorMessage = error.message || error.toString();
  
  return errorMessage.includes('Network connection lost') ||
         errorMessage.includes('connection lost') ||
         errorMessage.includes('network error') ||
         errorMessage.includes('timeout') ||
         errorMessage.includes('ECONNRESET') ||
         errorMessage.includes('ENOTFOUND') ||
         errorMessage.includes('ETIMEDOUT');
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: any;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // ネットワークエラーでない場合、またはmax retriesに達した場合はすぐに失敗
      if (!isNetworkError(error) || attempt === opts.maxRetries) {
        throw error;
      }

      // 遅延時間を計算（指数バックオフ）
      const delay = Math.min(
        opts.baseDelay * Math.pow(opts.backoffMultiplier, attempt),
        opts.maxDelay
      );

      console.warn(`Database operation failed (attempt ${attempt + 1}/${opts.maxRetries + 1}): ${error.message}. Retrying in ${delay}ms...`);
      
      await sleep(delay);
    }
  }

  throw lastError;
}

// 汎用的なオブジェクトプロキシでexecuteメソッドを自動的にラップ
function wrapWithRetry(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  return new Proxy(obj, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      
      // executeメソッドをリトライ機能でラップ
      if (prop === 'execute' && typeof value === 'function') {
        return () => withRetry(() => value.call(target));
      }
      
      // 関数の場合、その結果もラップする
      if (typeof value === 'function') {
        return function(...args: any[]) {
          const result = value.apply(target, args);
          return wrapWithRetry(result);
        };
      }
      
      return value;
    }
  });
}

export function createDbWithRetry(database: D1Database, schema: any) {
  const db = drizzle(database, { schema });
  return wrapWithRetry(db);
}