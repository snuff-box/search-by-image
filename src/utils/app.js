import browser from 'webextension-polyfill';
import {difference} from 'lodash-es';
import fileType from 'file-type';

import storage from 'storage/storage';
import {
  getText,
  createTab,
  getActiveTab,
  getDataUrlMimeType,
  dataUrlToArray,
  dataUrlToBlob,
  blobToArray,
  blobToDataUrl,
  canvasToDataUrl,
  canvasToBlob,
  getPlatform,
  isAndroid
} from 'utils/common';
import {targetEnv} from 'utils/config';
import {engines, censoredEngines, imageMimeTypes, projectUrl} from 'utils/data';

async function getEnabledEngines(options) {
  if (typeof options === 'undefined') {
    options = await storage.get(['engines', 'disabledEngines']);
  }
  return difference(options.engines, options.disabledEngines);
}

async function getSupportedEngines(image, engines, searchMode) {
  const supportedEngines = [];
  for (const engine of engines) {
    if (
      image.hasOwnProperty('imageDataUrl') ||
      (image.hasOwnProperty('imageUrl') &&
        (await hasUrlSupport(engine, {bypassBlocking: searchMode !== 'url'})))
    ) {
      supportedEngines.push(engine);
    }
  }

  return supportedEngines;
}

async function getSearches(image, targetEngines, searchMode) {
  const searches = [];
  for (const engine of targetEngines) {
    const method = (await isUploadSearch(image, engine, searchMode))
      ? 'upload'
      : 'url';
    const isExec = engines[engine][method].isExec;
    const isTaskId = engines[engine][method].isTaskId;
    searches.push({
      engine,
      method,
      isExec,
      isTaskId,
      sendsReceipt: isExec || isTaskId
    });
  }

  return searches;
}

async function isUploadSearch(image, engine, searchMode) {
  return (
    searchMode === 'selectUpload' ||
    !image.imageUrl ||
    !(await hasUrlSupport(engine, {bypassBlocking: searchMode !== 'url'}))
  );
}

async function hasUrlSupport(engine, {bypassBlocking = true} = {}) {
  const targetEngines =
    engine === 'allEngines' ? await getEnabledEngines() : [engine];
  const {bypassImageHostBlocking} = await storage.get(
    'bypassImageHostBlocking'
  );

  for (const engine of targetEngines) {
    if (
      !engines[engine].url ||
      (bypassBlocking &&
        bypassImageHostBlocking &&
        censoredEngines.includes(engine))
    ) {
      return false;
    }
  }

  return true;
}

function showNotification({message, messageId, title, type = 'info'} = {}) {
  if (!title) {
    title = getText('extensionName');
  }
  if (messageId) {
    message = getText(messageId);
  }

  if (targetEnv === 'safari') {
    return browser.runtime.sendNativeMessage('application.id', {
      id: 'notification',
      message
    });
  } else {
    return browser.notifications.create(`sbi-notification-${type}`, {
      type: 'basic',
      title,
      message,
      iconUrl: '/src/assets/icons/app/icon-64.png'
    });
  }
}

function getListItems(data, {scope = '', shortScope = ''} = {}) {
  const labels = {};
  for (const [group, items] of Object.entries(data)) {
    labels[group] = [];
    items.forEach(function (value) {
      const item = {
        id: value,
        label: getText(`${scope ? scope + '_' : ''}${value}`)
      };
      if (shortScope) {
        item.shortLabel = getText(`${shortScope}_${value}`);
      }
      labels[group].push(item);
    });
  }
  return labels;
}

async function showContributePage(action = '') {
  await storage.set({contribPageLastOpen: Date.now()});
  const activeTab = await getActiveTab();
  let url = browser.runtime.getURL('/src/contribute/index.html');
  if (action) {
    url = `${url}?action=${action}`;
  }
  return createTab({url, index: activeTab.index + 1});
}

async function showProjectPage() {
  const activeTab = await getActiveTab();
  await createTab({url: projectUrl, index: activeTab.index + 1});
}

function validateUrl(url) {
  try {
    if (url.length > 2048) {
      return;
    }

    const parsedUrl = new URL(url);

    if (/^https?:$/i.test(parsedUrl.protocol)) {
      return true;
    }
  } catch (err) {}
}

function normalizeFilename({filename, ext} = {}) {
  if (!filename) {
    filename = 'image';
  }

  if (ext && !filename.toLowerCase().endsWith(ext)) {
    filename = `${filename}.${ext}`;
  }

  return filename;
}

async function normalizeImage({blob, dataUrl, convertImage = false} = {}) {
  let data = blob || dataUrl;
  let type = blob ? data.type : getDataUrlMimeType(data);
  const array = blob ? await blobToArray(data) : dataUrlToArray(data);

  const {mime: realType} = (await fileType.fromBuffer(array)) || {};

  if (realType) {
    if (!realType.startsWith('image/')) {
      return {};
    }
    if (type !== realType) {
      type = realType;
      data = new Blob([array], {type});
    }
  } else if (!type || !type.startsWith('image/')) {
    return {};
  }

  if (data instanceof Blob) {
    data = await blobToDataUrl(data);
  }

  if (convertImage && ['image/webp'].includes(type)) {
    const img = await getImageElement(data, {query: false});

    const cnv = document.createElement('canvas');
    const ctx = cnv.getContext('2d');

    cnv.width = img.naturalWidth;
    cnv.height = img.naturalHeight;

    ctx.drawImage(img, 0, 0);

    type = 'image/png';
    data = canvasToDataUrl(cnv, {ctx, type});
  }

  const ext = imageMimeTypes[type];

  return {dataUrl: data, type, ext};
}

async function resizeImage({blob, dataUrl, type, maxSize = 1000} = {}) {
  if (!type) {
    type = blob ? blob.type : getDataUrlMimeType(dataUrl);
  }

  const url = blob ? URL.createObjectURL(blob) : dataUrl;
  const img = await getImageElement(url, {query: false});
  if (blob) {
    URL.revokeObjectURL(url);
  }

  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  let dw;
  let dh;

  if (sw > maxSize || sh > maxSize) {
    if (sw === sh) {
      dw = dh = maxSize;
    }
    if (sw > sh) {
      dw = maxSize;
      dh = (sh / sw) * maxSize;
    }
    if (sw < sh) {
      dw = (sw / sh) * maxSize;
      dh = maxSize;
    }

    const cnv = document.createElement('canvas');
    const ctx = cnv.getContext('2d');

    cnv.width = dw;
    cnv.height = dh;

    if (type === 'image/jpeg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, dw, dh);
    }

    ctx.drawImage(img, 0, 0, sw, sh, 0, 0, dw, dh);

    if (blob) {
      blob = await canvasToBlob(cnv, {ctx, type});
      type = blob.type;
    } else {
      dataUrl = canvasToDataUrl(cnv, {ctx, type});
      type = getDataUrlMimeType(dataUrl);
    }
  }

  return {imageBlob: blob, imageDataUrl: dataUrl, imageType: type};
}

function getImageElement(url, {query = true} = {}) {
  return new Promise(resolve => {
    let img;
    if (query) {
      img = document.querySelector(`img[src="${url}"]`);
      if (img && img.complete && img.naturalWidth) {
        resolve(img);
      }
    }
    img = new Image();
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      resolve();
    };
    img.onabort = () => {
      resolve();
    };
    img.src = url;
  });
}

async function captureVisibleTabArea(area) {
  const tabData = await browser.tabs.captureVisibleTab({format: 'png'});
  const img = await getImageElement(tabData, {query: false});

  const {left, top, width, height, surfaceWidth} = area;
  const scale = img.naturalWidth / surfaceWidth;

  const cnv = document.createElement('canvas');
  const ctx = cnv.getContext('2d');
  cnv.width = width * scale;
  cnv.height = height * scale;

  ctx.drawImage(
    img,
    left * scale,
    top * scale,
    cnv.width,
    cnv.height,
    0,
    0,
    cnv.width,
    cnv.height
  );

  return canvasToDataUrl(cnv, {ctx});
}

async function configUI(Vue) {
  const {os} = await getPlatform();

  document.documentElement.classList.add(targetEnv, os);

  if (Vue) {
    Vue.prototype.$isChrome = targetEnv === 'chrome';
    Vue.prototype.$isEdge = targetEnv === 'edge';
    Vue.prototype.$isFirefox = targetEnv === 'firefox';
    Vue.prototype.$isOpera = targetEnv === 'opera';
    Vue.prototype.$isSafari = targetEnv === 'safari';
    Vue.prototype.$isSamsung = targetEnv === 'samsung';

    Vue.prototype.$isWindows = os === 'windows';
    Vue.prototype.$isMacos = os === 'macos';
    Vue.prototype.$isLinux = os === 'linux';
    Vue.prototype.$isAndroid = os === 'android';
    Vue.prototype.$isIos = os === 'ios';
    Vue.prototype.$isIpados = os === 'ipados';

    Vue.prototype.$isMobile = ['android', 'ios', 'ipados'].includes(os);
  }
}

function getContentXHR() {
  try {
    // Firefox
    return new content.XMLHttpRequest();
  } catch (err) {
    // Chrome
    return new XMLHttpRequest();
  }
}

function fetchImage(url, {credentials = false, token = ''} = {}) {
  return new Promise(resolve => {
    const xhr = getContentXHR();

    xhr.open('GET', url);
    xhr.timeout = 1200000; // 2 minutes
    xhr.responseType = 'blob';
    xhr.withCredentials = credentials;

    if (token) {
      xhr.setRequestHeader('Accept', token);
    }

    xhr.onload = () => {
      resolve(xhr.response);
    };
    xhr.onerror = () => {
      resolve();
    };
    xhr.onabort = () => {
      resolve();
    };
    xhr.ontimeout = () => {
      resolve();
    };

    xhr.send();
  });
}

async function fetchImageFromBackgroundScript(url) {
  const imageDataUrl = await browser.runtime.sendMessage({
    id: 'fetchImage',
    url
  });

  if (imageDataUrl) {
    return dataUrlToBlob(imageDataUrl);
  }
}

function getLargeImageMessage(engine, maxSize) {
  return browser.i18n.getMessage('error_invalidImageSize', [
    browser.i18n.getMessage(`engineName_${engine}`),
    browser.i18n.getMessage('unit_mb', (maxSize / 1024 / 1024).toString())
  ]);
}

function getMaxImageSize(engine) {
  let maxSize;
  if (['google', 'auDesign', 'nzTrademark', 'stocksy'].includes(engine)) {
    maxSize = 20;
  } else if (
    ['tineye', 'baidu', 'sogou', 'depositphotos', 'mailru'].includes(engine)
  ) {
    maxSize = 10;
  } else if (['karmaDecay'].includes(engine)) {
    maxSize = 9;
  } else if (['yandex', 'iqdb', 'auTrademark'].includes(engine)) {
    maxSize = 8;
  } else if (
    [
      'ascii2d',
      'getty',
      'istock',
      'taobao',
      'alamy',
      '123rf',
      'jpDesign',
      'pixta',
      'shutterstock',
      'saucenao'
    ].includes(engine)
  ) {
    maxSize = 5;
  } else if (['jingdong'].includes(engine)) {
    maxSize = 4;
  } else if (
    [
      'qihoo',
      'alibabaChina',
      'esearch',
      'tmview',
      'branddb',
      'madridMonitor'
    ].includes(engine)
  ) {
    maxSize = 2;
  }

  if (maxSize) {
    return maxSize * 1024 * 1024;
  } else {
    return Infinity;
  }
}

async function hasBaseModule(tabId, frameId = 0) {
  try {
    const [isBaseModule] = await browser.tabs.executeScript(tabId, {
      frameId,
      runAt: 'document_start',
      code: `typeof baseModule !== 'undefined'`
    });

    if (isBaseModule) {
      return true;
    }
  } catch (err) {}
}

async function insertBaseModule({activeTab = false} = {}) {
  const tabs = [];
  if (activeTab) {
    const tab = await getActiveTab();
    if (tab) {
      tabs.push(tab);
    }
  } else {
    tabs.push(
      ...(await browser.tabs.query({
        url: ['http://*/*', 'https://*/*'],
        windowType: 'normal'
      }))
    );
  }

  for (const tab of tabs) {
    browser.tabs.executeScript(tab.id, {
      allFrames: true,
      runAt: 'document_start',
      file: '/src/insert/script.js'
    });
  }
}

async function isContextMenuSupported() {
  if (await isAndroid()) {
    if (targetEnv === 'samsung') {
      return true;
    }
  } else if (browser.contextMenus) {
    return true;
  }

  return false;
}

async function checkSearchEngineAccess() {
  // Check if search engine access is enabled in Opera
  if (/ opr\//i.test(navigator.userAgent)) {
    const {lastEngineAccessCheck} = await storage.get('lastEngineAccessCheck');
    // run at most once a week
    if (Date.now() - lastEngineAccessCheck > 604800000) {
      await storage.set({lastEngineAccessCheck: Date.now()});

      const url = 'https://www.google.com/generate_204';

      const hasAccess = await new Promise(resolve => {
        let access = false;

        function requestCallback() {
          access = true;
          removeCallback();
          return {cancel: true};
        }

        const removeCallback = function () {
          window.clearTimeout(timeoutId);
          browser.webRequest.onBeforeRequest.removeListener(requestCallback);

          resolve(access);
        };
        const timeoutId = window.setTimeout(removeCallback, 3000); // 3 seconds

        browser.webRequest.onBeforeRequest.addListener(
          requestCallback,
          {urls: [url], types: ['xmlhttprequest']},
          ['blocking']
        );

        fetch(url).catch(err => null);
      });

      if (!hasAccess) {
        await showNotification({messageId: 'error_noSearchEngineAccess'});
      }
    }
  }
}

export {
  getEnabledEngines,
  getSupportedEngines,
  getSearches,
  isUploadSearch,
  hasUrlSupport,
  showNotification,
  getListItems,
  showContributePage,
  showProjectPage,
  validateUrl,
  normalizeFilename,
  normalizeImage,
  resizeImage,
  getImageElement,
  captureVisibleTabArea,
  getContentXHR,
  fetchImage,
  fetchImageFromBackgroundScript,
  configUI,
  getLargeImageMessage,
  getMaxImageSize,
  hasBaseModule,
  insertBaseModule,
  isContextMenuSupported,
  checkSearchEngineAccess
};
