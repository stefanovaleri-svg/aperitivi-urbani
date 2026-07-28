export const DEFAULT_MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 10_000;
export const MAX_IMAGE_PIXELS = 40_000_000;

export type SupportedImageFormat = "jpeg" | "png" | "webp";

export interface ValidatedImage {
  format: SupportedImageFormat;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  byteSize: number;
}

export interface MediaStorageTarget {
  mediaId: string;
  storageKey: string;
}

export class CmsMediaError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CmsMediaError";
    this.status = status;
    this.code = code;
  }
}

function toBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.byteLength < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

interface ImageDimensions {
  width: number;
  height: number;
}

function invalidImage(message = "Il file immagine è incompleto o non valido."): never {
  throw new CmsMediaError(415, "media_invalid", message);
}

function validateDimensions(width: number, height: number): ImageDimensions {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    invalidImage("Le dimensioni dell'immagine non sono valide.");
  }

  if (
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new CmsMediaError(
      413,
      "media_dimensions_exceeded",
      "Le dimensioni dell'immagine superano i limiti consentiti.",
    );
  }

  return { width, height };
}

function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100;
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000
  );
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  );
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
  0xcf,
]);
const JPEG_LENGTH_MARKERS = new Set([
  ...JPEG_START_OF_FRAME_MARKERS,
  0xc4,
  0xc8,
  0xcc,
  0xda,
  0xdb,
  0xdc,
  0xdd,
  0xde,
  0xdf,
  ...Array.from({ length: 16 }, (_, index) => 0xe0 + index),
  ...Array.from({ length: 14 }, (_, index) => 0xf0 + index),
  0xfe,
]);

function parseJpegDimensions(bytes: Uint8Array): ImageDimensions {
  if (!startsWith(bytes, [0xff, 0xd8])) invalidImage();

  let offset = 2;
  let dimensions: ImageDimensions | null = null;
  let sawScan = false;

  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) invalidImage();

    let markerOffset = offset + 1;
    while (markerOffset < bytes.byteLength && bytes[markerOffset] === 0xff) {
      markerOffset += 1;
    }
    if (markerOffset >= bytes.byteLength) invalidImage();

    const marker = bytes[markerOffset];
    offset = markerOffset + 1;

    if (marker === 0x00 || marker === 0xd8) invalidImage();
    if (marker === 0xd9) {
      if (
        offset !== bytes.byteLength ||
        dimensions === null ||
        !sawScan
      ) {
        invalidImage();
      }
      return dimensions;
    }

    if (marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7) invalidImage();
    if (!JPEG_LENGTH_MARKERS.has(marker)) invalidImage();

    if (offset + 2 > bytes.byteLength) invalidImage();
    const segmentLength = readUint16BigEndian(bytes, offset);
    if (segmentLength < 2) invalidImage();

    const segmentDataOffset = offset + 2;
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > bytes.byteLength) invalidImage();

    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (dimensions !== null || segmentLength < 8) invalidImage();
      const componentCount = bytes[segmentDataOffset + 5];
      if (
        componentCount < 1 ||
        componentCount > 4 ||
        segmentLength !== 8 + componentCount * 3
      ) {
        invalidImage();
      }

      dimensions = validateDimensions(
        readUint16BigEndian(bytes, segmentDataOffset + 3),
        readUint16BigEndian(bytes, segmentDataOffset + 1),
      );
    }

    if (marker !== 0xda) {
      offset = segmentEnd;
      continue;
    }

    if (dimensions === null || segmentLength < 8) invalidImage();
    const scanComponentCount = bytes[segmentDataOffset];
    if (
      scanComponentCount < 1 ||
      scanComponentCount > 4 ||
      segmentLength !== 6 + scanComponentCount * 2
    ) {
      invalidImage();
    }

    sawScan = true;
    let scanOffset = segmentEnd;
    let entropyBytes = 0;
    let nextMarkerOffset = -1;

    while (scanOffset < bytes.byteLength) {
      if (bytes[scanOffset] !== 0xff) {
        entropyBytes += 1;
        scanOffset += 1;
        continue;
      }

      const prefixOffset = scanOffset;
      while (scanOffset < bytes.byteLength && bytes[scanOffset] === 0xff) {
        scanOffset += 1;
      }
      if (scanOffset >= bytes.byteLength) invalidImage();

      const scanMarker = bytes[scanOffset];
      if (scanMarker === 0x00) {
        entropyBytes += 1;
        scanOffset += 1;
        continue;
      }
      if (scanMarker >= 0xd0 && scanMarker <= 0xd7) {
        scanOffset += 1;
        continue;
      }

      nextMarkerOffset = prefixOffset;
      break;
    }

    if (entropyBytes === 0 || nextMarkerOffset < 0) invalidImage();
    offset = nextMarkerOffset;
  }

  invalidImage();
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[offset]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isPngChunkLetter(value: number): boolean {
  return (
    (value >= 0x41 && value <= 0x5a) ||
    (value >= 0x61 && value <= 0x7a)
  );
}

function pngChunkName(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function validPngBitDepth(colorType: number, bitDepth: number): boolean {
  switch (colorType) {
    case 0:
      return [1, 2, 4, 8, 16].includes(bitDepth);
    case 2:
      return bitDepth === 8 || bitDepth === 16;
    case 3:
      return [1, 2, 4, 8].includes(bitDepth);
    case 4:
    case 6:
      return bitDepth === 8 || bitDepth === 16;
    default:
      return false;
  }
}

function parsePngDimensions(bytes: Uint8Array): ImageDimensions {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!startsWith(bytes, signature)) invalidImage();

  let offset = signature.length;
  let dimensions: ImageDimensions | null = null;
  let colorType = -1;
  let bitDepth = -1;
  let sawPalette = false;
  let sawIdat = false;
  let idatEnded = false;
  let idatByteCount = 0;
  const idatPrefix: number[] = [];

  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) invalidImage();

    const dataLength = readUint32BigEndian(bytes, offset);
    const typeOffset = offset + 4;
    if (
      !isPngChunkLetter(bytes[typeOffset]) ||
      !isPngChunkLetter(bytes[typeOffset + 1]) ||
      !isPngChunkLetter(bytes[typeOffset + 2]) ||
      !isPngChunkLetter(bytes[typeOffset + 3]) ||
      (bytes[typeOffset + 2] & 0x20) !== 0
    ) {
      invalidImage();
    }

    const dataOffset = typeOffset + 4;
    const dataEnd = dataOffset + dataLength;
    const chunkEnd = dataEnd + 4;
    if (
      dataEnd < dataOffset ||
      chunkEnd < dataEnd ||
      chunkEnd > bytes.byteLength
    ) {
      invalidImage();
    }

    const expectedCrc = readUint32BigEndian(bytes, dataEnd);
    if (crc32(bytes, typeOffset, dataEnd) !== expectedCrc) invalidImage();

    const type = pngChunkName(bytes, typeOffset);
    if (dimensions === null && type !== "IHDR") invalidImage();
    if (
      (bytes[typeOffset] & 0x20) === 0 &&
      !["IHDR", "PLTE", "IDAT", "IEND"].includes(type)
    ) {
      invalidImage();
    }

    switch (type) {
      case "IHDR": {
        if (dimensions !== null || dataLength !== 13) invalidImage();
        bitDepth = bytes[dataOffset + 8];
        colorType = bytes[dataOffset + 9];
        if (
          !validPngBitDepth(colorType, bitDepth) ||
          bytes[dataOffset + 10] !== 0 ||
          bytes[dataOffset + 11] !== 0 ||
          bytes[dataOffset + 12] > 1
        ) {
          invalidImage();
        }
        dimensions = validateDimensions(
          readUint32BigEndian(bytes, dataOffset),
          readUint32BigEndian(bytes, dataOffset + 4),
        );
        break;
      }
      case "PLTE": {
        if (
          sawPalette ||
          sawIdat ||
          colorType === 0 ||
          colorType === 4 ||
          dataLength === 0 ||
          dataLength > 768 ||
          dataLength % 3 !== 0 ||
          (colorType === 3 && dataLength / 3 > 2 ** bitDepth)
        ) {
          invalidImage();
        }
        sawPalette = true;
        break;
      }
      case "IDAT": {
        if (idatEnded || (colorType === 3 && !sawPalette)) invalidImage();
        sawIdat = true;
        idatByteCount += dataLength;
        for (
          let dataIndex = dataOffset;
          dataIndex < dataEnd && idatPrefix.length < 2;
          dataIndex += 1
        ) {
          idatPrefix.push(bytes[dataIndex]);
        }
        break;
      }
      case "IEND": {
        if (
          dataLength !== 0 ||
          dimensions === null ||
          !sawIdat ||
          idatByteCount < 6 ||
          idatPrefix.length < 2 ||
          (idatPrefix[0] & 0x0f) !== 8 ||
          (idatPrefix[0] >>> 4) > 7 ||
          ((idatPrefix[0] << 8) | idatPrefix[1]) % 31 !== 0 ||
          (idatPrefix[1] & 0x20) !== 0 ||
          chunkEnd !== bytes.byteLength
        ) {
          invalidImage();
        }
        return dimensions;
      }
      default:
        if (sawIdat) idatEnded = true;
    }

    offset = chunkEnd;
  }

  invalidImage();
}

function webpChunkName(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function parseVp8Dimensions(
  bytes: Uint8Array,
  dataOffset: number,
  dataLength: number,
): ImageDimensions {
  if (
    dataLength < 11 ||
    bytes[dataOffset + 3] !== 0x9d ||
    bytes[dataOffset + 4] !== 0x01 ||
    bytes[dataOffset + 5] !== 0x2a
  ) {
    invalidImage();
  }

  const frameTag =
    bytes[dataOffset] +
    bytes[dataOffset + 1] * 0x100 +
    bytes[dataOffset + 2] * 0x10000;
  const firstPartitionLength = frameTag >>> 5;
  if (
    (frameTag & 1) !== 0 ||
    ((frameTag >>> 1) & 0x07) > 3 ||
    (frameTag & 0x10) === 0 ||
    firstPartitionLength === 0 ||
    firstPartitionLength > dataLength - 10
  ) {
    invalidImage();
  }

  return validateDimensions(
    readUint16LittleEndian(bytes, dataOffset + 6) & 0x3fff,
    readUint16LittleEndian(bytes, dataOffset + 8) & 0x3fff,
  );
}

function parseVp8lDimensions(
  bytes: Uint8Array,
  dataOffset: number,
  dataLength: number,
): ImageDimensions {
  if (dataLength < 6 || bytes[dataOffset] !== 0x2f) invalidImage();
  const headerBits = readUint32LittleEndian(bytes, dataOffset + 1);
  if ((headerBits >>> 29) !== 0) invalidImage();
  return validateDimensions(
    (headerBits & 0x3fff) + 1,
    ((headerBits >>> 14) & 0x3fff) + 1,
  );
}

function vp8lHasAlpha(bytes: Uint8Array, dataOffset: number): boolean {
  return (readUint32LittleEndian(bytes, dataOffset + 1) & 0x10000000) !== 0;
}

interface WebpChunk {
  type: string;
  dataOffset: number;
  dataLength: number;
  end: number;
}

function readWebpChunk(
  bytes: Uint8Array,
  offset: number,
  limit: number,
): WebpChunk {
  if (offset + 8 > limit) invalidImage();
  const dataLength = readUint32LittleEndian(bytes, offset + 4);
  const dataOffset = offset + 8;
  const dataEnd = dataOffset + dataLength;
  const end = dataEnd + (dataLength & 1);
  if (
    dataEnd < dataOffset ||
    end < dataEnd ||
    end > limit ||
    ((dataLength & 1) === 1 && bytes[dataEnd] !== 0)
  ) {
    invalidImage();
  }
  return {
    type: webpChunkName(bytes, offset),
    dataOffset,
    dataLength,
    end,
  };
}

interface ParsedWebpBitstream {
  dimensions: ImageDimensions;
  hasAlpha: boolean;
}

function parseWebpBitstream(
  bytes: Uint8Array,
  offset: number,
  limit: number,
): ParsedWebpBitstream {
  let imageDimensions: ImageDimensions | null = null;
  let sawAlpha = false;
  let hasAlpha = false;

  while (offset < limit) {
    const chunk = readWebpChunk(bytes, offset, limit);
    if (chunk.type === "ALPH") {
      if (
        sawAlpha ||
        imageDimensions !== null ||
        chunk.dataLength < 2 ||
        (bytes[chunk.dataOffset] & 0xc3) !== 0
      ) {
        invalidImage();
      }
      sawAlpha = true;
    } else if (chunk.type === "VP8 ") {
      if (imageDimensions !== null) invalidImage();
      imageDimensions = parseVp8Dimensions(
        bytes,
        chunk.dataOffset,
        chunk.dataLength,
      );
      hasAlpha = sawAlpha;
    } else if (chunk.type === "VP8L") {
      if (imageDimensions !== null || sawAlpha) invalidImage();
      imageDimensions = parseVp8lDimensions(
        bytes,
        chunk.dataOffset,
        chunk.dataLength,
      );
      hasAlpha = vp8lHasAlpha(bytes, chunk.dataOffset);
    } else {
      invalidImage();
    }
    offset = chunk.end;
  }

  if (offset !== limit || imageDimensions === null) invalidImage();
  return { dimensions: imageDimensions, hasAlpha };
}

function sameDimensions(
  first: ImageDimensions,
  second: ImageDimensions,
): boolean {
  return first.width === second.width && first.height === second.height;
}

function parseWebpDimensions(bytes: Uint8Array): ImageDimensions {
  if (
    bytes.byteLength < 20 ||
    !startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) ||
    bytes[8] !== 0x57 ||
    bytes[9] !== 0x45 ||
    bytes[10] !== 0x42 ||
    bytes[11] !== 0x50 ||
    readUint32LittleEndian(bytes, 4) !== bytes.byteLength - 8
  ) {
    invalidImage();
  }

  let offset = 12;
  let canvas: ImageDimensions | null = null;
  let stillImage: ParsedWebpBitstream | null = null;
  let extendedFlags = 0;
  let sawAlpha = false;
  let sawAnim = false;
  let sawIcc = false;
  let sawExif = false;
  let sawXmp = false;
  let tailMetadataStarted = false;
  let contentStarted = false;
  let animationHasAlpha = false;
  let frameCount = 0;
  let chunkCount = 0;

  while (offset < bytes.byteLength) {
    chunkCount += 1;
    if (chunkCount > 4096) invalidImage();
    const chunk = readWebpChunk(bytes, offset, bytes.byteLength);

    switch (chunk.type) {
      case "VP8X": {
        if (offset !== 12 || canvas !== null || chunk.dataLength !== 10) {
          invalidImage();
        }
        extendedFlags = bytes[chunk.dataOffset];
        if (
          (extendedFlags & 0xc1) !== 0 ||
          bytes[chunk.dataOffset + 1] !== 0 ||
          bytes[chunk.dataOffset + 2] !== 0 ||
          bytes[chunk.dataOffset + 3] !== 0
        ) {
          invalidImage();
        }
        canvas = validateDimensions(
          readUint24LittleEndian(bytes, chunk.dataOffset + 4) + 1,
          readUint24LittleEndian(bytes, chunk.dataOffset + 7) + 1,
        );
        break;
      }
      case "VP8 ":
      case "VP8L": {
        if (
          stillImage !== null ||
          frameCount > 0 ||
          sawAnim ||
          tailMetadataStarted ||
          (canvas !== null && (extendedFlags & 0x02) !== 0) ||
          (chunk.type === "VP8L" && sawAlpha)
        ) {
          invalidImage();
        }
        const dimensions =
          chunk.type === "VP8 "
            ? parseVp8Dimensions(bytes, chunk.dataOffset, chunk.dataLength)
            : parseVp8lDimensions(bytes, chunk.dataOffset, chunk.dataLength);
        stillImage = {
          dimensions,
          hasAlpha:
            chunk.type === "VP8 "
              ? sawAlpha
              : vp8lHasAlpha(bytes, chunk.dataOffset),
        };
        contentStarted = true;
        break;
      }
      case "ALPH": {
        if (
          canvas === null ||
          (extendedFlags & 0x02) !== 0 ||
          sawAlpha ||
          stillImage !== null ||
          contentStarted ||
          tailMetadataStarted ||
          chunk.dataLength < 2 ||
          (bytes[chunk.dataOffset] & 0xc3) !== 0
        ) {
          invalidImage();
        }
        sawAlpha = true;
        break;
      }
      case "ANIM": {
        if (
          canvas === null ||
          (extendedFlags & 0x02) === 0 ||
          sawAnim ||
          contentStarted ||
          tailMetadataStarted ||
          chunk.dataLength !== 6
        ) {
          invalidImage();
        }
        sawAnim = true;
        contentStarted = true;
        break;
      }
      case "ANMF": {
        if (
          canvas === null ||
          (extendedFlags & 0x02) === 0 ||
          !sawAnim ||
          stillImage !== null ||
          tailMetadataStarted ||
          chunk.dataLength < 16
        ) {
          invalidImage();
        }
        const frameX = readUint24LittleEndian(bytes, chunk.dataOffset) * 2;
        const frameY =
          readUint24LittleEndian(bytes, chunk.dataOffset + 3) * 2;
        const frameDimensions = validateDimensions(
          readUint24LittleEndian(bytes, chunk.dataOffset + 6) + 1,
          readUint24LittleEndian(bytes, chunk.dataOffset + 9) + 1,
        );
        if (
          (bytes[chunk.dataOffset + 15] & 0xfc) !== 0 ||
          frameX + frameDimensions.width > canvas.width ||
          frameY + frameDimensions.height > canvas.height
        ) {
          invalidImage();
        }
        const bitstream = parseWebpBitstream(
          bytes,
          chunk.dataOffset + 16,
          chunk.dataOffset + chunk.dataLength,
        );
        if (!sameDimensions(frameDimensions, bitstream.dimensions)) {
          invalidImage();
        }
        animationHasAlpha ||= bitstream.hasAlpha;
        frameCount += 1;
        break;
      }
      case "ICCP": {
        if (
          canvas === null ||
          (extendedFlags & 0x20) === 0 ||
          sawIcc ||
          contentStarted ||
          chunk.dataLength === 0
        ) {
          invalidImage();
        }
        sawIcc = true;
        break;
      }
      case "EXIF": {
        if (
          canvas === null ||
          (extendedFlags & 0x08) === 0 ||
          sawExif ||
          !contentStarted ||
          chunk.dataLength === 0
        ) {
          invalidImage();
        }
        sawExif = true;
        tailMetadataStarted = true;
        break;
      }
      case "XMP ": {
        if (
          canvas === null ||
          (extendedFlags & 0x04) === 0 ||
          sawXmp ||
          !contentStarted ||
          chunk.dataLength === 0
        ) {
          invalidImage();
        }
        sawXmp = true;
        tailMetadataStarted = true;
        break;
      }
      default:
        invalidImage();
    }

    offset = chunk.end;
  }

  if (offset !== bytes.byteLength) invalidImage();
  if (canvas === null) {
    if (
      stillImage === null ||
      sawAlpha ||
      sawAnim ||
      sawIcc ||
      sawExif ||
      sawXmp ||
      frameCount > 0
    ) {
      invalidImage();
    }
    return stillImage.dimensions;
  }
  if (
    sawIcc !== ((extendedFlags & 0x20) !== 0) ||
    sawExif !== ((extendedFlags & 0x08) !== 0) ||
    sawXmp !== ((extendedFlags & 0x04) !== 0)
  ) {
    invalidImage();
  }
  if ((extendedFlags & 0x02) !== 0) {
    if (!sawAnim || frameCount === 0 || stillImage !== null) invalidImage();
    if (animationHasAlpha !== ((extendedFlags & 0x10) !== 0)) invalidImage();
    return canvas;
  }
  if (
    sawAnim ||
    frameCount > 0 ||
    stillImage === null ||
    stillImage.hasAlpha !== ((extendedFlags & 0x10) !== 0) ||
    !sameDimensions(canvas, stillImage.dimensions)
  ) {
    invalidImage();
  }
  return canvas;
}

function validateImageStructure(
  bytes: Uint8Array,
  format: SupportedImageFormat,
): void {
  switch (format) {
    case "jpeg":
      parseJpegDimensions(bytes);
      return;
    case "png":
      parsePngDimensions(bytes);
      return;
    case "webp":
      parseWebpDimensions(bytes);
  }
}

export function sniffImageFormat(
  input: Uint8Array | ArrayBuffer,
): SupportedImageFormat | null {
  const bytes = toBytes(input);

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return "png";
  }
  if (
    bytes.byteLength >= 12 &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

function canonicalizeDeclaredMime(value: string): string {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "image/jpg") return "image/jpeg";
  return mediaType;
}

function imageDescriptor(format: SupportedImageFormat): Omit<
  ValidatedImage,
  "byteSize"
> {
  switch (format) {
    case "jpeg":
      return { format, mimeType: "image/jpeg", extension: "jpg" };
    case "png":
      return { format, mimeType: "image/png", extension: "png" };
    case "webp":
      return { format, mimeType: "image/webp", extension: "webp" };
  }
}

export function validateImageBytes(
  input: Uint8Array | ArrayBuffer,
  declaredMime: string,
  maxBytes = DEFAULT_MAX_MEDIA_BYTES,
): ValidatedImage {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new CmsMediaError(
      500,
      "media_limit_invalid",
      "Limite upload non valido.",
    );
  }

  const bytes = toBytes(input);
  if (bytes.byteLength === 0) {
    throw new CmsMediaError(400, "media_empty", "Immagine vuota.");
  }
  if (bytes.byteLength > maxBytes) {
    throw new CmsMediaError(
      413,
      "media_too_large",
      "Immagine troppo grande.",
    );
  }

  const format = sniffImageFormat(bytes);
  if (!format) {
    throw new CmsMediaError(
      415,
      "media_type_unsupported",
      "Sono supportate solo immagini JPEG, PNG e WebP.",
    );
  }

  const descriptor = imageDescriptor(format);
  if (canonicalizeDeclaredMime(declaredMime) !== descriptor.mimeType) {
    throw new CmsMediaError(
      415,
      "media_mime_mismatch",
      "Il Content-Type non corrisponde ai byte dell'immagine.",
    );
  }

  validateImageStructure(bytes, format);

  return { ...descriptor, byteSize: bytes.byteLength };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new CmsMediaError(
      400,
      "media_id_invalid",
      `${field} deve essere un UUID valido.`,
    );
  }
}

export function createMediaStorageKey(
  venueId: string,
  mediaId: string,
  format: SupportedImageFormat,
): string {
  assertUuid(venueId, "venueId");
  assertUuid(mediaId, "mediaId");
  const extension = imageDescriptor(format).extension;
  return `venues/${venueId.toLowerCase()}/${mediaId.toLowerCase()}.${extension}`;
}

export function generateMediaStorageTarget(
  venueId: string,
  format: SupportedImageFormat,
  idFactory: () => string = () => crypto.randomUUID(),
): MediaStorageTarget {
  const mediaId = idFactory();
  return {
    mediaId,
    storageKey: createMediaStorageKey(venueId, mediaId, format),
  };
}
