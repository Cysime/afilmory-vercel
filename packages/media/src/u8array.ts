export const uint8ArrayToHex = (uint8Array: Uint8Array) => {
  return Array.from(uint8Array, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

export const hexToUint8Array = (hex: string) => {
  if (hex.length % 2 !== 0) {
    throw new TypeError("Hex input must contain an even number of characters");
  }
  if (!/^[\da-f]*$/i.test(hex)) {
    throw new TypeError("Hex input contains non-hexadecimal characters");
  }

  const bytes = hex.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16));

  return Uint8Array.from(bytes ?? []);
};
