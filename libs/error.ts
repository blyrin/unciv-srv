export class UncivError extends Error {
  status: number
  override message: string
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.message = message
  }
}

export const throwError = (status: number, message: string): never => {
  throw new UncivError(status, message)
}
