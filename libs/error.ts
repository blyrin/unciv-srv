export class UncivError extends Error {
  status: number
  override message: string
  info?: string
  constructor(status: number, message: string, info?: string) {
    super(message)
    this.status = status
    this.message = message
    this.info = info
  }
}

export const throwError = (status: number, message: string, info?: string): never => {
  throw new UncivError(status, message, info)
}
