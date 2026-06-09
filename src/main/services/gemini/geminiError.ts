export enum GeminiErrorCode {
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  FAILED_PRECONDITION = 'FAILED_PRECONDITION',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  NOT_FOUND = 'NOT_FOUND',
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',
  CANCELLED = 'CANCELLED',
  INTERNAL = 'INTERNAL',
  UNAVAILABLE = 'UNAVAILABLE',
  DEADLINE_EXCEEDED = 'DEADLINE_EXCEEDED',
  UNKNOWN = 'UNKNOWN',
}

export interface GeminiErrorResult {
  code: GeminiErrorCode;
  httpStatus: number;
  message: string;
  userMessage: string;
  isServerError: boolean;
  isKeyError: boolean;
  isRetryable: boolean;
  retryAfterMs: number;
  action: 'mark_rate_limit' | 'mark_exhausted' | 'mark_error' | 'skip' | 'retry_same_key';
}

export function isKeyErrorCode(code: GeminiErrorCode): boolean {
  return code === GeminiErrorCode.INVALID_ARGUMENT
    || code === GeminiErrorCode.FAILED_PRECONDITION
    || code === GeminiErrorCode.PERMISSION_DENIED;
}

export function classifyGeminiError(
  httpStatus: number,
  errorStatus?: string,
  errorMessage?: string,
): GeminiErrorResult {
  const status = errorStatus || '';
  const msg = errorMessage || '';

  if (httpStatus === 400 && status === 'INVALID_ARGUMENT') {
    return {
      code: GeminiErrorCode.INVALID_ARGUMENT,
      httpStatus,
      message: msg,
      userMessage: 'Yêu cầu không đúng định dạng. Kiểm tra lại prompt hoặc tham số.',
      isServerError: false,
      isKeyError: true,
      isRetryable: false,
      retryAfterMs: 0,
      action: 'mark_error',
    };
  }

  if (httpStatus === 400 && status === 'FAILED_PRECONDITION') {
    return {
      code: GeminiErrorCode.FAILED_PRECONDITION,
      httpStatus,
      message: msg,
      userMessage: 'Bậc miễn phí không khả dụng ở khu vực này. Cần bật thanh toán trong Google AI Studio.',
      isServerError: false,
      isKeyError: true,
      isRetryable: false,
      retryAfterMs: 0,
      action: 'mark_error',
    };
  }

  if (httpStatus === 403 && status === 'PERMISSION_DENIED') {
    return {
      code: GeminiErrorCode.PERMISSION_DENIED,
      httpStatus,
      message: msg,
      userMessage: 'API key không có quyền truy cập model này.',
      isServerError: false,
      isKeyError: true,
      isRetryable: false,
      retryAfterMs: 0,
      action: 'mark_error',
    };
  }

  if (httpStatus === 404 && status === 'NOT_FOUND') {
    return {
      code: GeminiErrorCode.NOT_FOUND,
      httpStatus,
      message: msg,
      userMessage: 'Model hoặc tài nguyên không tồn tại.',
      isServerError: false,
      isKeyError: false,
      isRetryable: false,
      retryAfterMs: 0,
      action: 'skip',
    };
  }

  if (httpStatus === 429 && status === 'RESOURCE_EXHAUSTED') {
    return {
      code: GeminiErrorCode.RESOURCE_EXHAUSTED,
      httpStatus,
      message: msg,
      userMessage: 'Vượt quá giới hạn tần suất. Đang chuyển sang key khác...',
      isServerError: false,
      isKeyError: true,
      isRetryable: true,
      retryAfterMs: 65_000,
      action: 'mark_rate_limit',
    };
  }

  if (httpStatus === 499 && status === 'CANCELLED') {
    return {
      code: GeminiErrorCode.CANCELLED,
      httpStatus,
      message: msg,
      userMessage: 'Yêu cầu bị huỷ (timeout client). Thử lại...',
      isServerError: false,
      isKeyError: false,
      isRetryable: true,
      retryAfterMs: 500,
      action: 'retry_same_key',
    };
  }

  if (httpStatus === 500 && status === 'INTERNAL') {
    return {
      code: GeminiErrorCode.INTERNAL,
      httpStatus,
      message: msg,
      userMessage: 'Lỗi máy chủ Google. Giảm context hoặc đổi model.',
      isServerError: true,
      isKeyError: false,
      isRetryable: true,
      retryAfterMs: 2_000,
      action: 'retry_same_key',
    };
  }

  if (httpStatus === 503 && status === 'UNAVAILABLE') {
    return {
      code: GeminiErrorCode.UNAVAILABLE,
      httpStatus,
      message: msg,
      userMessage: 'Dịch vụ tạm quá tải. Chờ rồi thử lại...',
      isServerError: true,
      isKeyError: false,
      isRetryable: true,
      retryAfterMs: 800,
      action: 'retry_same_key',
    };
  }

  if (httpStatus === 504 && status === 'DEADLINE_EXCEEDED') {
    return {
      code: GeminiErrorCode.DEADLINE_EXCEEDED,
      httpStatus,
      message: msg,
      userMessage: 'Quá thời gian xử lý. Tăng timeout hoặc giảm context.',
      isServerError: true,
      isKeyError: false,
      isRetryable: true,
      retryAfterMs: 3_000,
      action: 'retry_same_key',
    };
  }

  const msgLower = msg.toLowerCase();
  if (msgLower.includes('exhausted') || msgLower.includes('quota')) {
    return {
      code: GeminiErrorCode.RESOURCE_EXHAUSTED,
      httpStatus,
      message: msg,
      userMessage: 'Đã hết quota daily. Chờ đến ngày mới hoặc đổi key.',
      isServerError: false,
      isKeyError: true,
      isRetryable: false,
      retryAfterMs: 0,
      action: 'mark_exhausted',
    };
  }

  if (msgLower.includes('invalid') || msgLower.includes('api key') || msgLower.includes('not found') || msgLower.includes('permission')) {
    return {
      code: GeminiErrorCode.PERMISSION_DENIED,
      httpStatus,
      message: msg,
      userMessage: 'API key không hợp lệ hoặc không có quyền.',
      isServerError: false,
      isKeyError: true,
      isRetryable: false,
      retryAfterMs: 0,
      action: 'mark_error',
    };
  }

  const is503like = msgLower.includes('high demand') || msgLower.includes('service unavailable') || msgLower.includes('temporarily unavailable');
  if (is503like) {
    return {
      code: GeminiErrorCode.UNAVAILABLE,
      httpStatus: httpStatus || 503,
      message: msg,
      userMessage: 'Dịch vụ tạm quá tải. Chờ rồi thử lại...',
      isServerError: true,
      isKeyError: false,
      isRetryable: true,
      retryAfterMs: 800,
      action: 'retry_same_key',
    };
  }

  return {
    code: GeminiErrorCode.UNKNOWN,
    httpStatus,
    message: msg,
    userMessage: `Lỗi không xác định (HTTP ${httpStatus}).`,
    isServerError: false,
    isKeyError: true,
    isRetryable: false,
    retryAfterMs: 0,
    action: 'mark_error',
  };
}

export function getGeminiErrorUserMessage(code: GeminiErrorCode): string {
  const map: Record<string, string> = {
    INVALID_ARGUMENT: 'Yêu cầu không đúng định dạng.',
    FAILED_PRECONDITION: 'Cần bật thanh toán trong Google AI Studio.',
    PERMISSION_DENIED: 'API key không có quyền truy cập.',
    NOT_FOUND: 'Model không tồn tại.',
    RESOURCE_EXHAUSTED: 'Đã hết quota hoặc bị rate limit.',
    CANCELLED: 'Yêu cầu bị huỷ.',
    INTERNAL: 'Lỗi máy chủ Google.',
    UNAVAILABLE: 'Dịch vụ tạm quá tải.',
    DEADLINE_EXCEEDED: 'Quá thời gian xử lý.',
  };
  return map[code] || 'Lỗi không xác định.';
}
