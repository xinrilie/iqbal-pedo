export class AppError extends Error {
  constructor(statusCode, code, message, details = []) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message, details = []) { return new AppError(400, 'BAD_REQUEST', message, details); }
export function unauthorized(message = 'Autentikasi diperlukan.') { return new AppError(401, 'UNAUTHORIZED', message); }
export function forbidden(message = 'Akses tidak diizinkan.') { return new AppError(403, 'FORBIDDEN', message); }
export function notFound(message = 'Data tidak ditemukan.') { return new AppError(404, 'NOT_FOUND', message); }
export function conflict(code, message) { return new AppError(409, code, message); }
export function unprocessable(code, message) { return new AppError(422, code, message); }
export function notImplemented(code, message) { return new AppError(501, code, message); }
