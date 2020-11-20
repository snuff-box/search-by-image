import {findNode} from 'utils/common';
import {setFileInputData, initUpload} from 'utils/engines';

const engine = 'jpDesign';

async function upload({task, search, image}) {
  const inputSelector = '#ImageFile';
  const input = await findNode(inputSelector);

  await setFileInputData(inputSelector, input, image);

  input.dispatchEvent(new Event('change'));

  await findNode('#photo_image');

  (await findNode('#searchForm')).removeAttribute('target');
  (await findNode('.action input[type=submit]')).click();
}

function init() {
  initUpload(upload, engine, sessionKey);
}

init();
