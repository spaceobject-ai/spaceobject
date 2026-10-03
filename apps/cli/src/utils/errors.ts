export type ErrorCode =
  | "FLAG_CONFLICT"
  | "FLAG_MISSING"
  | "FILE_NOT_FOUND"
  | "NOT_LOGGED_IN"
  | "DEVICE_AUTH_DISABLED"
  | "DEVICE_AUTH_FAILED"
  | "AUTH_PENDING"
  | "DEVICE_CODE_EXPIRED"
  | "AUTH_DENIED"
  | "TOKEN_REQUEST_FAILED"
  | "SESSION_EXPIRED"
  | "WALLET_AUTH_FAILED"
  | "WALLET_NOT_FOUND"
  | "WALLET_NOT_ACCESSIBLE"
  | "WALLET_RPC_FAILED"
  | "AGENT_NOT_FOUND"
  | "AGENT_CARD_INVALID"
  | "AGENT_SERVICE_NOT_FOUND"
  | "AGENT_SYNC_FAILED"
  | "AGENT_PULL_FAILED"
  | "AGENT_ID_INVALID"
  | "FEEDBACK_INPUT_INVALID"
  | "FEEDBACK_ACTION_FAILED"
  | "JOB_NOT_FOUND"
  | "JOB_INPUT_INVALID"
  | "JOB_ACTION_FAILED"
  | "AMOUNT_INVALID"
  | "API_REQUEST_FAILED"
  | "STORAGE_INPUT_INVALID"
  | "STORAGE_PATH_NOT_FOUND"
  | "STORAGE_NOT_FOUND"
  | "STORAGE_UPLOAD_FAILED"
  | "STORAGE_DOWNLOAD_FAILED"
  | "STORAGE_KEY_NOT_FOUND";

export class CliError extends Error {
  readonly code: ErrorCode;
  readonly recovery?: string;

  constructor(code: ErrorCode, message: string, recovery?: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.recovery = recovery;
  }
}
