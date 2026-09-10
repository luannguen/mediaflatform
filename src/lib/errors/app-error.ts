import { ErrorCode, ErrorCodes } from './codes';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: any;

  constructor(message: string, code: ErrorCode = ErrorCodes.INTERNAL_ERROR, statusCode: number = 500, details?: any) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string, code: ErrorCode = ErrorCodes.VALIDATION_ERROR, details?: any) {
    return new AppError(message, code, 400, details);
  }

  static unauthorized(message: string = 'Authentication required', code: ErrorCode = ErrorCodes.AUTH_REQUIRED) {
    return new AppError(message, code, 401);
  }

  static forbidden(message: string = 'Permission denied', code: ErrorCode = ErrorCodes.PERMISSION_DENIED) {
    return new AppError(message, code, 403);
  }

  static notFound(message: string = 'Resource not found', code: ErrorCode = ErrorCodes.ASSET_NOT_FOUND) {
    return new AppError(message, code, 404);
  }

  static conflict(message: string, code: ErrorCode = ErrorCodes.ASSET_IN_USE, details?: any) {
    return new AppError(message, code, 409, details);
  }

  static tooManyRequests(message: string, code: ErrorCode = ErrorCodes.RATE_LIMIT_EXCEEDED, details?: any) {
    return new AppError(message, code, 429, details);
  }

  static serviceUnavailable(message: string, code: ErrorCode = ErrorCodes.INTERNAL_ERROR, details?: any) {
    return new AppError(message, code, 503, details);
  }

  static internal(message: string = 'Internal server error', details?: any) {
    return new AppError(message, ErrorCodes.INTERNAL_ERROR, 500, details);
  }
}
