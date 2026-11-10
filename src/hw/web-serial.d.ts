// The slice of the Web Serial API the hub link uses (Chrome / Edge). Not in TypeScript's DOM lib yet.
interface SerialPort {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
}

interface Serial {
  requestPort(options?: { filters?: { usbVendorId?: number; usbProductId?: number }[] }): Promise<SerialPort>
}

interface Navigator {
  readonly serial: Serial
}
