import assert from "node:assert/strict";
import test from "node:test";

import {
  CmsMediaError,
  DEFAULT_MAX_MEDIA_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  createMediaStorageKey,
  generateMediaStorageTarget,
  sniffImageFormat,
  validateImageBytes,
} from "../src/lib/cms/media.ts";

const VENUE_ID = "550e8400-e29b-41d4-a716-446655440000";
const MEDIA_ID = "123e4567-e89b-42d3-a456-426614174000";

const JPEG = new Uint8Array(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==",
    "base64",
  ),
);
const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oHHAcAMPBygFoAAAAKSURBVAjXY2gAAACCAIHdQ2r0AAAAAElFTkSuQmCC",
    "base64",
  ),
);
const WEBP = new Uint8Array(
  Buffer.from(
    "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=",
    "base64",
  ),
);
const WEBP_ALPHA = new Uint8Array(
  Buffer.from(
    "UklGRkAAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAAFZQOCAYAAAAMAEAnQEqAQABAAIANCWkAANwAP77/VAA",
    "base64",
  ),
);
const WEBP_LOSSLESS = new Uint8Array(
  Buffer.from(
    "UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=",
    "base64",
  ),
);

function clone(bytes) {
  return new Uint8Array(bytes);
}

function append(bytes, suffix = [0x3c, 0x21, 0x2d, 0x2d]) {
  const result = new Uint8Array(bytes.byteLength + suffix.length);
  result.set(bytes);
  result.set(suffix, bytes.byteLength);
  return result;
}

function expectCmsCode(code) {
  return (error) => error instanceof CmsMediaError && error.code === code;
}

function findBytes(bytes, values) {
  outer: for (
    let offset = 0;
    offset <= bytes.byteLength - values.length;
    offset += 1
  ) {
    for (let index = 0; index < values.length; index += 1) {
      if (bytes[offset + index] !== values[index]) continue outer;
    }
    return offset;
  }
  throw new Error(`Sequence not found: ${values.join(",")}`);
}

function writeUint16BigEndian(bytes, offset, value) {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeUint16LittleEndian(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32BigEndian(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeUint32LittleEndian(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function testCrc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function setJpegDimensions(bytes, width, height) {
  const result = clone(bytes);
  const sofOffset = findBytes(result, [0xff, 0xc0]);
  writeUint16BigEndian(result, sofOffset + 5, height);
  writeUint16BigEndian(result, sofOffset + 7, width);
  return result;
}

function setPngDimensions(bytes, width, height) {
  const result = clone(bytes);
  writeUint32BigEndian(result, 16, width);
  writeUint32BigEndian(result, 20, height);
  writeUint32BigEndian(result, 29, testCrc32(result, 12, 29));
  return result;
}

function setWebpDimensions(bytes, width, height) {
  const result = clone(bytes);
  const vp8Offset = findBytes(result, [0x56, 0x50, 0x38, 0x20]);
  const dataOffset = vp8Offset + 8;
  writeUint16LittleEndian(result, dataOffset + 6, width);
  writeUint16LittleEndian(result, dataOffset + 8, height);
  return result;
}

test("accepts complete JPEG, PNG and WebP files and canonicalizes MIME", () => {
  assert.equal(sniffImageFormat(JPEG), "jpeg");
  assert.equal(sniffImageFormat(PNG), "png");
  assert.equal(sniffImageFormat(WEBP), "webp");

  assert.deepEqual(validateImageBytes(JPEG, "image/jpg"), {
    format: "jpeg",
    mimeType: "image/jpeg",
    extension: "jpg",
    byteSize: JPEG.byteLength,
  });
  assert.equal(validateImageBytes(PNG, "image/png").extension, "png");
  assert.equal(validateImageBytes(WEBP, "image/webp").extension, "webp");
  assert.equal(
    validateImageBytes(WEBP_ALPHA, "image/webp").extension,
    "webp",
  );
  assert.equal(
    validateImageBytes(WEBP_LOSSLESS, "image/webp").extension,
    "webp",
  );
});

test("rejects signature-only, truncated and trailing-byte image candidates", () => {
  const signatureOnly = [
    [new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg"],
    [
      new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]),
      "image/png",
    ],
    [
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
        0x50,
      ]),
      "image/webp",
    ],
  ];

  for (const [bytes, mime] of signatureOnly) {
    assert.throws(() => validateImageBytes(bytes, mime), expectCmsCode("media_invalid"));
  }

  for (const [bytes, mime] of [
    [JPEG, "image/jpeg"],
    [PNG, "image/png"],
    [WEBP, "image/webp"],
  ]) {
    assert.throws(
      () => validateImageBytes(bytes.slice(0, -1), mime),
      expectCmsCode("media_invalid"),
    );
    assert.throws(
      () => validateImageBytes(append(bytes), mime),
      expectCmsCode("media_invalid"),
    );
  }
});

test("rejects malformed JPEG segments, PNG chunks and WebP RIFF chunks", () => {
  const malformedJpeg = clone(JPEG);
  const appOffset = findBytes(malformedJpeg, [0xff, 0xe0]);
  malformedJpeg[appOffset + 2] = 0;
  malformedJpeg[appOffset + 3] = 1;
  assert.throws(
    () => validateImageBytes(malformedJpeg, "image/jpeg"),
    expectCmsCode("media_invalid"),
  );

  const badPngCrc = clone(PNG);
  const idatOffset = findBytes(badPngCrc, [0x49, 0x44, 0x41, 0x54]);
  badPngCrc[idatOffset + 4] ^= 0x01;
  assert.throws(
    () => validateImageBytes(badPngCrc, "image/png"),
    expectCmsCode("media_invalid"),
  );

  const badPngZlibHeader = clone(PNG);
  const pngDataOffset =
    findBytes(badPngZlibHeader, [0x49, 0x44, 0x41, 0x54]) + 4;
  badPngZlibHeader[pngDataOffset] = 0;
  const idatTypeOffset = pngDataOffset - 4;
  const idatLength =
    badPngZlibHeader[idatTypeOffset - 4] * 0x1000000 +
    badPngZlibHeader[idatTypeOffset - 3] * 0x10000 +
    badPngZlibHeader[idatTypeOffset - 2] * 0x100 +
    badPngZlibHeader[idatTypeOffset - 1];
  writeUint32BigEndian(
    badPngZlibHeader,
    pngDataOffset + idatLength,
    testCrc32(
      badPngZlibHeader,
      idatTypeOffset,
      pngDataOffset + idatLength,
    ),
  );
  assert.throws(
    () => validateImageBytes(badPngZlibHeader, "image/png"),
    expectCmsCode("media_invalid"),
  );

  const malformedWebp = clone(WEBP);
  const vp8Offset = findBytes(malformedWebp, [0x56, 0x50, 0x38, 0x20]);
  malformedWebp.fill(0xff, vp8Offset + 4, vp8Offset + 8);
  assert.throws(
    () => validateImageBytes(malformedWebp, "image/webp"),
    expectCmsCode("media_invalid"),
  );

  const webpWithUnknownTrailingChunk = append(WEBP, [
    0x48, 0x54, 0x4d, 0x4c, 0, 0, 0, 0,
  ]);
  writeUint32LittleEndian(
    webpWithUnknownTrailingChunk,
    4,
    webpWithUnknownTrailingChunk.byteLength - 8,
  );
  assert.throws(
    () => validateImageBytes(webpWithUnknownTrailingChunk, "image/webp"),
    expectCmsCode("media_invalid"),
  );
});

test("rejects zero, overlong and excessive-pixel dimensions", () => {
  assert.equal(MAX_IMAGE_DIMENSION, 10_000);
  assert.equal(MAX_IMAGE_PIXELS, 40_000_000);

  for (const [bytes, mime] of [
    [setJpegDimensions(JPEG, 0, 1), "image/jpeg"],
    [setPngDimensions(PNG, 0, 1), "image/png"],
    [setWebpDimensions(WEBP, 0, 1), "image/webp"],
  ]) {
    assert.throws(
      () => validateImageBytes(bytes, mime),
      expectCmsCode("media_invalid"),
    );
  }

  for (const [bytes, mime] of [
    [setJpegDimensions(JPEG, MAX_IMAGE_DIMENSION + 1, 1), "image/jpeg"],
    [setPngDimensions(PNG, MAX_IMAGE_DIMENSION + 1, 1), "image/png"],
    [setWebpDimensions(WEBP, MAX_IMAGE_DIMENSION + 1, 1), "image/webp"],
    [setJpegDimensions(JPEG, 8_000, 6_000), "image/jpeg"],
    [setPngDimensions(PNG, 8_000, 6_000), "image/png"],
    [setWebpDimensions(WEBP, 8_000, 6_000), "image/webp"],
  ]) {
    assert.throws(
      () => validateImageBytes(bytes, mime),
      expectCmsCode("media_dimensions_exceeded"),
    );
  }
});

test("rejects MIME mismatches, active content and oversized inputs", () => {
  assert.equal(DEFAULT_MAX_MEDIA_BYTES, 8 * 1024 * 1024);
  assert.throws(
    () => validateImageBytes(PNG, "image/jpeg"),
    expectCmsCode("media_mime_mismatch"),
  );

  const html = new TextEncoder().encode("<script>alert(1)</script>");
  assert.throws(
    () => validateImageBytes(html, "image/jpeg"),
    expectCmsCode("media_type_unsupported"),
  );

  assert.throws(
    () => validateImageBytes(PNG, "image/png", PNG.byteLength - 1),
    expectCmsCode("media_too_large"),
  );
});

test("builds private R2 keys only from validated UUIDs and canonical extension", () => {
  assert.equal(
    createMediaStorageKey(VENUE_ID, MEDIA_ID, "jpeg"),
    `venues/${VENUE_ID}/${MEDIA_ID}.jpg`,
  );

  const target = generateMediaStorageTarget(VENUE_ID, "webp", () => MEDIA_ID);
  assert.deepEqual(target, {
    mediaId: MEDIA_ID,
    storageKey: `venues/${VENUE_ID}/${MEDIA_ID}.webp`,
  });

  for (const maliciousId of [
    "../../main",
    "550e8400-e29b-41d4-a716-446655440000/escape",
    "%2e%2e",
  ]) {
    assert.throws(
      () => createMediaStorageKey(maliciousId, MEDIA_ID, "png"),
      (error) =>
        error instanceof CmsMediaError && error.code === "media_id_invalid",
    );
  }
});
