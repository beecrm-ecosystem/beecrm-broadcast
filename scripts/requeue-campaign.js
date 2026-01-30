const axios = require('axios');

const rawArgs = process.argv.slice(2);
const id = rawArgs.find((arg) => arg && !arg.startsWith('-'));

if (!id) {
  console.error('Informe o id da campanha');
  process.exit(1);
}

const base = (process.env.BROADCAST_BASE_URL || 'https://broadcast.beecrm.io').replace(/\/$/, '');
const url = `${base}/api/broadcast/${id}/requeue`;

axios
  .post(url)
  .then((response) => {
    console.log(JSON.stringify(response.data, null, 2));
  })
  .catch((error) => {
    const data = error?.response?.data;
    console.error(data ? JSON.stringify(data, null, 2) : error.message);
    process.exit(1);
  });
