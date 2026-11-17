/**
 * Web Bluetooth compatibility helpers. iOS Web Bluetooth browsers (Bluefy, the WebBLE Safari extension) and older
 * Chrome builds don't all implement the newer write methods or every requestDevice filter, so fall back gracefully.
 */

type Char = BluetoothRemoteGATTCharacteristic & {
  writeValueWithResponse?: (v: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (v: BufferSource) => Promise<void>;
  writeValue?: (v: BufferSource) => Promise<void>;
};

/** Write with response if possible; falls back to the older writeValue(). */
export async function writeWithResponse(c: BluetoothRemoteGATTCharacteristic, bytes: BufferSource): Promise<void> {
  const ch = c as Char;
  if (typeof ch.writeValueWithResponse === 'function') return ch.writeValueWithResponse(bytes);
  if (typeof ch.writeValue === 'function') return ch.writeValue(bytes);
  throw new Error('This browser cannot write to Bluetooth devices.');
}

/** Write without response if possible; falls back to the older writeValue(). */
export async function writeWithoutResponse(c: BluetoothRemoteGATTCharacteristic, bytes: BufferSource): Promise<void> {
  const ch = c as Char;
  if (typeof ch.writeValueWithoutResponse === 'function') return ch.writeValueWithoutResponse(bytes);
  if (typeof ch.writeValue === 'function') return ch.writeValue(bytes);
  throw new Error('This browser cannot write to Bluetooth devices.');
}

/**
 * requestDevice, retrying with simpler filters if the browser rejects one it doesn't support (e.g. manufacturerData).
 * Each entry of `attempts` is tried in order until one isn't a TypeError.
 */
export async function requestDeviceCompat(attempts: RequestDeviceOptions[]): Promise<BluetoothDevice> {
  let last: unknown;
  for (const opts of attempts) {
    try {
      return await navigator.bluetooth.requestDevice(opts);
    } catch (e) {
      last = e;
      // NotFoundError = user cancelled / nothing chosen: don't re-prompt.
      if (!(e instanceof TypeError)) throw e;
    }
  }
  throw last;
}
