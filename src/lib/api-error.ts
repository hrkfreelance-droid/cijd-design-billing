/** Shared by the fetch client and the browser demo store. */
export class ApiError extends Error {
  code: string;
  constructor(message: string, code = "ERROR") {
    super(message);
    this.code = code;
    this.name = "ApiError";
  }
}
