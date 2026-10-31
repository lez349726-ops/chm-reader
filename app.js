import { ChmArchive, decoderFor, normalizePath, contentHeader } from './chm.js';
import { shelfDb } from './db.js';

const BASE = new URL('./', location.href);
const dom = {
  topbar: document.getElementById('topbar'),
  backButton: document.getElementById('backButton'),
  screenTitle: document.getElementById('screenTitle'),
  screenSubtitle: document.getElementById('screenSubtitle'),
  readerActions: document.getElementById('readerActions'),
  prevButton: document.getElementById('prevButton'),
  nextButton: document.getElementById('nextButton'),
  tocButton: document.getElementById('tocButton'),
  searchButton: document.getElementById('searchButton'),
  fontButton: document.getElementById('fontButton'),
  shelfScreen: document.getElementById('shelfScreen'),
  readerScreen: document.getElementById('readerScreen'),
  profileScreen: document.getElementById('profileScreen'),
  importButton: document.getElementById('importButton'),
  importLabel: document.getElementById('importLabel'),
  filePicker: document.getElementById('filePicker'),
  bookList: document.getElementById('bookList'),
  importProgress: document.getElementById('importProgress'),
  importProgressBar: document.getElementById('importProgressBar'),
  importProgressText: document.getElementById('importProgressText'),
  shelfError: document.getElementById('shelfError'),
  readerFrame: document.getElementById('readerFrame'),
  readerError: document.getElementById('readerError'),
  shelfTab: document.getElementById('shelfTab'),
  profileTab: document.getElementById('profileTab'),
  bottomNav: document.getElementById('bottomNav'),
  tocPanel: document.getElementById('tocPanel'),
  tocList: document.getElementById('tocList'),
  searchPanel: document.getElementById('searchPanel'),
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  searchStatus: document.getElementById('searchStatus'),
  searchResults: document.getElementById('searchResults'),
  fontPanel: document.getElementById('fontPanel'),
  fontMinus: document.getElementById('fontMinus'),
  fontPlus: document.getElementById('fontPlus'),
  fontValue: document.getElementById('fontValue'),
  fontRange: document.getElementById('fontRange'),
  aboutPanel: document.getElementById('aboutPanel'),
  aboutButton: document.getElementById('aboutButton'),
  nightToggle: document.getElementById('nightToggle'),
  backdrop: document.getElementById('backdrop'),
  toast: document.getElementById('toast'),
};

const state = {
  books: [],
  book: null,
  toc: null,
  pages: [],
  currentPath: '',
  view: 'shelf',
  night: localStorage.getItem('chm-night') === '1',
  font: Number(localStorage.getItem('chm-font') || 100),
  searchMode: 'title',
  searchToken: 0,
  lastSavedPath: '',
};

function setView(view) {
  state.view = view;
  document.body.classList.toggle('view-shelf', view === 'shelf');
  document.body.classList.toggle('view-reader', view === 'reader');
  document.body.classList.toggle('view-profile', view === 'profile');
  dom.shelfScreen.hidden = view !== 'shelf';
  dom.readerScreen.hidden = view !== 'reader';
  dom.profileScreen.hidden = view !== 'profile';
  dom.readerActions.hidden = view !== 'reader';
  dom.backButton.hidden = view !== 'reader';
  dom.bottomNav?.classList?.toggle('visible', view !== 'reader');
  dom.screenTitle.textContent = view === 'reader'
    ? (state.book?.name || '书架')
    : view === 'profile' ? '我的' : '书架';
  dom.screenSubtitle.hidden = view !== 'reader';
  dom.topbar.classList.toggle('hidden', view === 'shelf');
  dom.shelfTab.classList.toggle('active', view === 'shelf' || view === 'reader');
  dom.profileTab.classList.toggle('active', view === 'profile');
  if (view !== 'reader') closePanels();
}

function setSubtitle(text) {
  dom.screenSubtitle.textContent = text || '';
  dom.screenSubtitle.hidden = !text || state.view !== 'reader';
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    dom.toast.hidden = true;
  }, 2600);
}

function showShelfError(message) {
  dom.shelfError.textContent = message;
  dom.shelfError.hidden = !message;
}

function updateProgress(done, total, text) {
  dom.importProgress.hidden = false;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  dom.importProgressBar.style.width = `${percent}%`;
  dom.importProgressText.textContent = text || `${percent}%`;
}

function hideProgress() {
  dom.importProgress.hidden = true;
}

function bookUrl(id, target) {
  const [pathPart, anchorPart = ''] = String(target || '').split('#');
  const encoded = normalizePath(pathPart)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const url = new URL(`book/${encodeURIComponent(id)}/${encoded}`, BASE);
  if (anchorPart) url.hash = anchorPart;
  return url.href;
}

function pathFromFrame() {
  try {
    const url = new URL(dom.readerFrame.contentWindow.location.href);
    const prefix = `${BASE.pathname}book/${encodeURIComponent(state.book?.id || '')}/`;
    if (!url.pathname.startsWith(prefix)) return '';
    return normalizePath(decodeURIComponent(url.pathname.slice(prefix.length)));
  } catch {
    return '';
  }
}

function flatten(nodes, depth = 0) {
  const result = [];
  for (const node of nodes) {
    result.push({ ...node, depth });
    result.push(...flatten(node.children || [], depth + 1));
  }
  return result;
}

function buildTree(nodes) {
  const byParent = new Map();
  for (const node of nodes) {
    const parent = Number(node.parent);
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(node);
  }
  const attach = (parent, depth) => (byParent.get(parent) || []).map((node) => ({
    ...node,
    depth,
    children: attach(node.id, depth + 1),
  }));
  return attach(-1, 0);
}

function bookPages(nodes) {
  return nodes
    .filter((node) => normalizePath(node.localPath))
    .map((node) => ({
      title: node.title || node.localPath,
      target: normalizePath(node.localPath),
    }));
}

function currentPageIndex() {
  const current = normalizePath(state.currentPath.split('#')[0]);
  return state.pages.findIndex((page) => normalizePath(page.target.split('#')[0]) === current);
}

function updateNavButtons() {
  const index = currentPageIndex();
  dom.prevButton.disabled = index <= 0;
  dom.nextButton.disabled = index < 0 || index >= state.pages.length - 1;
}

function navigate(target, updateHistory = true) {
  if (!state.book || !target) return;
  const [pathPart, anchor = ''] = String(target).split('#');
  const clean = normalizePath(pathPart);
  if (!clean) return;
  const url = bookUrl(state.book.id, `${clean}${anchor ? `#${anchor}` : ''}`);
  dom.readerError.hidden = true;
  dom.readerFrame.src = url;
  if (updateHistory) {
    history.replaceState(null, '', `${BASE.pathname}?book=${encodeURIComponent(state.book.id)}`);
  }
}

function prevPage() {
  const index = currentPageIndex();
  if (index > 0) navigate(state.pages[index - 1].target);
}

function nextPage() {
  const index = currentPageIndex();
  if (index >= 0 && index < state.pages.length - 1) navigate(state.pages[index + 1].target);
}

async function openBook(book) {
  try {
    const tocRaw = book.toc ? JSON.parse(book.toc) : { nodes: [] };
    state.book = book;
    state.toc = tocRaw;
    state.pages = bookPages(tocRaw.nodes || []);
    state.currentPath = normalizePath(book.lastPath || book.homePath || '');
    if (!state.currentPath && state.pages.length) state.currentPath = state.pages[0].target;
    setView('reader');
    dom.screenTitle.textContent = book.name;
    dom.readerError.hidden = true;
    await ensureServiceWorker();
    navigate(state.currentPath, false);
    renderToc();
  } catch (error) {
    showShelfError(error.message || String(error));
    setView('shelf');
  }
}

function closeBook() {
  state.book = null;
  state.toc = null;
  state.pages = [];
  state.currentPath = '';
  dom.readerFrame.src = 'about:blank';
  setView('shelf');
  loadShelf();
}

async function loadShelf() {
  state.books = await shelfDb.allBooks();
  dom.bookList.innerHTML = '';
  if (state.books.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'small-note';
    empty.textContent = '还没有书。导入一本 CHM 后会保存在这里。';
    dom.bookList.append(empty);
    return;
  }
  for (const book of state.books) {
    const card = document.createElement('article');
    card.className = 'book-card';
    card.innerHTML = `
      <div class="book-copy">
        <h3></h3>
        <p></p>
      </div>
      <button class="book-delete" type="button" aria-label="删除">×</button>
    `;
    card.querySelector('h3').textContent = book.name;
    card.querySelector('p').textContent = book.lastPath
      ? `上次读到：${book.lastPath.split('/').pop().split('#')[0]}`
      : '点击打开';
    card.addEventListener('click', () => openBook(book));
    card.querySelector('.book-delete').addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!confirm(`删除《${book.name}》及其本地数据？`)) return;
      await shelfDb.deleteBook(book.id);
      if (state.book?.id === book.id) closeBook();
      else loadShelf();
    });
    dom.bookList.append(card);
  }
}

async function ensureServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  await navigator.serviceWorker.register(new URL('sw.js', BASE), { scope: BASE.pathname });
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('网页缓存服务启动超时，请刷新页面重试')), 6000)),
  ]);
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
  if (!navigator.serviceWorker.controller) {
    throw new Error('网页缓存服务尚未接管页面，请刷新页面后重试');
  }
}

function setImportBusy(busy) {
  dom.filePicker.disabled = busy;
  dom.importButton.classList.toggle('disabled', busy);
  dom.importLabel.textContent = busy ? '正在处理…' : '导入 CHM';
}

async function importChm(file) {
  if (!file) return;
  if (!/\.chm$/i.test(file.name)) {
    showShelfError('请选择 .chm 文件。');
    return;
  }
  showShelfError('');
  setImportBusy(true);
  updateProgress(0, 100, '正在读取 CHM…');
  let archive = null;
  try {
    const buffer = await file.arrayBuffer();
    archive = await ChmArchive.open(buffer);
    const toc = archive.toc();
    const decoder = decoderFor(toc.charset);
    const rawEntries = archive.entries();
    const total = rawEntries.length;
    const files = [];
    const paths = new Set();
    for (let index = 0; index < rawEntries.length; index++) {
      const entry = rawEntries[index];
      const path = normalizePath(decodeEntryPath(entry.pathBytes, decoder));
      if (!path) continue;
      const bytes = archive.read(entry.index, entry.length);
      files.push({ path, data: bytes, type: contentHeader(path) });
      paths.add(path);
      if (index % 80 === 0) {
        updateProgress(index, total, `正在解压 ${index} / ${total}`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    const archiveHome = normalizePath(archive.homePath());
    archive.close();
    archive = null;

    const nodes = toc.nodes;
    const homePath = paths.has(archiveHome)
      ? archiveHome
      : normalizePath(nodes.find((node) => node.localPath && paths.has(node.localPath))?.localPath || '');
    if (!homePath) throw new Error('CHM 没有可显示的首页');
    const id = crypto.randomUUID();
    const book = {
      id,
      name: file.name.replace(/\.chm$/i, ''),
      size: file.size,
      addedAt: Date.now(),
      homePath,
      lastPath: homePath,
      charset: toc.charset,
      toc: JSON.stringify({ nodes }),
      fileCount: files.length,
    };
    updateProgress(total, total, '正在保存到书架…');
    await shelfDb.putBook(book);
    await shelfDb.putFiles(id, files, (done, all) => {
      updateProgress(done, all, `正在保存 ${done} / ${all}`);
    });
    hideProgress();
    await loadShelf();
    await openBook(book);
  } catch (error) {
    console.error(error);
    showShelfError(error.message || String(error));
    hideProgress();
  } finally {
    if (archive) archive.close();
    setImportBusy(false);
  }
}

/* CHM object paths are normally UTF-8 on Windows, while the HHC catalog can
   use the legacy charset. Prefer valid UTF-8, then fall back to the catalog
   decoder. */
function decodeEntryPath(bytes, fallbackDecoder) {
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!utf8.includes('\uFFFD')) return utf8;
  } catch {
    /* not valid UTF-8 */
  }
  return fallbackDecoder.decode(bytes);
}

/* ------------------------------------------------------------------------- */
/* Reader styling and navigation                                             */
/* ------------------------------------------------------------------------- */

function applyReaderStyle() {
  let doc = null;
  try {
    doc = dom.readerFrame.contentDocument;
  } catch {
    return;
  }
  if (!doc) return;
  let style = doc.getElementById('chm-reader-theme');
  if (!style) {
    style = doc.createElement('style');
    style.id = 'chm-reader-theme';
    (doc.head || doc.documentElement).appendChild(style);
  }
  const font = state.font;
  const night = state.night;
  const rules = [
    `html{-webkit-text-size-adjust:${font}%!important;text-size-adjust:${font}%!important;}`,
    `body{zoom:${font / 100};}`,
  ];
  if (night) {
    rules.push(`
      html,body{background:#111!important;color:#ddd!important;}
      body *:not(img):not(video):not(svg):not(canvas){
        background-color:transparent!important;
        color:#ddd!important;
        border-color:#555!important;
      }
      a,a *{color:#8ab4f8!important;}
      img,video{opacity:.88;}
      pre,code{background:#1d1d1d!important;color:#eee!important;}
      table,td,th{border-color:#555!important;}
    `);
  }
  style.textContent = rules.join('\n');
  try {
    doc.documentElement.style.background = night ? '#111' : '';
    doc.body.style.background = night ? '#111' : '';
  } catch {
    /* ignore */
  }
}

function onFrameLoad() {
  applyReaderStyle();
  const path = pathFromFrame();
  if (!path) return;
  state.currentPath = path;
  const page = state.pages.find((item) =>
    normalizePath(item.target.split('#')[0]) === path);
  setSubtitle(page?.title || '');
  updateNavButtons();
  saveLastPath(path);
  setTimeout(applyReaderStyle, 250);
}

let saveTimer = null;
function saveLastPath(path) {
  if (!state.book || !path || state.lastSavedPath === path) return;
  state.lastSavedPath = path;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!state.book) return;
    const book = { ...state.book, lastPath: path };
    state.book = book;
    await shelfDb.putBook(book);
  }, 300);
}

function renderToc() {
  dom.tocList.innerHTML = '';
  if (!state.toc || !state.toc.nodes?.length) {
    dom.tocList.textContent = '这本 CHM 没有可用的目录。';
    return;
  }
  const tree = buildTree(state.toc.nodes);
  const list = document.createElement('ul');
  list.className = 'toc-tree';
  const addNodes = (nodes, parent) => {
    for (const node of nodes) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toc-item';
      button.textContent = node.title || node.localPath || '未命名';
      if (node.localPath) {
        button.addEventListener('click', () => {
          closePanels();
          navigate(node.localPath);
        });
      }
      li.append(button);
      if (node.children?.length) {
        const childList = document.createElement('ul');
        addNodes(node.children, childList);
        li.append(childList);
      }
      parent.append(li);
    }
  };
  addNodes(tree, list);
  dom.tocList.append(list);
}

function decodeHtml(record) {
  const bytes = record.data instanceof Uint8Array ? record.data : new Uint8Array(record.data);
  const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, Math.min(4096, bytes.length)));
  const meta = head.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i);
  const decoder = decoderFor(meta?.[1] || state.book?.charset || 'utf-8');
  return decoder.decode(bytes);
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function documentTitle(html) {
  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return stripHtml(heading || title || '');
}

async function runSearch() {
  const query = dom.searchInput.value.trim();
  const token = ++state.searchToken;
  dom.searchResults.innerHTML = '';
  if (!query || !state.book) {
    dom.searchStatus.textContent = '';
    return;
  }
  dom.searchStatus.textContent = '正在搜索…';
  await new Promise((resolve) => setTimeout(resolve, 120));
  const allFiles = await shelfDb.getFiles(state.book.id);
  const candidates = allFiles.filter((record) => /\.(html?|xhtml)$/i.test(record.path));
  const results = [];
  for (let index = 0; index < candidates.length; index++) {
    if (token !== state.searchToken) return;
    const record = candidates[index];
    const html = decodeHtml(record);
    const title = documentTitle(html);
    const titleMatch = Boolean(title) && title.toLowerCase().includes(query.toLowerCase());
    let snippet = '';
    let contentMatch = false;
    if (state.searchMode === 'full') {
      const text = stripHtml(html);
      const at = text.toLowerCase().indexOf(query.toLowerCase());
      contentMatch = at >= 0;
      if (at >= 0) {
        snippet = text.slice(Math.max(0, at - 60), at + query.length + 100);
      }
    }
    if (state.searchMode === 'title' && !titleMatch) continue;
    if (state.searchMode === 'full' && !titleMatch && !contentMatch) continue;
    results.push({
      path: record.path,
      title: title || record.path.split('/').pop(),
      snippet,
      titleMatch,
    });
    if (index % 80 === 0) {
      dom.searchStatus.textContent = `正在搜索… ${index} / ${candidates.length}`;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  if (token !== state.searchToken) return;
  results.sort((a, b) => Number(b.titleMatch) - Number(a.titleMatch));
  const limited = results.slice(0, 120);
  dom.searchStatus.textContent = state.searchMode === 'title'
    ? `标题匹配 ${limited.length} 条`
    : `共 ${limited.length} 条，标题命中优先`;
  dom.searchResults.innerHTML = '';
  if (!limited.length) {
    dom.searchStatus.textContent = state.searchMode === 'title'
      ? '没有标题匹配。可以切换到“全文”。'
      : '没有找到匹配内容。';
    return;
  }
  for (const result of limited) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-result';
    button.innerHTML = '<strong></strong><small></small><p></p>';
    button.querySelector('strong').textContent = result.title;
    button.querySelector('small').textContent = result.path;
    button.querySelector('p').textContent = result.snippet;
    button.addEventListener('click', () => {
      closePanels();
      navigate(result.path);
    });
    dom.searchResults.append(button);
  }
}

function openPanel(id) {
  closePanels();
  dom.backdrop.hidden = false;
  document.getElementById(id).hidden = false;
  document.body.classList.add('panel-open');
}

function closePanels() {
  for (const panel of document.querySelectorAll('.panel')) panel.hidden = true;
  dom.backdrop.hidden = true;
  document.body.classList.remove('panel-open');
}

function updateFontUi() {
  dom.fontValue.textContent = `${state.font}%`;
  dom.fontRange.value = String(state.font);
  document.documentElement.style.setProperty('--reader-font', `${state.font}%`);
}

function setFont(value) {
  state.font = Math.min(160, Math.max(80, Math.round(Number(value) / 10) * 10));
  localStorage.setItem('chm-font', String(state.font));
  updateFontUi();
  applyReaderStyle();
}

function setNight(value) {
  state.night = Boolean(value);
  localStorage.setItem('chm-night', state.night ? '1' : '0');
  document.body.classList.toggle('night', state.night);
  dom.nightToggle.checked = state.night;
  applyReaderStyle();
}

/* ------------------------------------------------------------------------- */
/* Events                                                                    */
/* ------------------------------------------------------------------------- */

dom.filePicker.addEventListener('change', () => {
  const file = dom.filePicker.files?.[0];
  dom.filePicker.value = '';
  importChm(file);
});

dom.backButton.addEventListener('click', closeBook);
dom.shelfTab.addEventListener('click', () => {
  if (state.book) setView('reader');
  else setView('shelf');
});
dom.profileTab.addEventListener('click', () => setView('profile'));
dom.prevButton.addEventListener('click', prevPage);
dom.nextButton.addEventListener('click', nextPage);
dom.tocButton.addEventListener('click', () => openPanel('tocPanel'));
dom.searchButton.addEventListener('click', () => {
  openPanel('searchPanel');
  dom.searchInput.focus();
});
dom.fontButton.addEventListener('click', () => {
  updateFontUi();
  openPanel('fontPanel');
});
dom.aboutButton.addEventListener('click', () => openPanel('aboutPanel'));
dom.nightToggle.addEventListener('change', () => setNight(dom.nightToggle.checked));
dom.fontMinus.addEventListener('click', () => setFont(state.font - 10));
dom.fontPlus.addEventListener('click', () => setFont(state.font + 10));
dom.fontRange.addEventListener('input', () => setFont(dom.fontRange.value));

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-close]');
  if (target) closePanels();
});
dom.backdrop.addEventListener('click', closePanels);

dom.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch();
});
dom.searchInput.addEventListener('input', () => {
  clearTimeout(runSearch.timer);
  runSearch.timer = setTimeout(runSearch, 350);
});
for (const chip of document.querySelectorAll('[data-search-mode]')) {
  chip.addEventListener('click', () => {
    state.searchMode = chip.dataset.searchMode;
    for (const other of document.querySelectorAll('[data-search-mode]')) {
      other.classList.toggle('active', other === chip);
    }
    runSearch();
  });
}

dom.readerFrame.addEventListener('load', onFrameLoad);

window.addEventListener('popstate', () => {
  if (state.view === 'reader') closeBook();
});

/* ------------------------------------------------------------------------- */
/* Boot                                                                      */
/* ------------------------------------------------------------------------- */

async function boot() {
  setNight(state.night);
  updateFontUi();
  setView('shelf');
  await loadShelf();
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }
  await ensureServiceWorker().catch((error) => {
    console.warn(error);
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'reload') location.reload();
    });
  }
}

boot();
