import { decodeLegacy } from './legacy-tables.js';

const WASM_URL = new URL('./chm.wasm', import.meta.url);

let wasmPromise = null;

async function loadWasm() {
  if (!wasmPromise) {
    wasmPromise = fetch(WASM_URL).then(async (response) => {
      if (!response.ok) throw new Error(`无法加载解析核心：${response.status}`);
      const bytes = await response.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, {});
      return instance.exports;
    });
  }
  return wasmPromise;
}

function decoderFor(charset) {
  const label = (charset || 'utf-8').toLowerCase();
  if (label === 'gbk' || label === 'gb18030' || label === 'gb2312') {
    return { decode: (bytes) => decodeLegacy(bytes, 'gbk') };
  }
  if (label === 'big5' || label === 'big-5') {
    return { decode: (bytes) => decodeLegacy(bytes, 'big5') };
  }
  try {
    if (label === 'windows-1252' || label === 'iso-8859-1') {
      const decoder = new TextDecoder('windows-1252', { fatal: false });
      return { decode: (bytes) => decoder.decode(bytes) };
    }
    const decoder = new TextDecoder('utf-8', { fatal: false });
    return { decode: (bytes) => decoder.decode(bytes) };
  } catch {
    const decoder = new TextDecoder('utf-8', { fatal: false });
    return { decode: (bytes) => decoder.decode(bytes) };
  }
}

function decodePercent(encoded, decoder) {
  if (!encoded) return '';
  const bytes = new Uint8Array(Math.floor(encoded.length / 3));
  let count = 0;
  for (let index = 0; index + 2 < encoded.length; index += 3) {
    if (encoded[index] !== '%') return '';
    const high = parseInt(encoded.slice(index + 1, index + 3), 16);
    if (Number.isNaN(high)) return '';
    bytes[count++] = high;
  }
  return decoder.decode(bytes.subarray(0, count));
}

function normalizePath(path) {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function contentHeader(path) {
  const extension = path.split('.').pop()?.toLowerCase() || '';
  const types = {
    htm: 'text/html',
    html: 'text/html',
    xhtml: 'application/xhtml+xml',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    txt: 'text/plain; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
  };
  return types[extension] || 'application/octet-stream';
}

export class ChmArchive {
  static async open(buffer) {
    const exports = await loadWasm();
    const archive = new ChmArchive(exports);
    archive.pointer = exports.chm_web_malloc(buffer.byteLength);
    if (!archive.pointer) throw new Error('解析器内存不足');
    new Uint8Array(exports.memory.buffer, archive.pointer, buffer.byteLength)
      .set(new Uint8Array(buffer));
    if (!exports.chm_web_open(archive.pointer, buffer.byteLength)) {
      const message = archive.readCString(exports.chm_web_error()) || '无法打开 CHM';
      archive.close();
      throw new Error(message);
    }
    return archive;
  }

  constructor(exports) {
    this.exports = exports;
    this.pointer = 0;
  }

  readCString(pointer) {
    if (!pointer) return '';
    const memory = new Uint8Array(this.exports.memory.buffer);
    let end = pointer;
    while (memory[end] !== 0) end++;
    return new TextDecoder('utf-8').decode(memory.slice(pointer, end));
  }

  toc() {
    const pointer = this.exports.chm_web_toc();
    if (!pointer) {
      throw new Error(this.readCString(this.exports.chm_web_error()) || '目录解析失败');
    }
    const length = this.exports.chm_web_strlen(pointer);
    const json = new TextDecoder('utf-8').decode(
      new Uint8Array(this.exports.memory.buffer, pointer, length)
    );
    this.exports.chm_web_free(pointer);
    const payload = JSON.parse(json);
    const charset = payload.charset || 'utf-8';
    const decoder = decoderFor(charset);
    const nodes = (payload.nodes || []).map((node) => ({
      id: node.id,
      parent: node.parent,
      depth: node.depth,
      title: decodePercent(node.titleBytes, decoder) || node.title || '',
      localPath: decodePercent(node.localBytes, decoder) || node.local || '',
      image: node.image || 0,
    }));
    return {
      available: Boolean(payload.available),
      source: payload.source || '',
      charset,
      nodes,
    };
  }

  entries() {
    const count = this.exports.chm_web_entry_count();
    const memory = new Uint8Array(this.exports.memory.buffer);
    const entries = [];
    for (let index = 0; index < count; index++) {
      const pointer = this.exports.chm_web_entry_path(index);
      const length = Number(this.exports.chm_web_entry_length(index));
      let end = pointer;
      while (memory[end] !== 0) end++;
      entries.push({
        index,
        pathBytes: memory.slice(pointer, end),
        length,
      });
    }
    return entries;
  }

  read(index, length) {
    const pointer = this.exports.chm_web_malloc(length || 1);
    if (!pointer) throw new Error('解析器内存不足');
    const read = Number(this.exports.chm_web_entry_read(index, pointer, length));
    if (read < 0) {
      this.exports.chm_web_free(pointer);
      throw new Error('读取 CHM 文件失败');
    }
    const data = new Uint8Array(this.exports.memory.buffer, pointer, read).slice();
    this.exports.chm_web_free(pointer);
    return data;
  }

  homePath() {
    return normalizePath(this.readCString(this.exports.chm_web_home()));
  }

  close() {
    if (this.pointer) {
      this.exports.chm_web_close();
      this.exports.chm_web_memory_free(this.pointer);
      this.pointer = 0;
    }
  }
}

export { decoderFor, decodePercent, normalizePath, contentHeader };
