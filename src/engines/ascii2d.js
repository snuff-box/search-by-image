import {validateUrl} from 'utils/app';
import {findNode} from 'utils/common';
import {setFileInputData, initUpload} from 'utils/engines';
import {targetEnv} from 'utils/config';

const engine = 'ascii2d';

async function upload({task, search, image}) {
  if (targetEnv === 'safari') {
    const token = (await findNode('input[name="authenticity_token"]')).value;

    const data = new FormData();
    data.append('utf8', '✓');
    data.append('authenticity_token', token);
    data.append('file', image.imageBlob, image.imageFilename);

    const rsp = await fetch('https://ascii2d.net/search/file', {
      mode: 'cors',
      method: 'POST',
      body: data
    });

    if (rsp.status !== 200) {
      throw new Error(`API response: ${rsp.status}, ${await rsp.text()}`);
    }

    const tabUrl = rsp.url;

    if (validateUrl(tabUrl)) {
      window.location.replace(tabUrl);
    }
  } else {
    const inputSelector = '#file-form';
    const input = await findNode(inputSelector);

    await setFileInputData(inputSelector, input, image);

    (await findNode('#file_upload')).submit();
  }
}

function init() {
  initUpload(upload, engine, sessionKey);
}

init();
