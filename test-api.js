require('dotenv').config({ path: '.env.local' });
const { listYoutubeVideos } = require('./lib/acquire/YoutubeVideosStore.js');
(async () => {
    try {
        const res = await listYoutubeVideos(10);
        console.log(JSON.stringify(res, null, 2));
    } catch (e) {
        console.error(e);
    }
})();
