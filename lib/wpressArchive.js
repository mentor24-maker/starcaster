'use strict';

/**
 * Writer for the .wpress archive — the backup format of the All-in-One WP
 * Migration plugin (ServMask). Read from the plugin's own source, v7.112:
 * lib/vendor/servmask/archiver/class-ai1wm-archiver.php and
 * class-ai1wm-compressor.php.
 *
 * An archive is a run of entries, then one end-of-file block:
 *
 *   entry  = 4377-byte header, then the file's bytes (uncompressed)
 *   header = name   255  file name, no path           ┐ each field is a
 *            size    14  byte count, as decimal text  │ NUL-padded string
 *            mtime   12  unix seconds, decimal text   │ (PHP pack 'a')
 *            path  4088  folder, forward slashes;     │
 *                        "." for the archive root     │
 *            crc32    8  CRC-32 of the bytes, 8 hex   ┘
 *   EOF    = 255 NULs, archive size before the EOF (14, decimal), 4100 NULs,
 *            CRC-32 of every byte before the EOF (8 hex)
 *
 * The plugin checks both CRCs on import, so they are not optional here even
 * though the format allows them blank.
 *
 * Streaming: `write` is called with each piece as it is produced, so an
 * archive with hundreds of images never has to sit in memory whole — which is
 * what keeps a download clear of Vercel's 4.5 MB buffered-response cap.
 */

const HEADER_SIZE = 4377;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (the same "crc32b" PHP's hash() computes). Pass the previous value to continue. */
function crc32(buf, previous = 0) {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i += 1) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function crcHex(value) {
  return value.toString(16).padStart(8, '0');
}

/** PHP pack('a<length>'): the string's bytes, cut to length, NUL-padded. */
function packField(value, length) {
  const field = Buffer.alloc(length, 0);
  Buffer.from(String(value ?? ''), 'utf8').copy(field, 0, 0, length);
  return field;
}

function fileHeader({ name, size, mtime, path, crc }) {
  return Buffer.concat([
    packField(name, 255),
    packField(String(size), 14),
    packField(String(mtime), 12),
    packField(path, 4088),
    packField(crc, 8),
  ]);
}

function eofBlock(archiveSize, archiveCrc) {
  return Buffer.concat([
    Buffer.alloc(255, 0),
    packField(String(archiveSize), 14),
    Buffer.alloc(4100, 0),
    packField(archiveCrc, 8),
  ]);
}

class WpressWriter {
  /** @param {(chunk: Buffer) => (void|Promise<void>)} write */
  constructor(write) {
    this.sink = write;
    this.size = 0;
    this.crc = 0;
    this.entries = [];
  }

  async emit(chunk) {
    this.size += chunk.length;
    this.crc = crc32(chunk, this.crc);
    await this.sink(chunk);
  }

  /**
   * Add one file. `archivePath` is where it lands relative to the archive
   * root ("package.json", "uploads/starcaster/a.jpg"); the plugin extracts
   * the root into wp-content, except its own config files.
   */
  async addFile(archivePath, data, mtime = Math.floor(Date.now() / 1000)) {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const clean = String(archivePath).replace(/\\/g, '/').replace(/^\/+/, '');
    const slash = clean.lastIndexOf('/');
    const name = slash === -1 ? clean : clean.slice(slash + 1);
    const path = slash === -1 ? '.' : clean.slice(0, slash);
    if (!name) throw new Error(`wpress: empty file name for "${archivePath}"`);
    if (Buffer.byteLength(name) > 255) throw new Error(`wpress: file name longer than 255 bytes: ${name}`);
    await this.emit(fileHeader({ name, size: bytes.length, mtime, path, crc: crcHex(crc32(bytes)) }));
    await this.emit(bytes);
    this.entries.push({ name, path, size: bytes.length });
  }

  /** Write the end-of-file block. Nothing may be added after this. */
  async finish() {
    const block = eofBlock(this.size, crcHex(this.crc));
    await this.sink(block);
    return { bytes: this.size + block.length, entries: this.entries.length };
  }
}

/**
 * Read an archive back into its entries — the inverse of the writer, used by
 * the tests and as a self-check. Throws on anything the plugin would refuse.
 */
function readWpress(buf) {
  const field = (start, length) => {
    const raw = buf.subarray(start, start + length);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
  };
  const entries = [];
  let offset = 0;
  for (;;) {
    if (offset + HEADER_SIZE > buf.length) throw new Error('wpress: archive ends without an EOF block');
    const name = field(offset, 255);
    if (!name) {
      const size = Number(field(offset + 255, 14));
      const crc = field(offset + 255 + 14 + 4100, 8);
      if (size !== offset) throw new Error(`wpress: EOF says ${size} bytes, archive has ${offset}`);
      if (crc !== crcHex(crc32(buf.subarray(0, offset)))) throw new Error('wpress: archive CRC does not match');
      if (offset + HEADER_SIZE !== buf.length) throw new Error('wpress: bytes after the EOF block');
      return { entries, archiveCrc: crc };
    }
    const size = Number(field(offset + 255, 14));
    const mtime = Number(field(offset + 269, 12));
    const path = field(offset + 281, 4088);
    const crc = field(offset + 4369, 8);
    const data = buf.subarray(offset + HEADER_SIZE, offset + HEADER_SIZE + size);
    if (data.length !== size) throw new Error(`wpress: ${name} is cut short`);
    if (crc !== crcHex(crc32(data))) throw new Error(`wpress: CRC mismatch on ${path}/${name}`);
    entries.push({ name, path, size, mtime, crc, data });
    offset += HEADER_SIZE + size;
  }
}

module.exports = { WpressWriter, readWpress, crc32, crcHex, HEADER_SIZE };
