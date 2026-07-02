export const uint8ArrayToHex = (uint8Array: Uint8Array) => {
  return Array.from(uint8Array, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

export const hexToUint8Array = (hex: string) => {
  const bytes = hex.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16));

  return Uint8Array.from(bytes ?? []);
};
