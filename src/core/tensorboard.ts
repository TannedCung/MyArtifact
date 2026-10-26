import os from 'node:os';
import type { TensorBoardScalarPoint } from './types.js';

// Castagnoli CRC32C lookup table for TensorFlow TFRecord checksums
const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0x82f63b78 : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

export function crc32c(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32C_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function maskCrc32c(crc: number): number {
  return ((((crc >>> 15) | (crc << 17)) >>> 0) + 0xa282ead8) >>> 0;
}

function encodeVarint(val: number): Buffer {
  const bytes: number[] = [];
  let v = BigInt(Math.max(0, Math.floor(val)));
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

function encodeLengthDelimited(fieldNum: number, payload: Buffer): Buffer {
  const tag = encodeVarint((fieldNum << 3) | 2);
  const len = encodeVarint(payload.length);
  return Buffer.concat([tag, len, payload]);
}

export function wrapTfRecord(payload: Buffer): Buffer {
  const header = Buffer.alloc(12);
  header.writeBigUInt64LE(BigInt(payload.length), 0);
  const lenCrc = maskCrc32c(crc32c(header.subarray(0, 8)));
  header.writeUInt32LE(lenCrc, 8);

  const footer = Buffer.alloc(4);
  const dataCrc = maskCrc32c(crc32c(payload));
  footer.writeUInt32LE(dataCrc, 0);

  return Buffer.concat([header, payload, footer]);
}

export function encodeTfEventHeader(wallTimeSec = Date.now() / 1000): Buffer {
  const wallBuf = Buffer.alloc(9);
  wallBuf[0] = 0x09; // field 1, fixed64 (double)
  wallBuf.writeDoubleLE(wallTimeSec, 1);

  const versionStr = Buffer.from('brain.Event:2', 'utf8');
  const fileVer = encodeLengthDelimited(3, versionStr);

  return wrapTfRecord(Buffer.concat([wallBuf, fileVer]));
}

export function encodeTfEventScalar(
  tag: string,
  step: number,
  value: number,
  wallTimeSec = Date.now() / 1000
): Buffer {
  // Summary.Value: field 1 = tag (string), field 2 = simple_value (float32)
  const tagField = encodeLengthDelimited(1, Buffer.from(tag, 'utf8'));
  const valField = Buffer.alloc(5);
  valField[0] = 0x15; // field 2, wire type 5 (fixed32 float)
  valField.writeFloatLE(value, 1);

  const summaryValue = Buffer.concat([tagField, valField]);
  // Summary: field 1 = repeated Value
  const summary = encodeLengthDelimited(1, summaryValue);

  // Event: field 1 = wall_time (double), field 2 = step (varint), field 5 = summary
  const wallBuf = Buffer.alloc(9);
  wallBuf[0] = 0x09;
  wallBuf.writeDoubleLE(wallTimeSec, 1);

  const stepBuf = Buffer.concat([Buffer.from([0x10]), encodeVarint(step)]);
  const summaryField = encodeLengthDelimited(5, summary);

  return wrapTfRecord(Buffer.concat([wallBuf, stepBuf, summaryField]));
}

function readVarint(
  buf: Buffer,
  offset: number
): { value: number; nextOffset: number } | null {
  let result = 0n;
  let shift = 0n;
  let pos = offset;
  while (pos < buf.length) {
    const byte = BigInt(buf[pos++]);
    result |= (byte & 0x7fn) << shift;
    if ((byte & 0x80n) === 0n) {
      return { value: Number(result), nextOffset: pos };
    }
    shift += 7n;
    if (shift > 63n) return null;
  }
  return null;
}

function decodeTensorProtoFloat(buf: Buffer): number | null {
  let offset = 0;
  let floatVal: number | null = null;
  while (offset < buf.length) {
    const tagInfo = readVarint(buf, offset);
    if (!tagInfo) break;
    offset = tagInfo.nextOffset;
    const fieldNum = tagInfo.value >>> 3;
    const wireType = tagInfo.value & 0x7;

    if (wireType === 0) {
      const v = readVarint(buf, offset);
      if (!v) break;
      offset = v.nextOffset;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 2) {
      const lenInfo = readVarint(buf, offset);
      if (!lenInfo) break;
      offset = lenInfo.nextOffset;
      const sub = buf.subarray(offset, offset + lenInfo.value);
      offset += lenInfo.value;
      // field 4 = tensor_content (raw float32 bytes), field 5 = packed float_val
      if ((fieldNum === 4 || fieldNum === 5) && sub.length >= 4) {
        floatVal = sub.readFloatLE(0);
      }
    } else if (wireType === 5) {
      if (offset + 4 > buf.length) break;
      if (fieldNum === 5) {
        floatVal = buf.readFloatLE(offset);
      }
      offset += 4;
    } else {
      break;
    }
  }
  return floatVal;
}

function decodeSummaryValue(
  buf: Buffer
): { tag: string; value: number } | null {
  let offset = 0;
  let tag = '';
  let simpleValue: number | null = null;

  while (offset < buf.length) {
    const tagInfo = readVarint(buf, offset);
    if (!tagInfo) break;
    offset = tagInfo.nextOffset;
    const fieldNum = tagInfo.value >>> 3;
    const wireType = tagInfo.value & 0x7;

    if (wireType === 0) {
      const v = readVarint(buf, offset);
      if (!v) break;
      offset = v.nextOffset;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 2) {
      const lenInfo = readVarint(buf, offset);
      if (!lenInfo) break;
      offset = lenInfo.nextOffset;
      const sub = buf.subarray(offset, offset + lenInfo.value);
      offset += lenInfo.value;
      if (fieldNum === 1) {
        tag = sub.toString('utf8');
      } else if (fieldNum === 8) {
        const tensorVal = decodeTensorProtoFloat(sub);
        if (tensorVal !== null) simpleValue = tensorVal;
      }
    } else if (wireType === 5) {
      if (offset + 4 > buf.length) break;
      if (fieldNum === 2) {
        simpleValue = buf.readFloatLE(offset);
      }
      offset += 4;
    } else {
      break;
    }
  }

  if (tag && simpleValue !== null && Number.isFinite(simpleValue)) {
    return { tag, value: Number(simpleValue.toPrecision(7)) };
  }
  return null;
}

function decodeSummary(buf: Buffer): Array<{ tag: string; value: number }> {
  const results: Array<{ tag: string; value: number }> = [];
  let offset = 0;
  while (offset < buf.length) {
    const tagInfo = readVarint(buf, offset);
    if (!tagInfo) break;
    offset = tagInfo.nextOffset;
    const fieldNum = tagInfo.value >>> 3;
    const wireType = tagInfo.value & 0x7;

    if (wireType === 2) {
      const lenInfo = readVarint(buf, offset);
      if (!lenInfo) break;
      offset = lenInfo.nextOffset;
      const sub = buf.subarray(offset, offset + lenInfo.value);
      offset += lenInfo.value;
      if (fieldNum === 1) {
        const parsed = decodeSummaryValue(sub);
        if (parsed) results.push(parsed);
      }
    } else if (wireType === 0) {
      const v = readVarint(buf, offset);
      if (!v) break;
      offset = v.nextOffset;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      break;
    }
  }
  return results;
}

function decodeEventRecord(buf: Buffer): TensorBoardScalarPoint[] {
  let offset = 0;
  let wallTime = Date.now() / 1000;
  let step = 0;
  const scalars: Array<{ tag: string; value: number }> = [];

  while (offset < buf.length) {
    const tagInfo = readVarint(buf, offset);
    if (!tagInfo) break;
    offset = tagInfo.nextOffset;
    const fieldNum = tagInfo.value >>> 3;
    const wireType = tagInfo.value & 0x7;

    if (wireType === 1) {
      if (offset + 8 > buf.length) break;
      if (fieldNum === 1) {
        wallTime = buf.readDoubleLE(offset);
      }
      offset += 8;
    } else if (wireType === 0) {
      const v = readVarint(buf, offset);
      if (!v) break;
      offset = v.nextOffset;
      if (fieldNum === 2) {
        step = v.value;
      }
    } else if (wireType === 2) {
      const lenInfo = readVarint(buf, offset);
      if (!lenInfo) break;
      offset = lenInfo.nextOffset;
      const sub = buf.subarray(offset, offset + lenInfo.value);
      offset += lenInfo.value;
      if (fieldNum === 5) {
        scalars.push(...decodeSummary(sub));
      }
    } else if (wireType === 5) {
      offset += 4;
    } else {
      break;
    }
  }

  return scalars.map((s) => ({
    tag: s.tag,
    step,
    value: s.value,
    wallTime,
  }));
}

export function parseTfEventsBuffer(buf: Buffer): TensorBoardScalarPoint[] {
  const points: TensorBoardScalarPoint[] = [];
  let offset = 0;

  while (offset + 16 <= buf.length) {
    const len = Number(buf.readBigUInt64LE(offset));
    if (len < 0 || offset + 12 + len + 4 > buf.length) {
      break;
    }
    const payload = buf.subarray(offset + 12, offset + 12 + len);
    points.push(...decodeEventRecord(payload));
    offset += 12 + len + 4;
  }

  return points;
}

export function getDefaultEventFileName(timestampSec = Math.floor(Date.now() / 1000)): string {
  const host = os.hostname().replace(/[^a-zA-Z0-9.-]/g, '') || 'localhost';
  return `events.out.tfevents.${timestampSec}.${host}.${process.pid}.0`;
}
